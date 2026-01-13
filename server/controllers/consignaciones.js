/**
 * Consignaciones Controller
 * Handle bulk consignments from warehouse to centros
 * Integrates with SAP Business One for stock transfers
 *
 * ATOMIC: SAP is called FIRST. If SAP fails, nothing is saved locally.
 * If SAP succeeds, local changes are committed in a transaction.
 */
const mongoose = require('mongoose');
const {
  getConsignacionesModel,
  getTransaccionesModel,
  getLotesModel,
  getInventarioModel,
  getProductosModel,
  getLocacionesModel,
} = require('../getModel');
const { validationResult } = require('express-validator');
const sapService = require('../services/sapService');

/**
 * Helper: Update or create inventory record
 * @param {string} companyId - Company identifier
 * @param {ObjectId} productId - Product ID
 * @param {ObjectId} locationId - Location ID
 * @param {ClientSession} session - Optional MongoDB session for transactions
 */
async function updateInventario(companyId, productId, locationId, session = null) {
  const Inventario = await getInventarioModel(companyId);
  const Lotes = await getLotesModel(companyId);

  // Aggregate all lotes for this product at this location
  const query = Lotes.find({
    productId,
    currentLocationId: locationId,
  });
  const lotes = session ? await query.session(session) : await query;

  const aggregated = lotes.reduce(
    (acc, lote) => {
      acc.quantityTotal += lote.quantityTotal || 0;
      acc.quantityAvailable += lote.quantityAvailable || 0;
      acc.quantityConsigned += lote.quantityConsigned || 0;
      acc.quantityConsumed += lote.quantityConsumed || 0;
      acc.quantityDamaged += lote.quantityDamaged || 0;
      acc.quantityReturned += lote.quantityReturned || 0;
      return acc;
    },
    {
      quantityTotal: 0,
      quantityAvailable: 0,
      quantityConsigned: 0,
      quantityConsumed: 0,
      quantityDamaged: 0,
      quantityReturned: 0,
    }
  );

  // Update or create inventory record
  const options = { upsert: true, new: true };
  if (session) options.session = session;

  await Inventario.findOneAndUpdate(
    { productId, locationId },
    {
      $set: {
        ...aggregated,
        lastMovementDate: new Date(),
        updatedAt: new Date(),
      },
    },
    options
  );
}

/**
 * GET /api/consignaciones
 * List consignments with optional filters
 */
exports.list = async (req, res, next) => {
  try {
    const Consignaciones = await getConsignacionesModel(req.companyId);
    const { status, fromLocationId, toLocationId } = req.query;

    const query = {};
    if (status) query.status = status;
    if (fromLocationId) query.fromLocationId = fromLocationId;
    if (toLocationId) query.toLocationId = toLocationId;

    const consignaciones = await Consignaciones.find(query)
      .populate('fromLocationId', 'name type')
      .populate('toLocationId', 'name type')
      .populate('items.productId', 'name code specifications')
      .sort({ createdAt: -1 })
      .lean();

    res.json(consignaciones);
  } catch (error) {
    console.error('Error listing consignaciones:', error);
    next(error);
  }
};

/**
 * GET /api/consignaciones/:id
 * Get single consignment
 */
exports.getOne = async (req, res, next) => {
  try {
    const Consignaciones = await getConsignacionesModel(req.companyId);

    const consignacion = await Consignaciones.findById(req.params.id)
      .populate('fromLocationId', 'name type')
      .populate('toLocationId', 'name type')
      .populate('items.productId', 'name code specifications')
      .lean();

    if (!consignacion) {
      return res.status(404).json({ error: 'Consignación no encontrada' });
    }

    res.json(consignacion);
  } catch (error) {
    console.error('Error getting consignación:', error);
    next(error);
  }
};

