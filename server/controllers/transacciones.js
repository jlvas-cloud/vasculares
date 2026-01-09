/**
 * Transacciones Controller
 * Handle all inventory movements
 */
const {
  getTransaccionesModel,
  getLotesModel,
  getInventarioModel,
  getProductosModel,
  getLocacionesModel
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

  // Update or create inventory record
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
 * POST /api/transacciones/consumption - Record product consumption
 */
exports.consumption = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      productId,
      lotId,
      locationId,
      quantity,
      patientInfo,
      procedureInfo,
      doctorName,
      notes
    } = req.body;

    // Validate lot exists and has enough quantity
    const Lotes = await getLotesModel(req.companyId);
    const lote = await Lotes.findById(lotId);

    if (!lote) {
      return res.status(404).json({ error: 'Lote no encontrado' });
    }

    if (lote.currentLocationId.toString() !== locationId) {
      return res.status(400).json({ error: 'El lote no está en esta locación' });
    }

    if (lote.quantityAvailable < quantity) {
      return res.status(400).json({
        error: `Cantidad insuficiente. Disponible: ${lote.quantityAvailable}`
      });
    }

    // Safety check: quantityConsigned should not go negative
    const newConsigned = (lote.quantityConsigned || 0) - quantity;
    if (newConsigned < 0) {
      // This shouldn't happen in normal flow, but prevents data corruption
      return res.status(400).json({
        error: `Error de consistencia: el lote tiene ${lote.quantityConsigned} unidades consignadas pero se intentan consumir ${quantity}`
      });
    }

    // Update lot
    lote.quantityAvailable -= quantity;
    lote.quantityConsigned -= quantity;
    lote.quantityConsumed += quantity;
    lote.historia.push({
      fecha: new Date(),
      user: {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname
      },
      accion: 'Productos consumidos',
      detalles: `Cantidad: ${quantity}`
    });

    if (lote.quantityAvailable === 0) {
      lote.status = 'DEPLETED';
    }

    await lote.save();

    // Create Transaction record
    const Transacciones = await getTransaccionesModel(req.companyId);
    const transaccion = new Transacciones({
      type: 'CONSUMPTION',
      productId,
      lotId: lote._id,
      lotNumber: lote.lotNumber,
      toLocationId: locationId,
      quantity,
      consumption: {
        patientInfo,
        procedureInfo,
        doctorName
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

    // Update Inventario
    await updateInventario(req.companyId, productId, locationId);

    res.status(201).json({
      message: 'Consumo registrado exitosamente',
      transaccion,
      lote
    });
  } catch (error) {
    console.error('Error recording consumption:', error);
    next(error);
  }
};

/**
 * GET /api/transacciones - List transactions
 */
exports.list = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    const Transacciones = await getTransaccionesModel(req.companyId);

    const { type, productId, locationId, startDate, endDate, sapSync, limit = 50 } = req.query;

    // Build query
    let query = {};

    if (type) {
      query.type = type;
    }

    if (productId) {
      query.productId = productId;
    }

    if (locationId) {
      query.$or = [
        { fromLocationId: locationId },
        { toLocationId: locationId }
      ];
    }

    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(endDate);
    }

    // Filter by SAP sync status
    if (sapSync === 'synced') {
      query['sapIntegration.pushed'] = true;
    } else if (sapSync === 'failed') {
      query['sapIntegration.pushed'] = false;
      query['sapIntegration.error'] = { $exists: true, $ne: null };
    }

    const transacciones = await Transacciones.find(query)
      .sort({ transactionDate: -1 })
      .limit(parseInt(limit))
      .populate('productId', 'name code category')
      .populate('fromLocationId', 'name type')
      .populate('toLocationId', 'name type')
      .lean();

    res.json(transacciones);
  } catch (error) {
    console.error('Error listing transactions:', error);
    next(error);
  }
};

/**
 * GET /api/transacciones/:id - Get single transaction
 */
exports.getOne = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    await getLotesModel(req.companyId);
    const Transacciones = await getTransaccionesModel(req.companyId);

    const transaccion = await Transacciones.findById(req.params.id)
      .populate('productId')
      .populate('fromLocationId')
      .populate('toLocationId')
      .populate('lotId')
      .lean();

    if (!transaccion) {
      return res.status(404).json({ error: 'Transacción no encontrada' });
    }

    res.json(transaccion);
  } catch (error) {
    console.error('Error getting transaction:', error);
    next(error);
  }
};
