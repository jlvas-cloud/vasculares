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
 * POST /api/transacciones/warehouse-receipt - Receive products at warehouse
 */
exports.warehouseReceipt = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      productId,
      locationId,
      lotNumber,
      quantity,
      expiryDate,
      manufactureDate,
      supplier,
      unitCost,
      notes
    } = req.body;

    // Validate product exists
    const Productos = await getProductosModel(req.companyId);
    const producto = await Productos.findById(productId);
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Validate location exists
    const Locaciones = await getLocacionesModel(req.companyId);
    const locacion = await Locaciones.findById(locationId);
    if (!locacion) {
      return res.status(404).json({ error: 'Locación no encontrada' });
    }

    // Check if lot already exists for this product at this location
    // If it exists, we'll add to it (multiple shipments from same lot)
    const Lotes = await getLotesModel(req.companyId);
    let lote = await Lotes.findOne({
      productId,
      lotNumber,
      currentLocationId: locationId
    });

    if (lote) {
      // Lot already exists - validate expiry date matches
      const existingExpiry = new Date(lote.expiryDate).toISOString().split('T')[0];
      const newExpiry = new Date(expiryDate).toISOString().split('T')[0];

      if (existingExpiry !== newExpiry) {
        return res.status(400).json({
          error: `El lote ${lotNumber} ya existe con fecha de vencimiento ${existingExpiry}. La nueva fecha es ${newExpiry}. Verifique el número de lote.`
        });
      }

      // Add to existing lot
      lote.quantityTotal += quantity;
      lote.quantityAvailable += quantity;
      lote.historia.push({
        fecha: new Date(),
        user: {
          _id: req.user._id,
          firstname: req.user.firstname,
          lastname: req.user.lastname
        },
        accion: 'Recepción adicional en almacén',
        detalles: `Cantidad: ${quantity}${supplier ? `, Proveedor: ${supplier}` : ''}`
      });

      await lote.save();
    } else {
      // Create new lot record
      lote = new Lotes({
        productId,
        lotNumber,
        expiryDate: new Date(expiryDate),
        manufactureDate: manufactureDate ? new Date(manufactureDate) : undefined,
        quantityTotal: quantity,
        quantityAvailable: quantity,
        quantityConsigned: 0,
        quantityConsumed: 0,
        currentLocationId: locationId,
        status: 'ACTIVE',
        receivedDate: new Date(),
        supplier,
        unitCost,
        notes,
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
          detalles: `Cantidad: ${quantity}`
        }]
      });

      await lote.save();
    }

    // Create Transaction record
    const Transacciones = await getTransaccionesModel(req.companyId);
    const transaccion = new Transacciones({
      type: 'WAREHOUSE_RECEIPT',
      productId,
      lotId: lote._id,
      lotNumber,
      toLocationId: locationId,
      quantity,
      warehouseReceipt: {
        lotNumber,
        expiryDate: new Date(expiryDate),
        supplier,
        unitCost
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

    // Update Inventario aggregate
    await updateInventario(req.companyId, productId, locationId);

    res.status(201).json({
      message: 'Productos recibidos exitosamente',
      lote,
      transaccion
    });
  } catch (error) {
    console.error('Error in warehouse receipt:', error);
    next(error);
  }
};

/**
 * POST /api/transacciones/consignment-out - Send products on consignment
 */
exports.consignmentOut = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      productId,
      lotId,
      fromLocationId,
      toLocationId,
      quantity,
      notes
    } = req.body;

    // Validate lot exists and has enough quantity
    const Lotes = await getLotesModel(req.companyId);
    const sourceLot = await Lotes.findById(lotId);

    if (!sourceLot) {
      return res.status(404).json({ error: 'Lote no encontrado' });
    }

    if (sourceLot.currentLocationId.toString() !== fromLocationId) {
      return res.status(400).json({ error: 'El lote no está en la locación de origen' });
    }

    if (sourceLot.quantityAvailable < quantity) {
      return res.status(400).json({
        error: `Cantidad insuficiente. Disponible: ${sourceLot.quantityAvailable}`
      });
    }

    // Update source lot
    sourceLot.quantityAvailable -= quantity;
    sourceLot.quantityConsigned += quantity;
    sourceLot.historia.push({
      fecha: new Date(),
      user: {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname
      },
      accion: 'Productos enviados en consignación',
      detalles: `Cantidad: ${quantity} a locación ${toLocationId}`
    });

    if (sourceLot.quantityAvailable === 0 && sourceLot.quantityConsumed === sourceLot.quantityTotal) {
      sourceLot.status = 'DEPLETED';
    }

    await sourceLot.save();

    // Create or update destination lot
    let destLot = await Lotes.findOne({
      productId,
      lotNumber: sourceLot.lotNumber,
      currentLocationId: toLocationId
    });

    if (destLot) {
      // Update existing lot at destination
      destLot.quantityTotal += quantity;
      destLot.quantityAvailable += quantity;
      destLot.quantityConsigned += quantity;
      destLot.historia.push({
        fecha: new Date(),
        user: {
          _id: req.user._id,
          firstname: req.user.firstname,
          lastname: req.user.lastname
        },
        accion: 'Productos recibidos en consignación',
        detalles: `Cantidad: ${quantity}`
      });
      await destLot.save();
    } else {
      // Create new lot at destination
      destLot = new Lotes({
        productId,
        lotNumber: sourceLot.lotNumber,
        expiryDate: sourceLot.expiryDate,
        manufactureDate: sourceLot.manufactureDate,
        quantityTotal: quantity,
        quantityAvailable: quantity,
        quantityConsigned: quantity,
        quantityConsumed: 0,
        currentLocationId: toLocationId,
        status: 'ACTIVE',
        receivedDate: new Date(),
        supplier: sourceLot.supplier,
        unitCost: sourceLot.unitCost,
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
          accion: 'Productos recibidos en consignación',
          detalles: `Cantidad: ${quantity}`
        }]
      });
      await destLot.save();
    }

    // Create Transaction record
    const Transacciones = await getTransaccionesModel(req.companyId);
    const transaccion = new Transacciones({
      type: 'CONSIGNMENT_OUT',
      productId,
      lotId: sourceLot._id,
      lotNumber: sourceLot.lotNumber,
      fromLocationId,
      toLocationId,
      quantity,
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

    // Update Inventario for both locations
    await updateInventario(req.companyId, productId, fromLocationId);
    await updateInventario(req.companyId, productId, toLocationId);

    res.status(201).json({
      message: 'Productos enviados en consignación exitosamente',
      transaccion,
      sourceLot,
      destLot
    });
  } catch (error) {
    console.error('Error in consignment out:', error);
    next(error);
  }
};

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

    const { type, productId, locationId, startDate, endDate, limit = 50 } = req.query;

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