/**
 * POST /api/consignaciones
 * Create bulk consignment with SAP integration
 *
 * ATOMIC: SAP is called FIRST. If SAP fails, nothing is saved locally.
 * If SAP succeeds, local changes are committed in a transaction.
 *
 * Request body:
 * - fromLocationId: Warehouse location ID
 * - toLocationId: Centro location ID
 * - items: Array of { productId, loteId, lotNumber, quantitySent }
 * - notes: Optional notes
 * - skipSap: Optional flag to skip SAP integration (for testing)
 *
 * Flow:
 * 1. Validate locations and items (no saves)
 * 2. Create SAP Stock Transfer first
 * 3. If SAP fails → return error, save nothing
 * 4. If SAP succeeds → commit local changes in transaction
 */
exports.create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { fromLocationId, toLocationId, items, notes, skipSap } = req.body;

    // ============================================
    // PHASE 1: VALIDATION (no saves)
    // ============================================

    // Validate locations exist
    const Locaciones = await getLocacionesModel(req.companyId);
    const fromLocation = await Locaciones.findById(fromLocationId).lean();
    const toLocation = await Locaciones.findById(toLocationId).lean();

    if (!fromLocation) {
      return res.status(404).json({ error: 'Warehouse location not found' });
    }
    if (!toLocation) {
      return res.status(404).json({ error: 'Centro location not found' });
    }

    if (fromLocation.type !== 'WAREHOUSE') {
      return res.status(400).json({ error: 'From location must be a warehouse' });
    }

    // Check if SAP integration is available
    const sapEnabled = !skipSap &&
      fromLocation.sapIntegration?.warehouseCode &&
      toLocation.sapIntegration?.warehouseCode;

    const Lotes = await getLotesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);

    // Validate all items and prepare SAP transfer data (NO SAVES YET)
    const sapTransferItems = [];
    const processedItems = [];

    for (const item of items) {
      const product = await Productos.findById(item.productId).lean();
      if (!product) {
        return res.status(404).json({ error: `Product ${item.productId} not found` });
      }

      // Check if item specifies a specific lot (SAP mode) or needs FIFO
      if (item.loteId && item.lotNumber) {
        // SAP mode: use specified lot
        const lote = await Lotes.findById(item.loteId).lean();
        if (!lote) {
          return res.status(404).json({ error: `Lot ${item.loteId} not found` });
        }

        if (lote.quantityAvailable < item.quantitySent) {
          return res.status(400).json({
            error: `Insufficient stock in lot ${item.lotNumber}. Available: ${lote.quantityAvailable}, Requested: ${item.quantitySent}`,
          });
        }

        processedItems.push({
          ...item,
          lote,
          product,
        });

        // Prepare SAP transfer item
        if (sapEnabled && product.sapItemCode) {
          sapTransferItems.push({
            itemCode: product.sapItemCode,
            quantity: item.quantitySent,
            batchNumber: item.lotNumber,
          });
        }
      } else {
        // Legacy FIFO mode: find available lotes
        const availableLotes = await Lotes.find({
          productId: item.productId,
          currentLocationId: fromLocationId,
          quantityAvailable: { $gt: 0 },
        }).sort({ expiryDate: 1 }).lean();

        const totalAvailable = availableLotes.reduce((sum, l) => sum + l.quantityAvailable, 0);
        if (totalAvailable < item.quantitySent) {
          return res.status(400).json({
            error: `Insufficient stock for ${product.name}. Available: ${totalAvailable}, Requested: ${item.quantitySent}`,
          });
        }

        // FIFO allocation
        let remaining = item.quantitySent;
        for (const lote of availableLotes) {
          if (remaining <= 0) break;
          const toDeduct = Math.min(remaining, lote.quantityAvailable);

          processedItems.push({
            productId: item.productId,
            loteId: lote._id,
            lotNumber: lote.lotNumber,
            quantitySent: toDeduct,
            lote,
            product,
            notes: item.notes,
          });

          if (sapEnabled && product.sapItemCode) {
            sapTransferItems.push({
              itemCode: product.sapItemCode,
              quantity: toDeduct,
              batchNumber: lote.lotNumber,
            });
          }

          remaining -= toDeduct;
        }
      }
    }

    // ============================================
    // PHASE 2: SAP CALL (before any local saves)
    // ============================================

    let sapResult = null;

    if (sapEnabled && sapTransferItems.length > 0) {
      try {
        sapResult = await sapService.createStockTransfer({
          fromWarehouse: fromLocation.sapIntegration.warehouseCode,
          toWarehouse: toLocation.sapIntegration.warehouseCode,
          toBinAbsEntry: toLocation.sapIntegration.binAbsEntry,
          items: sapTransferItems,
          comments: `Consignación Vasculares - ${toLocation.name}`,
        });
        console.log('SAP Stock Transfer created:', sapResult);
      } catch (sapError) {
        // SAP failed - return error, save nothing locally
        console.error('SAP Stock Transfer failed:', sapError.message);
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
      const Consignaciones = await getConsignacionesModel(req.companyId);

      // Create consignment record first to get the ID
      const consignacion = new Consignaciones({
        fromLocationId,
        toLocationId,
        status: 'EN_TRANSITO',
        items: processedItems.map((item) => ({
          productId: item.productId,
          loteId: item.loteId || item.lote._id,
          lotNumber: item.lotNumber || item.lote.lotNumber,
          quantitySent: item.quantitySent,
          quantityReceived: null,
          notes: item.notes || '',
        })),
        sapIntegration: {
          pushed: sapEnabled && sapResult?.DocNum ? true : false,
          status: sapEnabled ? 'SYNCED' : null,
          docEntry: sapResult?.DocEntry || null,
          docNum: sapResult?.DocNum || null,
          docType: 'StockTransfers',
          syncDate: sapEnabled ? new Date() : null,
          error: null,
          retryCount: 0,
          retrying: false,
        },
        createdBy: {
          _id: req.user._id,
          firstname: req.user.firstname,
          lastname: req.user.lastname,
          email: req.user.email,
        },
        notes: notes || '',
      });

      await consignacion.save({ session });

      // Process inventory updates for each item
      for (const item of processedItems) {
        const lote = item.lote;
        const toDeduct = item.quantitySent;

        // Update warehouse lote: reduce available, increase consigned
        await Lotes.findByIdAndUpdate(
          lote._id,
          {
            $inc: {
              quantityAvailable: -toDeduct,
              quantityConsigned: toDeduct,
            },
          },
          { session }
        );

        // Create or update centro lote
        const existingCentroLote = await Lotes.findOne({
          productId: item.productId,
          lotNumber: lote.lotNumber,
          currentLocationId: toLocationId,
        }).session(session);

        if (existingCentroLote) {
          await Lotes.findByIdAndUpdate(
            existingCentroLote._id,
            {
              $inc: {
                quantityTotal: toDeduct,
                quantityConsigned: toDeduct,
              },
              $push: {
                historia: {
                  fecha: new Date(),
                  tipo: 'CONSIGNMENT_SENT',
                  cantidad: toDeduct,
                  usuario: `${req.user.firstname} ${req.user.lastname}`,
                  detalles: `In transit from ${fromLocation.name} - Consignment #${consignacion._id}${sapResult ? ` - SAP #${sapResult.DocNum}` : ''}`,
                },
              },
            },
            { session }
          );
        } else {
          const centroLote = new Lotes({
            productId: item.productId,
            lotNumber: lote.lotNumber,
            expiryDate: lote.expiryDate,
            manufactureDate: lote.manufactureDate,
            quantityTotal: toDeduct,
            quantityAvailable: 0,
            quantityConsigned: toDeduct,
            quantityConsumed: 0,
            currentLocationId: toLocationId,
            status: 'ACTIVE',
            receivedDate: new Date(),
            supplier: lote.supplier,
            unitCost: lote.unitCost,
            createdBy: {
              _id: req.user._id,
              firstname: req.user.firstname,
              lastname: req.user.lastname,
            },
            historia: [{
              fecha: new Date(),
              tipo: 'CONSIGNMENT_SENT',
              cantidad: toDeduct,
              usuario: `${req.user.firstname} ${req.user.lastname}`,
              detalles: `In transit from ${fromLocation.name} - Consignment #${consignacion._id}${sapResult ? ` - SAP #${sapResult.DocNum}` : ''}`,
            }],
          });
          await centroLote.save({ session });
        }

        // Create transaction record
        const transaccion = new Transacciones({
          type: 'CONSIGNMENT',
          productId: item.productId,
          lotId: lote._id,
          lotNumber: lote.lotNumber,
          fromLocationId,
          toLocationId,
          quantity: toDeduct,
          notes: `Consignment #${consignacion._id} - ${toLocation.name}${sapResult?.DocNum ? ` - SAP #${sapResult.DocNum}` : ''}`,
          performedBy: {
            _id: req.user._id,
            firstname: req.user.firstname,
            lastname: req.user.lastname,
            email: req.user.email,
          },
          status: 'COMPLETED',
        });
        await transaccion.save({ session });

        // Update inventory aggregations
        await updateInventario(req.companyId, item.productId, fromLocationId, session);
        await updateInventario(req.companyId, item.productId, toLocationId, session);
      }

      await session.commitTransaction();

      // Build response
      const response = {
        message: 'Consignment created successfully',
        consignacion,
      };

      if (sapResult) {
        response.sapDocNum = sapResult.DocNum;
        response.sapDocEntry = sapResult.DocEntry;
      }

      res.status(201).json(response);

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
    console.error('Error creating consignment:', error);
    next(error);
  }
};

