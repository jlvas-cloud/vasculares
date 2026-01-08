/**
 * Consignaciones Controller
 * Handle bulk consignments from warehouse to centros
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
 * Create bulk consignment
 * Uses MongoDB transactions to ensure atomicity
 */
exports.create = async (req, res, next) => {
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

    const { fromLocationId, toLocationId, items, notes } = req.body;

    // Validate no duplicate products in items array
    const productIds = items.map(item => item.productId);
    const uniqueProductIds = [...new Set(productIds)];
    if (productIds.length !== uniqueProductIds.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Duplicate products in consignment. Each product should appear only once.' });
    }

    // Validate locations exist
    const Locaciones = await getLocacionesModel(req.companyId);
    const fromLocation = await Locaciones.findById(fromLocationId).session(session);
    const toLocation = await Locaciones.findById(toLocationId).session(session);

    if (!fromLocation) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Warehouse location not found' });
    }
    if (!toLocation) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Centro location not found' });
    }

    // Validate fromLocation is a warehouse
    if (fromLocation.type !== 'WAREHOUSE') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'From location must be a warehouse' });
    }

    const Lotes = await getLotesModel(req.companyId);
    const Transacciones = await getTransaccionesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);

    // Validate all products exist and have sufficient stock
    for (const item of items) {
      const product = await Productos.findById(item.productId).session(session);
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: `Product ${item.productId} not found` });
      }

      // Check available stock at warehouse
      const availableLotes = await Lotes.find({
        productId: item.productId,
        currentLocationId: fromLocationId,
        quantityAvailable: { $gt: 0 },
      }).sort({ expiryDate: 1 }).session(session);

      const totalAvailable = availableLotes.reduce((sum, lote) => sum + lote.quantityAvailable, 0);

      if (totalAvailable < item.quantitySent) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}. Available: ${totalAvailable}, Requested: ${item.quantitySent}`,
        });
      }
    }

    // Create consignment record
    const Consignaciones = await getConsignacionesModel(req.companyId);
    const consignacion = new Consignaciones({
      fromLocationId,
      toLocationId,
      status: 'EN_TRANSITO',
      items: items.map((item) => ({
        productId: item.productId,
        quantitySent: item.quantitySent,
        quantityReceived: null,
        notes: item.notes || '',
      })),
      createdBy: {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname,
        email: req.user.email,
      },
      notes: notes || '',
    });

    await consignacion.save({ session });

    // Deduct stock from warehouse and create in-transit inventory at centro (FIFO)
    for (const item of items) {
      let remaining = item.quantitySent;
      const availableLotes = await Lotes.find({
        productId: item.productId,
        currentLocationId: fromLocationId,
        quantityAvailable: { $gt: 0 },
      }).sort({ expiryDate: 1 }).session(session);

      for (const lote of availableLotes) {
        if (remaining <= 0) break;

        const toDeduct = Math.min(remaining, lote.quantityAvailable);

        // Update warehouse lote: reduce available, increase consigned
        lote.quantityAvailable -= toDeduct;
        lote.quantityConsigned += toDeduct;
        await lote.save({ session });

        // Create or update centro lote with "in transit" status (quantityConsigned)
        let centroLote = await Lotes.findOne({
          productId: item.productId,
          lotNumber: lote.lotNumber,
          currentLocationId: toLocationId,
        }).session(session);

        if (centroLote) {
          // Update existing centro lote: increase total and consigned
          centroLote.quantityTotal += toDeduct;
          centroLote.quantityConsigned += toDeduct;

          // Add to historia (ensure array exists)
          if (!centroLote.historia) centroLote.historia = [];
          centroLote.historia.push({
            fecha: new Date(),
            tipo: 'CONSIGNMENT_SENT',
            cantidad: toDeduct,
            usuario: `${req.user.firstname} ${req.user.lastname}`,
            detalles: `In transit from ${fromLocation.name} - Consignment #${consignacion._id}`,
          });

          await centroLote.save({ session });
        } else {
          // Create new lote at centro with consigned status (in transit)
          centroLote = new Lotes({
            productId: item.productId,
            lotNumber: lote.lotNumber,
            expiryDate: lote.expiryDate,
            manufactureDate: lote.manufactureDate,
            quantityTotal: toDeduct,
            quantityAvailable: 0, // Not available yet - in transit
            quantityConsigned: toDeduct, // Shows as "in transit"
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
              detalles: `In transit from ${fromLocation.name} - Consignment #${consignacion._id}`,
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
          notes: `Consignment #${consignacion._id} - ${toLocation.name}`,
          performedBy: {
            _id: req.user._id,
            firstname: req.user.firstname,
            lastname: req.user.lastname,
            email: req.user.email,
          },
          status: 'COMPLETED',
        });

        await transaccion.save({ session });

        remaining -= toDeduct;
      }

      // Update warehouse inventory
      await updateInventario(req.companyId, item.productId, fromLocationId, session);

      // Update centro inventory to show in-transit stock
      await updateInventario(req.companyId, item.productId, toLocationId, session);
    }

    // Commit the transaction - all operations succeeded
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'Consignment created successfully',
      consignacion,
    });
  } catch (error) {
    // Abort transaction on any error - all changes are rolled back
    await session.abortTransaction();
    session.endSession();
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
