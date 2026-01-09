/**
 * Locaciones Controller
 * Manage hospitals and warehouses
 */
const { getLocacionesModel } = require('../getModel');
const { validationResult } = require('express-validator');

/**
 * GET /api/locaciones - List all locations
 */
exports.list = async (req, res, next) => {
  try {
    const Locaciones = await getLocacionesModel(req.companyId);

    const { type, active } = req.query;

    // Build query
    let query = {};

    if (type) {
      query.type = type;
    }

    if (active !== undefined) {
      query.active = active === 'true';
    }

    const locaciones = await Locaciones.find(query)
      .sort({ type: 1, name: 1 })
      .lean();

    res.json(locaciones);
  } catch (error) {
    console.error('Error listing locaciones:', error);
    next(error);
  }
};

/**
 * GET /api/locaciones/:id - Get single location
 */
exports.getOne = async (req, res, next) => {
  try {
    const Locaciones = await getLocacionesModel(req.companyId);

    const locacion = await Locaciones.findById(req.params.id).lean();

    if (!locacion) {
      return res.status(404).json({ error: 'Locación no encontrada' });
    }

    res.json(locacion);
  } catch (error) {
    console.error('Error getting locacion:', error);
    next(error);
  }
};

/**
 * POST /api/locaciones - Create new location
 */
exports.create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const Locaciones = await getLocacionesModel(req.companyId);

    const {
      name,
      fullName,
      type,
      address,
      contact,
      stockLimits,
      settings,
      sapIntegration,
      notes
    } = req.body;

    // Check if name already exists
    const existing = await Locaciones.findOne({ name });
    if (existing) {
      return res.status(400).json({ error: 'Ya existe una locación con ese nombre' });
    }

    const locacion = new Locaciones({
      name,
      fullName,
      type,
      address,
      contact,
      stockLimits,
      settings,
      sapIntegration,
      notes,
      active: true,
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
        accion: 'Locación creada'
      }]
    });

    await locacion.save();

    res.status(201).json(locacion);
  } catch (error) {
    console.error('Error creating locacion:', error);
    next(error);
  }
};

/**
 * PUT /api/locaciones/:id - Update location
 */
exports.update = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const Locaciones = await getLocacionesModel(req.companyId);

    const locacion = await Locaciones.findById(req.params.id);

    if (!locacion) {
      return res.status(404).json({ error: 'Locación no encontrada' });
    }

    const {
      name,
      fullName,
      type,
      address,
      contact,
      stockLimits,
      settings,
      sapIntegration,
      notes,
      active
    } = req.body;

    // If changing name, check if new name exists
    if (name && name !== locacion.name) {
      const existing = await Locaciones.findOne({ name });
      if (existing) {
        return res.status(400).json({ error: 'Ya existe una locación con ese nombre' });
      }
    }

    // Update fields
    if (name !== undefined) locacion.name = name;
    if (fullName !== undefined) locacion.fullName = fullName;
    if (type !== undefined) locacion.type = type;
    if (address !== undefined) locacion.address = address;
    if (contact !== undefined) locacion.contact = contact;
    if (stockLimits !== undefined) locacion.stockLimits = stockLimits;
    if (settings !== undefined) locacion.settings = settings;
    if (sapIntegration !== undefined) locacion.sapIntegration = sapIntegration;
    if (notes !== undefined) locacion.notes = notes;
    if (active !== undefined) locacion.active = active;

    // Add to historia
    locacion.historia.push({
      fecha: new Date(),
      user: {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname
      },
      accion: 'Locación actualizada'
    });

    await locacion.save();

    res.json(locacion);
  } catch (error) {
    console.error('Error updating locacion:', error);
    next(error);
  }
};

/**
 * DELETE /api/locaciones/:id - Deactivate location
 */
exports.deactivate = async (req, res, next) => {
  try {
    const Locaciones = await getLocacionesModel(req.companyId);

    const locacion = await Locaciones.findById(req.params.id);

    if (!locacion) {
      return res.status(404).json({ error: 'Locación no encontrada' });
    }

    locacion.active = false;
    locacion.historia.push({
      fecha: new Date(),
      user: {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname
      },
      accion: 'Locación desactivada'
    });

    await locacion.save();

    res.json({ message: 'Locación desactivada', locacion });
  } catch (error) {
    console.error('Error deactivating locacion:', error);
    next(error);
  }
};

/**
 * GET /api/locaciones/tipos - Get list of location types
 */
exports.getTypes = async (req, res, next) => {
  try {
    const types = [
      { value: 'CENTRO', label: 'Centro' },
      { value: 'WAREHOUSE', label: 'Almacén' },
    ];

    res.json(types);
  } catch (error) {
    console.error('Error getting types:', error);
    next(error);
  }
};
