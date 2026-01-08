/**
 * Consignaciones Controller
 * Handle bulk consignments from warehouse to centros
 */
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
 */
async function updateInventario(companyId, productId, locationId) {
  const Inventario = await getInventarioModel(companyId);
  const Lotes = await getLotesModel(companyId);

  // Aggregate all lotes for this product at this location
  const lotes = await Lotes.find({
    productId,
    currentLocationId: locationId,
  });

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
  await Inventario.findOneAndUpdate(
    { productId, locationId },
    {
      $set: {
        ...aggregated,
        lastMovementDate: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
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
 */
exports.create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { fromLocationId, toLocationId, items, notes } = req.body;

    // Validate locations exist
    const Locaciones = await getLocacionesModel(req.companyId);
    const fromLocation = await Locaciones.findById(fromLocationId);
    const toLocation = await Locaciones.findById(toLocationId);

    if (!fromLocation) {
      return res.status(404).json({ error: 'Warehouse location not found' });
    }
    if (!toLocation) {
      return res.status(404).json({ error: 'Centro location not found' });
    }

    // Validate fromLocation is a warehouse
    if (fromLocation.type !== 'WAREHOUSE') {
      return res.status(400).json({ error: 'From location must be a warehouse' });
    }

    const Lotes = await getLotesModel(req.companyId);
    const Transacciones = await getTransaccionesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);

    // Validate all products exist and have sufficient stock
    for (const item of items) {
      const product = await Productos.findById(item.productId);
      if (!product) {
        return res.status(404).json({ error: `Product ${item.productId} not found` });
      }

      // Check available stock at warehouse
      const availableLotes = await Lotes.find({
        productId: item.productId,
        currentLocationId: fromLocationId,
        quantityAvailable: { $gt: 0 },
      }).sort({ expiryDate: 1 }); // FIFO

      const totalAvailable = availableLotes.reduce((sum, lote) => sum + lote.quantityAvailable, 0);

      if (totalAvailable < item.quantitySent) {
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

    await consignacion.save();

    // Deduct stock from warehouse (FIFO)
    for (const item of items) {
      let remaining = item.quantitySent;
      const availableLotes = await Lotes.find({
        productId: item.productId,
        currentLocationId: fromLocationId,
        quantityAvailable: { $gt: 0 },
      }).sort({ expiryDate: 1 }); // FIFO

      for (const lote of availableLotes) {
        if (remaining <= 0) break;

        const toDeduct = Math.min(remaining, lote.quantityAvailable);

        // Update lote
        lote.quantityAvailable -= toDeduct;
        lote.quantityConsigned += toDeduct;
        await lote.save();

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

        await transaccion.save();

        remaining -= toDeduct;
      }

      // Update warehouse inventory
      await updateInventario(req.companyId, item.productId, fromLocationId);
    }

    res.status(201).json({
      message: 'Consignment created successfully',
      consignacion,
    });
  } catch (error) {
    console.error('Error creating consignment:', error);
    next(error);
  }
};

/**
 * PUT /api/consignaciones/:id/confirm
 * Confirm receipt of consignment (full or partial)
 */
exports.confirm = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { items, notes } = req.body; // items: [{ productId, quantityReceived }]

    const Consignaciones = await getConsignacionesModel(req.companyId);
    const consignacion = await Consignaciones.findById(req.params.id);

    if (!consignacion) {
      return res.status(404).json({ error: 'Consignment not found' });
    }

    if (consignacion.status === 'RECIBIDO') {
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
        return res.status(400).json({ error: `Product ${receivedItem.productId} not in consignment` });
      }

      const quantityReceived = receivedItem.quantityReceived;
      const quantitySent = consignacionItem.quantitySent;

      if (quantityReceived > quantitySent) {
        return res.status(400).json({
          error: `Cannot receive more than sent for product ${receivedItem.productId}`,
        });
      }

      // Update consignment item
      consignacionItem.quantityReceived = quantityReceived;
      consignacionItem.notes = receivedItem.notes || consignacionItem.notes;

      // If received quantity > 0, add to centro inventory
      if (quantityReceived > 0) {
        // Find the lotes that were consigned (FIFO from transactions)
        const consignmentTransactions = await Transacciones.find({
          type: 'CONSIGNMENT',
          productId: receivedItem.productId,
          fromLocationId: consignacion.fromLocationId,
          toLocationId: consignacion.toLocationId,
          notes: { $regex: `Consignment #${consignacion._id}` },
        }).sort({ createdAt: 1 });

        let remainingToReceive = quantityReceived;

        for (const transaction of consignmentTransactions) {
          if (remainingToReceive <= 0) break;

          const toReceive = Math.min(remainingToReceive, transaction.quantity);

          // Find the original lote
          const originalLote = await Lotes.findById(transaction.lotId);

          if (originalLote) {
            // Update original lote: reduce consigned, it's now at centro
            originalLote.quantityConsigned -= toReceive;
            originalLote.currentLocationId = consignacion.toLocationId;
            originalLote.quantityAvailable += toReceive;
            await originalLote.save();
          }

          remainingToReceive -= toReceive;
        }

        // Update centro inventory
        await updateInventario(req.companyId, receivedItem.productId, consignacion.toLocationId);
      }

      // If partial receipt, return difference to warehouse
      const difference = quantitySent - quantityReceived;
      if (difference > 0) {
        // Find consigned lotes and return to warehouse
        const consignmentTransactions = await Transacciones.find({
          type: 'CONSIGNMENT',
          productId: receivedItem.productId,
          fromLocationId: consignacion.fromLocationId,
          toLocationId: consignacion.toLocationId,
          notes: { $regex: `Consignment #${consignacion._id}` },
        }).sort({ createdAt: 1 });

        let remainingToReturn = difference;

        for (const transaction of consignmentTransactions) {
          if (remainingToReturn <= 0) break;

          const toReturn = Math.min(remainingToReturn, transaction.quantity);

          // Find the original lote
          const originalLote = await Lotes.findById(transaction.lotId);

          if (originalLote) {
            // Return to warehouse
            originalLote.quantityConsigned -= toReturn;
            originalLote.quantityAvailable += toReturn;
            await originalLote.save();

            // Create return transaction
            const returnTransaction = new Transacciones({
              type: 'RETURN',
              productId: receivedItem.productId,
              lotId: originalLote._id,
              lotNumber: originalLote.lotNumber,
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

            await returnTransaction.save();
          }

          remainingToReturn -= toReturn;
        }

        // Update warehouse inventory
        await updateInventario(req.companyId, receivedItem.productId, consignacion.fromLocationId);
      }
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

    await consignacion.save();

    res.json({
      message: 'Consignment confirmed successfully',
      consignacion,
    });
  } catch (error) {
    console.error('Error confirming consignment:', error);
    next(error);
  }
};
