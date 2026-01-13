/**
 * Goods Receipt Controller
 * Handle goods receipts with SAP integration
 * Creates local lotes/inventory AND pushes to SAP PurchaseDeliveryNotes
 *
 * ATOMIC: SAP is called FIRST. If SAP fails, nothing is saved locally.
 * If SAP succeeds, local changes are committed in a transaction.
 */
const mongoose = require('mongoose');
const {
  getLotesModel,
  getInventarioModel,
  getProductosModel,
  getLocacionesModel,
  getTransaccionesModel,
  getGoodsReceiptsModel
} = require('../getModel');
const sapService = require('../services/sapService');
const { extractPackingList } = require('../services/extractionService');

/**
 * Helper: Update or create inventory record
 * @param {string} companyId - Company ID for multi-tenant DB
 * @param {ObjectId} productId - Product ID
 * @param {ObjectId} locationId - Location ID
 * @param {Object} session - Optional MongoDB session for transactions
 */
async function updateInventario(companyId, productId, locationId, session = null) {
  const Inventario = await getInventarioModel(companyId);
  const Lotes = await getLotesModel(companyId);

  const lotes = await Lotes.find({
    productId,
    currentLocationId: locationId
  }).session(session);

  const aggregated = lotes.reduce((acc, lote) => {
    acc.quantityTotal += lote.quantityTotal || 0;
    acc.quantityAvailable += lote.quantityAvailable || 0;
    acc.quantityConsigned += lote.quantityConsigned || 0;
    acc.quantityConsumed += lote.quantityConsumed || 0;
    acc.quantityDamaged += lote.quantityDamaged || 0;
    acc.quantityReturned += lote.quantityReturned || 0;
    return acc;
  }, {
    quantityTotal: 0,
    quantityAvailable: 0,
    quantityConsigned: 0,
    quantityConsumed: 0,
    quantityDamaged: 0,
    quantityReturned: 0
  });

  const options = { upsert: true, new: true };
  if (session) options.session = session;

  await Inventario.findOneAndUpdate(
    { productId, locationId },
    {
      $set: {
        ...aggregated,
        lastMovementDate: new Date(),
        updatedAt: new Date()
      }
    },
    options
  );
}

/**
 * POST /api/goods-receipt
 * Create goods receipt - saves locally and pushes to SAP
 *
 * ATOMIC: SAP is called FIRST. If SAP fails, nothing is saved locally.
 * If SAP succeeds, local changes are committed in a transaction.
 *
 * Body: {
 *   locationId: ObjectId (warehouse),
 *   items: [{
 *     productId: ObjectId,
 *     lotNumber: String,
 *     quantity: Number,
 *     expiryDate: Date
 *   }],
 *   supplier: String (optional),
 *   notes: String (optional),
 *   pushToSap: Boolean (default true)
 * }
 */