/**
 * PUT /api/consignaciones/:id/confirm
 * Confirm receipt of consignment (full or partial)
 * Uses MongoDB transactions to ensure atomicity
 */
exports.confirm = async (req, res, next) => {
  // Start a session for the transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ errors: errors.array() });
    }

    const { items, notes } = req.body; // items: [{ productId, quantityReceived }]

    const Consignaciones = await getConsignacionesModel(req.companyId);
    const consignacion = await Consignaciones.findById(req.params.id).session(session);

    if (!consignacion) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Consignment not found' });
    }

    if (consignacion.status === 'RECIBIDO') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Consignment already confirmed' });
    }

    const Lotes = await getLotesModel(req.companyId);
    const Transacciones = await getTransaccionesModel(req.companyId);

    // Process each item
    for (const receivedItem of items) {
      const consignacionItem = consignacion.items.find(
        (item) => item.productId.toString() === receivedItem.productId
      );

      if (!consignacionItem) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: `Product ${receivedItem.productId} not in consignment` });
      }

      const quantityReceived = receivedItem.quantityReceived;
      const quantitySent = consignacionItem.quantitySent;

      // Validate quantity received
      if (quantityReceived < 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: `Quantity received cannot be negative for product ${receivedItem.productId}`,
        });
      }

      if (quantityReceived > quantitySent) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: `Cannot receive more than sent for product ${receivedItem.productId}`,
        });
      }

      // Update consignment item
      consignacionItem.quantityReceived = quantityReceived;
      consignacionItem.notes = receivedItem.notes || consignacionItem.notes;

      // Find the consignment transactions for this product (FIFO)
      const consignmentTransactions = await Transacciones.find({
        type: 'CONSIGNMENT',
        productId: receivedItem.productId,
        fromLocationId: consignacion.fromLocationId,
        toLocationId: consignacion.toLocationId,
        notes: { $regex: `Consignment #${consignacion._id}` },
      }).sort({ createdAt: 1 }).session(session);

      // Track how much of each transaction has been processed
      const transactionUsage = new Map();

      // If received quantity > 0, convert in-transit to available at centro
      if (quantityReceived > 0) {
        let remainingToReceive = quantityReceived;

        for (const transaction of consignmentTransactions) {
          if (remainingToReceive <= 0) break;

          const toReceive = Math.min(remainingToReceive, transaction.quantity);
          transactionUsage.set(transaction._id.toString(), toReceive);

          // Find the warehouse lote to get lot number
          const warehouseLote = await Lotes.findById(transaction.lotId).session(session);

          if (warehouseLote) {
            // Reduce consigned and total at warehouse (stock now belongs to centro)
            warehouseLote.quantityConsigned -= toReceive;
            warehouseLote.quantityTotal -= toReceive;
            await warehouseLote.save({ session });

            // Find and update the centro lote (should already exist from creation)
            const centroLote = await Lotes.findOne({
              productId: receivedItem.productId,
              lotNumber: warehouseLote.lotNumber,
              currentLocationId: consignacion.toLocationId,
            }).session(session);

            if (centroLote) {
              // Convert consigned to available (in-transit → received)
              centroLote.quantityConsigned -= toReceive;
              centroLote.quantityAvailable += toReceive;

              // Add to historia (ensure array exists)
              if (!centroLote.historia) centroLote.historia = [];
              centroLote.historia.push({
                fecha: new Date(),
                tipo: 'CONSIGNMENT_RECEIPT',
                cantidad: toReceive,
                usuario: `${req.user.firstname} ${req.user.lastname}`,
                detalles: `Receipt confirmed - Consignment #${consignacion._id}`,
              });

              await centroLote.save({ session });
            } else {
              // Fallback: Create new lote if not found (shouldn't happen normally)
              console.warn(`Centro lote not found for ${warehouseLote.lotNumber}, creating new one`);
              const newCentroLote = new Lotes({
                productId: receivedItem.productId,
                lotNumber: warehouseLote.lotNumber,
                expiryDate: warehouseLote.expiryDate,
                manufactureDate: warehouseLote.manufactureDate,
                quantityTotal: toReceive,
                quantityAvailable: toReceive,
                quantityConsigned: 0,
                quantityConsumed: 0,
                currentLocationId: consignacion.toLocationId,
                status: 'ACTIVE',
                receivedDate: new Date(),
                supplier: warehouseLote.supplier,
                unitCost: warehouseLote.unitCost,
                createdBy: {
                  _id: req.user._id,
                  firstname: req.user.firstname,
                  lastname: req.user.lastname,
                },
                historia: [{
                  fecha: new Date(),
                  tipo: 'CONSIGNMENT_RECEIPT',
                  cantidad: toReceive,
                  usuario: `${req.user.firstname} ${req.user.lastname}`,
                  detalles: `Received from warehouse - Consignment #${consignacion._id}`,
                }],
              });
              await newCentroLote.save({ session });
            }
          }

          remainingToReceive -= toReceive;
        }

        // Update centro inventory (convert consigned to available)
        await updateInventario(req.companyId, receivedItem.productId, consignacion.toLocationId, session);
      }

      // If partial receipt, return difference to warehouse
      const difference = quantitySent - quantityReceived;
      if (difference > 0) {
        let remainingToReturn = difference;

        for (const transaction of consignmentTransactions) {
          if (remainingToReturn <= 0) break;

          // Calculate how much of this transaction to return
          // (transaction.quantity minus what was already received)
          const alreadyReceived = transactionUsage.get(transaction._id.toString()) || 0;
          const availableToReturn = transaction.quantity - alreadyReceived;
          const toReturn = Math.min(remainingToReturn, availableToReturn);

          if (toReturn > 0) {
            // Find the warehouse lote
            const warehouseLote = await Lotes.findById(transaction.lotId).session(session);

            if (warehouseLote) {
              // Return to warehouse (reduce consigned, increase available)
              warehouseLote.quantityConsigned -= toReturn;
              warehouseLote.quantityAvailable += toReturn;
              await warehouseLote.save({ session });

              // Remove from centro in-transit (reduce both total and consigned)
              const centroLote = await Lotes.findOne({
                productId: receivedItem.productId,
                lotNumber: warehouseLote.lotNumber,
                currentLocationId: consignacion.toLocationId,
              }).session(session);

              if (centroLote) {
                centroLote.quantityTotal -= toReturn;
                centroLote.quantityConsigned -= toReturn;

                // Add to historia (ensure array exists)
                if (!centroLote.historia) centroLote.historia = [];
                centroLote.historia.push({
                  fecha: new Date(),
                  tipo: 'PARTIAL_RETURN',
                  cantidad: -toReturn,
                  usuario: `${req.user.firstname} ${req.user.lastname}`,
                  detalles: `Partial receipt - returned to warehouse - Consignment #${consignacion._id}`,
                });

                await centroLote.save({ session });
              }

              // Create return transaction
              const returnTransaction = new Transacciones({
                type: 'RETURN',
                productId: receivedItem.productId,
                lotId: warehouseLote._id,
                lotNumber: warehouseLote.lotNumber,
                fromLocationId: consignacion.toLocationId,
                toLocationId: consignacion.fromLocationId,
                quantity: toReturn,
                notes: `Partial receipt return - Consignment #${consignacion._id}`,
                performedBy: {
                  _id: req.user._id,
                  firstname: req.user.firstname,
                  lastname: req.user.lastname,
                  email: req.user.email,
                },
                status: 'COMPLETED',
              });

              await returnTransaction.save({ session });
            }

            remainingToReturn -= toReturn;
          }
        }

        // Update centro inventory to reflect returned items
        await updateInventario(req.companyId, receivedItem.productId, consignacion.toLocationId, session);
      }

      // Update warehouse inventory (handles both receive and return updates)
      await updateInventario(req.companyId, receivedItem.productId, consignacion.fromLocationId, session);
    }

    // Update consignment status
    consignacion.status = 'RECIBIDO';
    consignacion.confirmedAt = new Date();
    consignacion.confirmedBy = {
      _id: req.user._id,
      firstname: req.user.firstname,
      lastname: req.user.lastname,
      email: req.user.email,
    };
    if (notes) consignacion.notes = (consignacion.notes || '') + '\n' + notes;

    await consignacion.save({ session });

    // Commit the transaction - all operations succeeded
    await session.commitTransaction();
    session.endSession();

    res.json({
      message: 'Consignment confirmed successfully',
      consignacion,
    });
  } catch (error) {
    // Abort transaction on any error - all changes are rolled back
    await session.abortTransaction();
    session.endSession();
    console.error('Error confirming consignment:', error);
    next(error);
  }
};

