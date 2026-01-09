/**
 * Goods Receipt Controller
 * Handle goods receipts with SAP integration
 * Creates local lotes/inventory AND pushes to SAP InventoryGenEntries
 */
const {
  getLotesModel,
  getInventarioModel,
  getProductosModel,
  getLocacionesModel,
  getTransaccionesModel
} = require('../getModel');
const sapService = require('../services/sapService');

/**
 * Helper: Update or create inventory record
 */
async function updateInventario(companyId, productId, locationId) {
  const Inventario = await getInventarioModel(companyId);
  const Lotes = await getLotesModel(companyId);

  const lotes = await Lotes.find({
    productId,
    currentLocationId: locationId
  });

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

  await Inventario.findOneAndUpdate(
    { productId, locationId },
    {
      $set: {
        ...aggregated,
        lastMovementDate: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true, new: true }
  );
}

/**
 * POST /api/goods-receipt
 * Create goods receipt - saves locally and pushes to SAP
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

    // Validate request
    if (!locationId || !items || items.length === 0) {
      return res.status(400).json({ error: 'locationId and items are required' });
    }

    // Validate location exists and is a warehouse
    const Locaciones = await getLocacionesModel(req.companyId);
    const location = await Locaciones.findById(locationId);
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
    const products = await Productos.find({ _id: { $in: productIds } });

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

    // Create local records
    const Lotes = await getLotesModel(req.companyId);
    const Transacciones = await getTransaccionesModel(req.companyId);
    const createdLotes = [];
    const transactions = [];

    for (const item of items) {
      const product = productMap[item.productId];

      // Check if lot already exists
      let lote = await Lotes.findOne({
        productId: item.productId,
        lotNumber: item.lotNumber,
        currentLocationId: locationId
      });

      if (lote) {
        // Add to existing lot
        lote.quantityTotal += item.quantity;
        lote.quantityAvailable += item.quantity;
        lote.historia.push({
          fecha: new Date(),
          user: {
            _id: req.user._id,
            firstname: req.user.firstname,
            lastname: req.user.lastname
          },
          accion: 'Recepción de mercancía',
          detalles: `Cantidad: ${item.quantity}${supplier ? `, Proveedor: ${supplier}` : ''}`
        });
        await lote.save();
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
            detalles: `Cantidad: ${item.quantity}`
          }]
        });
        await lote.save();
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
        status: 'COMPLETED'
      });
      await transaccion.save();
      transactions.push(transaccion);

      // Update inventory
      await updateInventario(req.companyId, item.productId, locationId);
    }

    // Push to SAP if enabled
    let sapResult = null;
    if (pushToSap) {
      // SupplierCode is required for PurchaseDeliveryNotes (Entrada de Mercancía)
      if (!supplierCode) {
        sapResult = {
          success: false,
          error: 'Supplier code is required for SAP integration (e.g., P00031 for Centralmed)'
        };
      } else {
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
          console.error('SAP push failed:', sapError);
          // Don't fail the whole operation - local records are created
          sapResult = {
            success: false,
            error: sapError.message
          };
        }
      }

      // Update all transactions with SAP sync status
      const Transacciones = await getTransaccionesModel(req.companyId);
      const sapIntegrationData = {
        pushed: sapResult?.success || false,
        syncDate: new Date(),
        ...(sapResult?.success && {
          docEntry: sapResult.sapDocEntry,
          docNum: sapResult.sapDocNum,
          docType: sapResult.sapDocType || 'PurchaseDeliveryNotes',
        }),
        ...(!sapResult?.success && {
          error: sapResult?.error || 'Unknown error',
        }),
      };

      // Update all transactions created in this receipt
      const transactionIds = transactions.map(t => t._id);
      await Transacciones.updateMany(
        { _id: { $in: transactionIds } },
        { $set: { sapIntegration: sapIntegrationData } }
      );

      // Update the transactions array with SAP info for response
      transactions.forEach(t => {
        t.sapIntegration = sapIntegrationData;
      });
    }

    res.status(201).json({
      success: true,
      message: 'Goods receipt created successfully',
      lotes: createdLotes,
      transactions,
      sapResult
    });

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