exports.createGoodsReceipt = async (req, res, next) => {
  try {
    const { locationId, items, supplier, supplierCode, notes, pushToSap = true } = req.body;

    // ============================================
    // PHASE 1: VALIDATION (no saves)
    // ============================================

    // Validate request
    if (!locationId || !items || items.length === 0) {
      return res.status(400).json({ error: 'locationId and items are required' });
    }

    // Validate location exists and is a warehouse
    const Locaciones = await getLocacionesModel(req.companyId);
    const location = await Locaciones.findById(locationId).lean();
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    if (location.type !== 'WAREHOUSE') {
      return res.status(400).json({ error: 'Goods receipt must be to a warehouse location' });
    }

    // Get SAP warehouse code
    const sapWarehouseCode = location.sapIntegration?.warehouseCode || '01';

    // Validate all products exist and have SAP codes
    const Productos = await getProductosModel(req.companyId);
    const productIds = items.map(i => i.productId);
    const products = await Productos.find({ _id: { $in: productIds } }).lean();

    if (products.length !== productIds.length) {
      return res.status(400).json({ error: 'One or more products not found' });
    }

    // Create lookup map
    const productMap = {};
    for (const p of products) {
      productMap[p._id.toString()] = p;
    }

    // Validate each item
    for (const item of items) {
      const product = productMap[item.productId];
      if (!product) {
        return res.status(400).json({ error: `Product ${item.productId} not found` });
      }
      if (!item.lotNumber || !item.quantity || !item.expiryDate) {
        return res.status(400).json({ error: 'Each item requires lotNumber, quantity, and expiryDate' });
      }
      if (pushToSap && !product.sapItemCode) {
        return res.status(400).json({
          error: `Product "${product.name}" does not have a SAP item code configured`
        });
      }
    }

    // Validate SAP requirements if pushing to SAP
    if (pushToSap && !supplierCode) {
      return res.status(400).json({
        error: 'Supplier code is required for SAP integration (e.g., P00031 for Centralmed)'
      });
    }

    // Check for existing lots (read-only, no saves yet)
    const Lotes = await getLotesModel(req.companyId);
    const existingLots = {};
    for (const item of items) {
      const existingLot = await Lotes.findOne({
        productId: item.productId,
        lotNumber: item.lotNumber,
        currentLocationId: locationId
      }).lean();
      if (existingLot) {
        existingLots[`${item.productId}-${item.lotNumber}`] = existingLot;
      }
    }

    // ============================================
    // PHASE 2: SAP CALL (before any local saves)
    // ============================================

    let sapResult = null;
    if (pushToSap) {
      try {
        sapResult = await pushToSapGoodsReceipt({
          items,
          productMap,
          sapWarehouseCode,
          supplier,
          supplierCode,
          notes
        });
      } catch (sapError) {
        // SAP failed - return error, save nothing locally
        console.error('SAP PurchaseDeliveryNote creation failed:', sapError);
        return res.status(500).json({
          success: false,
          error: `SAP Error: ${sapError.message}`,
          sapError: sapError.message,
        });
      }
    }

    // ============================================
    // PHASE 3: LOCAL SAVES (in transaction)
    // SAP succeeded (or not required), now commit local changes
    // ============================================

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const Transacciones = await getTransaccionesModel(req.companyId);
      const GoodsReceipts = await getGoodsReceiptsModel(req.companyId);
      const createdLotes = [];
      const transactions = [];

      for (const item of items) {
        const product = productMap[item.productId];
        const existingLotKey = `${item.productId}-${item.lotNumber}`;
        const existingLot = existingLots[existingLotKey];

        let lote;
        if (existingLot) {
          // Update existing lot
          const historyEntry = {
            fecha: new Date(),
            user: {
              _id: req.user._id,
              firstname: req.user.firstname,
              lastname: req.user.lastname
            },
            accion: 'Recepción de mercancía',
            detalles: `Cantidad: ${item.quantity}${supplier ? `, Proveedor: ${supplier}` : ''}${sapResult ? `, SAP Doc: ${sapResult.sapDocNum}` : ''}`
          };

          lote = await Lotes.findByIdAndUpdate(
            existingLot._id,
            {
              $inc: {
                quantityTotal: item.quantity,
                quantityAvailable: item.quantity
              },
              $push: { historia: historyEntry }
            },
            { new: true, session }
          );
        } else {
          // Create new lot
          lote = new Lotes({
            productId: item.productId,
            lotNumber: item.lotNumber,
            expiryDate: new Date(item.expiryDate),
            quantityTotal: item.quantity,
            quantityAvailable: item.quantity,
            quantityConsigned: 0,
            quantityConsumed: 0,
            currentLocationId: locationId,
            status: 'ACTIVE',
            receivedDate: new Date(),
            supplier,
            createdBy: {
              _id: req.user._id,
              firstname: req.user.firstname,
              lastname: req.user.lastname
            },
            historia: [{
              fecha: new Date(),
              user: {
                _id: req.user._id,
                firstname: req.user.firstname,
                lastname: req.user.lastname
              },
              accion: 'Lote recibido',
              detalles: `Cantidad: ${item.quantity}${sapResult ? `, SAP Doc: ${sapResult.sapDocNum}` : ''}`
            }]
          });
          await lote.save({ session });
        }

        createdLotes.push(lote);

        // Create transaction record
        const transaccion = new Transacciones({
          type: 'WAREHOUSE_RECEIPT',
          productId: item.productId,
          lotId: lote._id,
          lotNumber: item.lotNumber,
          toLocationId: locationId,
          quantity: item.quantity,
          warehouseReceipt: {
            lotNumber: item.lotNumber,
            expiryDate: new Date(item.expiryDate),
            supplier
          },
          transactionDate: new Date(),
          notes,
          performedBy: {
            _id: req.user._id,
            firstname: req.user.firstname,
            lastname: req.user.lastname,
            email: req.user.email
          },
          status: 'COMPLETED',
          sapIntegration: pushToSap ? {
            pushed: true,
            docEntry: sapResult.sapDocEntry,
            docNum: sapResult.sapDocNum,
            docType: 'PurchaseDeliveryNotes',
            syncDate: new Date()
          } : undefined
        });
        await transaccion.save({ session });
        transactions.push(transaccion);

        // Update inventory
        await updateInventario(req.companyId, item.productId, locationId, session);
      }

      // Save to GoodsReceipts collection for history tracking
      const goodsReceipt = new GoodsReceipts({
        receiptDate: new Date(),
        locationId,
        locationName: location.name,
        sapWarehouseCode,
        supplier,
        supplierCode,
        notes,
        items: items.map((item, idx) => {
          const product = productMap[item.productId];
          return {
            productId: item.productId,
            productName: product.name,
            sapItemCode: product.sapItemCode,
            lotNumber: item.lotNumber,
            quantity: item.quantity,
            expiryDate: new Date(item.expiryDate),
            loteId: createdLotes[idx]._id,
            transactionId: transactions[idx]._id
          };
        }),
        sapIntegration: pushToSap ? {
          pushed: true,
          docEntry: sapResult.sapDocEntry,
          docNum: sapResult.sapDocNum,
          docType: 'PurchaseDeliveryNotes',
          syncDate: new Date(),
          retryCount: 0
        } : {
          pushed: false,
          error: 'SAP sync disabled',
          syncDate: new Date(),
          retryCount: 0
        },
        createdBy: {
          _id: req.user._id,
          firstname: req.user.firstname,
          lastname: req.user.lastname
        }
      });
      await goodsReceipt.save({ session });

      // Commit transaction
      await session.commitTransaction();

      res.status(201).json({
        success: true,
        message: 'Goods receipt created successfully',
        receiptId: goodsReceipt._id,
        lotes: createdLotes,
        transactions,
        sapResult: pushToSap ? sapResult : null
      });

    } catch (localError) {
      // Local save failed after SAP succeeded
      // This is a critical error - SAP has the document but local doesn't
      await session.abortTransaction();
      console.error('CRITICAL: SAP succeeded but local save failed:', localError);
      if (sapResult) {
        console.error('SAP Document created:', sapResult);
      }

      return res.status(500).json({
        success: false,
        error: 'Error guardando localmente después de crear documento SAP. Contacte soporte.',
        sapResult,
        localError: localError.message,
        requiresManualReconciliation: !!sapResult,
      });
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('Error in goods receipt:', error);
    next(error);
  }
};