/**
 * POST /api/consignaciones/:id/retry-sap
 * Retry SAP stock transfer for a failed consignment
 *
 * Uses optimistic locking to prevent duplicate SAP documents:
 * 1. Atomically claim the retry by setting status to 'RETRYING'
 * 2. If claim fails, another request is already processing
 * 3. Call SAP and update with result
 */
exports.retrySap = async (req, res, next) => {
  try {
    const Consignaciones = await getConsignacionesModel(req.companyId);
    const Locaciones = await getLocacionesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);

    const MAX_RETRIES = 5;

    // Atomically claim the retry - only succeeds if not already synced or retrying
    // Also check retry count limit
    const consignacion = await Consignaciones.findOneAndUpdate(
      {
        _id: req.params.id,
        'sapIntegration.status': { $nin: ['SYNCED', 'RETRYING'] },
        $or: [
          { 'sapIntegration.retryCount': { $exists: false } },
          { 'sapIntegration.retryCount': { $lt: MAX_RETRIES } },
        ],
      },
      {
        $set: { 'sapIntegration.status': 'RETRYING', 'sapIntegration.retrying': true },
        $inc: { 'sapIntegration.retryCount': 1 },
      },
      { new: true }
    );

    if (!consignacion) {
      // Check why we couldn't claim it
      const existing = await Consignaciones.findById(req.params.id).lean();
      if (!existing) {
        return res.status(404).json({ error: 'Consignación no encontrada' });
      }
      if (existing.sapIntegration?.status === 'SYNCED') {
        return res.status(400).json({ error: 'Esta consignación ya está sincronizada con SAP' });
      }
      if (existing.sapIntegration?.status === 'RETRYING') {
        return res.status(409).json({ error: 'Ya hay un reintento en progreso' });
      }
      if ((existing.sapIntegration?.retryCount || 0) >= MAX_RETRIES) {
        return res.status(400).json({ error: `Se alcanzó el límite de ${MAX_RETRIES} reintentos` });
      }
      return res.status(400).json({ error: 'No se pudo iniciar el reintento' });
    }

    // Get locations for SAP warehouse codes
    const fromLocation = await Locaciones.findById(consignacion.fromLocationId).lean();
    const toLocation = await Locaciones.findById(consignacion.toLocationId).lean();

    if (!fromLocation?.sapIntegration?.warehouseCode || !toLocation?.sapIntegration?.warehouseCode) {
      // Release lock
      await Consignaciones.findByIdAndUpdate(req.params.id, {
        $set: { 'sapIntegration.status': 'FAILED', 'sapIntegration.retrying': false }
      });
      return res.status(400).json({ error: 'Configuración SAP incompleta para las locaciones' });
    }

    // Build SAP transfer items
    const sapTransferItems = [];
    for (const item of consignacion.items) {
      const product = await Productos.findById(item.productId).lean();
      if (product?.sapItemCode) {
        sapTransferItems.push({
          itemCode: product.sapItemCode,
          quantity: item.quantitySent,
          batchNumber: item.lotNumber,
        });
      }
    }

    if (sapTransferItems.length === 0) {
      // Release lock
      await Consignaciones.findByIdAndUpdate(req.params.id, {
        $set: { 'sapIntegration.status': 'FAILED', 'sapIntegration.error': 'No hay productos con código SAP', 'sapIntegration.retrying': false }
      });
      return res.status(400).json({ error: 'No hay productos con código SAP para transferir' });
    }

    // Retry SAP Stock Transfer
    try {
      const sapResult = await sapService.createStockTransfer({
        fromWarehouse: fromLocation.sapIntegration.warehouseCode,
        toWarehouse: toLocation.sapIntegration.warehouseCode,
        toBinAbsEntry: toLocation.sapIntegration.binAbsEntry,
        items: sapTransferItems,
        comments: `Consignación Vasculares - ${toLocation.name} (Retry)`,
      });

      // Update with success
      await Consignaciones.findByIdAndUpdate(req.params.id, {
        $set: {
          'sapIntegration.pushed': true,
          'sapIntegration.status': 'SYNCED',
          'sapIntegration.docEntry': sapResult.DocEntry,
          'sapIntegration.docNum': sapResult.DocNum,
          'sapIntegration.syncDate': new Date(),
          'sapIntegration.error': null,
          'sapIntegration.retrying': false,
        }
      });

      res.json({
        success: true,
        sapDocNum: sapResult.DocNum,
        sapDocEntry: sapResult.DocEntry,
      });
    } catch (sapError) {
      // Update with failure, release lock
      await Consignaciones.findByIdAndUpdate(req.params.id, {
        $set: {
          'sapIntegration.status': 'FAILED',
          'sapIntegration.error': sapError.message,
          'sapIntegration.retrying': false,
        }
      });

      res.status(500).json({
        success: false,
        error: sapError.message,
      });
    }
  } catch (error) {
    console.error('Error retrying SAP sync:', error);
    next(error);
  }
};