/**
 * Push goods receipt to SAP via PurchaseDeliveryNotes (Entrada de Mercancía)
 * This creates a proper Goods Receipt PO that can be used to create supplier invoices
 */
async function pushToSapGoodsReceipt({ items, productMap, sapWarehouseCode, supplier, supplierCode, notes }) {
  const sessionId = await sapService.ensureSession();

  // Build document lines with required TaxCode
  const documentLines = items.map(item => {
    const product = productMap[item.productId];
    return {
      ItemCode: product.sapItemCode,
      Quantity: item.quantity,
      WarehouseCode: sapWarehouseCode,
      TaxCode: 'EXE', // Tax exempt - adjust if needed for your SAP config
      BatchNumbers: [{
        BatchNumber: item.lotNumber,
        Quantity: item.quantity,
        ExpiryDate: new Date(item.expiryDate).toISOString().split('T')[0]
      }]
    };
  });

  // Create PurchaseDeliveryNotes (Entrada de Mercancía) in SAP
  // Note: Use today's date for production. Test DB may have outdated exchange rates.
  const docDate = new Date().toISOString().split('T')[0];

  const payload = {
    DocDate: docDate,
    CardCode: supplierCode, // Required for PurchaseDeliveryNotes
    Comments: `Entrada desde Vasculares App${notes ? ` - ${notes}` : ''}`,
    DocumentLines: documentLines
  };

  const response = await fetch(`${sapService.SAP_CONFIG.serviceUrl}/PurchaseDeliveryNotes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `B1SESSION=${sessionId}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message?.value || `SAP error: ${response.statusText}`);
  }

  const result = await response.json();

  return {
    success: true,
    sapDocEntry: result.DocEntry,
    sapDocNum: result.DocNum,
    sapDocType: 'PurchaseDeliveryNotes' // Entrada de Mercancía
  };
}

/**
 * GET /api/goods-receipt/products
 * Get products available for goods receipt (with SAP codes)
 */
exports.getProductsForReceipt = async (req, res, next) => {
  try {
    const { search } = req.query;
    const Productos = await getProductosModel(req.companyId);

    const query = {
      active: true,
      sapItemCode: { $exists: true, $ne: null }
    };

    if (search) {
      // Note: code is a Number type, so we only search name and sapItemCode with regex
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sapItemCode: { $regex: search, $options: 'i' } }
      ];
    }

    const products = await Productos.find(query)
      .select('_id code name sapItemCode category specifications')
      .limit(50)
      .lean();

    res.json(products);
  } catch (error) {
    console.error('Error fetching products for receipt:', error);
    next(error);
  }
};

/**
 * GET /api/goods-receipt/warehouses
 * Get warehouse locations for goods receipt
 */
exports.getWarehouses = async (req, res, next) => {
  try {
    const Locaciones = await getLocacionesModel(req.companyId);

    const warehouses = await Locaciones.find({
      type: 'WAREHOUSE',
      active: true
    })
      .select('_id name sapIntegration')
      .lean();

    res.json(warehouses);
  } catch (error) {
    console.error('Error fetching warehouses:', error);
    next(error);
  }
};

/**
 * GET /api/goods-receipt/history
 * List all goods receipts with optional filters
 * Query params: sapStatus (synced/failed/all), startDate, endDate, limit
 */
exports.listGoodsReceipts = async (req, res, next) => {
  try {
    const { sapStatus, startDate, endDate, limit = 50 } = req.query;
    const GoodsReceipts = await getGoodsReceiptsModel(req.companyId);

    // Build query
    const query = {};

    if (sapStatus === 'synced') {
      query['sapIntegration.pushed'] = true;
    } else if (sapStatus === 'failed') {
      query['sapIntegration.pushed'] = false;
    }

    if (startDate || endDate) {
      query.receiptDate = {};
      if (startDate) query.receiptDate.$gte = new Date(startDate);
      if (endDate) query.receiptDate.$lte = new Date(endDate);
    }

    const receipts = await GoodsReceipts.find(query)
      .sort({ receiptDate: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json(receipts);
  } catch (error) {
    console.error('Error listing goods receipts:', error);
    next(error);
  }
};

/**
 * GET /api/goods-receipt/:id
 * Get a single goods receipt by ID
 */
exports.getGoodsReceipt = async (req, res, next) => {
  try {
    const GoodsReceipts = await getGoodsReceiptsModel(req.companyId);
    const receipt = await GoodsReceipts.findById(req.params.id).lean();

    if (!receipt) {
      return res.status(404).json({ error: 'Goods receipt not found' });
    }

    res.json(receipt);
  } catch (error) {
    console.error('Error fetching goods receipt:', error);
    next(error);
  }
};

/**
 * POST /api/goods-receipt/:id/retry-sap
 * Retry SAP push for a failed goods receipt
 */
exports.retrySapPush = async (req, res, next) => {
  try {
    const GoodsReceipts = await getGoodsReceiptsModel(req.companyId);
    const receipt = await GoodsReceipts.findById(req.params.id);

    if (!receipt) {
      return res.status(404).json({ error: 'Goods receipt not found' });
    }

    // Check if already synced
    if (receipt.sapIntegration?.pushed) {
      return res.status(400).json({
        error: 'This receipt is already synced with SAP',
        sapDocNum: receipt.sapIntegration.docNum
      });
    }

    // Validate supplier code exists
    if (!receipt.supplierCode) {
      return res.status(400).json({
        error: 'Supplier code is required for SAP integration'
      });
    }

    // Get products for SAP item codes
    const Productos = await getProductosModel(req.companyId);
    const productIds = receipt.items.map(i => i.productId);
    const products = await Productos.find({ _id: { $in: productIds } });

    const productMap = {};
    for (const p of products) {
      productMap[p._id.toString()] = p;
    }

    // Rebuild items array for SAP push
    const itemsForSap = receipt.items.map(item => ({
      productId: item.productId.toString(),
      lotNumber: item.lotNumber,
      quantity: item.quantity,
      expiryDate: item.expiryDate
    }));

    // Push to SAP
    let sapResult;
    try {
      sapResult = await pushToSapGoodsReceipt({
        items: itemsForSap,
        productMap,
        sapWarehouseCode: receipt.sapWarehouseCode || '01',
        supplier: receipt.supplier,
        supplierCode: receipt.supplierCode,
        notes: receipt.notes
      });
    } catch (sapError) {
      console.error('SAP retry push failed:', sapError);
      sapResult = {
        success: false,
        error: sapError.message
      };
    }

    // Update receipt with new SAP status
    receipt.sapIntegration = {
      pushed: sapResult?.success || false,
      docEntry: sapResult?.sapDocEntry,
      docNum: sapResult?.sapDocNum,
      docType: sapResult?.sapDocType || 'PurchaseDeliveryNotes',
      error: sapResult?.success ? undefined : (sapResult?.error || 'Unknown error'),
      syncDate: new Date(),
      retryCount: (receipt.sapIntegration?.retryCount || 0) + 1
    };
    await receipt.save();

    // If successful, also update the transactions
    if (sapResult?.success) {
      const Transacciones = await getTransaccionesModel(req.companyId);
      const transactionIds = receipt.items.map(i => i.transactionId).filter(Boolean);

      if (transactionIds.length > 0) {
        await Transacciones.updateMany(
          { _id: { $in: transactionIds } },
          {
            $set: {
              'sapIntegration.pushed': true,
              'sapIntegration.docEntry': sapResult.sapDocEntry,
              'sapIntegration.docNum': sapResult.sapDocNum,
              'sapIntegration.docType': 'PurchaseDeliveryNotes',
              'sapIntegration.syncDate': new Date(),
              'sapIntegration.error': null
            }
          }
        );
      }
    }

    res.json({
      success: sapResult?.success || false,
      message: sapResult?.success ? 'SAP sync successful' : 'SAP sync failed',
      receipt: receipt.toObject(),
      sapResult
    });

  } catch (error) {
    console.error('Error retrying SAP push:', error);
    next(error);
  }
};

/**
 * POST /api/goods-receipt/extract
 * Extract product data from packing list images using Claude Vision
 */
exports.extractFromPackingList = async (req, res, next) => {
  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    console.log(`Extracting data from ${req.files.length} file(s)...`);

    // Call the extraction service
    const extractionResult = await extractPackingList(req.files);

    // Enrich items with product database info
    const Productos = await getProductosModel(req.companyId);
    const enrichedItems = [];

    for (const item of extractionResult.items) {
      // Try to find product by code (as sapItemCode)
      const codeStr = String(item.code);
      let product = await Productos.findOne({
        $or: [
          { sapItemCode: codeStr },
          { code: item.code }
        ]
      }).lean();

      enrichedItems.push({
        ...item,
        sapItemCode: codeStr,
        productId: product?._id || null,
        productName: product?.name || item.name,
        existsInDb: !!product
      });
    }

    res.json({
      success: true,
      items: enrichedItems,
      documentInfo: extractionResult.documentInfo || {},
      warnings: extractionResult.warnings || [],
      filesProcessed: extractionResult.filesProcessed
    });

  } catch (error) {
    console.error('Error extracting from packing list:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Extraction failed'
    });
  }
};
