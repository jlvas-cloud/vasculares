/**
 * Productos Controller
 * Manage vascular products catalog (guidewires and stents)
 */
const { getProductosModel } = require('../getModel');
const { validationResult } = require('express-validator');

/**
 * GET /api/productos - List all products
 */
exports.list = async (req, res, next) => {
  try {
    const Productos = await getProductosModel(req.companyId);

    const { category, active, search } = req.query;

    // Build query
    let query = {};

    if (category) {
      query.category = category;
    }

    if (active !== undefined) {
      query.active = active === 'true';
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: parseInt(search) || 0 }
      ];
    }

    const productos = await Productos.find(query)
      .sort({ category: 1, name: 1 })
      .lean();

    res.json(productos);
  } catch (error) {
    console.error('Error listing productos:', error);
    next(error);
  }
};

/**
 * GET /api/productos/:id - Get single product
 */
exports.getOne = async (req, res, next) => {
  try {
    const Productos = await getProductosModel(req.companyId);

    const producto = await Productos.findById(req.params.id).lean();

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(producto);
  } catch (error) {
    console.error('Error getting producto:', error);
    next(error);
  }
};

/**
 * POST /api/productos - Create new product
 */
exports.create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const Productos = await getProductosModel(req.companyId);

    const { name, code, missionCode, category, subcategory, specifications } = req.body;

    // Check if code already exists
    const existing = await Productos.findOne({ code });
    if (existing) {
      return res.status(400).json({ error: 'Código de producto ya existe' });
    }

    const producto = new Productos({
      name,
      code,
      missionCode,
      category,
      subcategory,
      specifications,
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
        accion: 'Producto creado'
      }]
    });

    await producto.save();

    res.status(201).json(producto);
  } catch (error) {
    console.error('Error creating producto:', error);
    next(error);
  }
};

/**
 * PUT /api/productos/:id - Update product
 */
exports.update = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const Productos = await getProductosModel(req.companyId);

    const producto = await Productos.findById(req.params.id);

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const { name, code, missionCode, category, subcategory, specifications, inventorySettings, active } = req.body;

    // If changing code, check if new code exists
    if (code && code !== producto.code) {
      const existing = await Productos.findOne({ code });
      if (existing) {
        return res.status(400).json({ error: 'Código de producto ya existe' });
      }
    }

    // Update fields
    if (name !== undefined) producto.name = name;
    if (code !== undefined) producto.code = code;
    if (missionCode !== undefined) producto.missionCode = missionCode;
    if (category !== undefined) producto.category = category;
    if (subcategory !== undefined) producto.subcategory = subcategory;
    if (specifications !== undefined) producto.specifications = specifications;
    if (inventorySettings !== undefined) {
      producto.inventorySettings = {
        ...producto.inventorySettings,
        ...inventorySettings,
      };
    }
    if (active !== undefined) producto.active = active;

    // Add to historia
    producto.historia.push({
      fecha: new Date(),
      user: {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname
      },
      accion: 'Producto actualizado'
    });

    await producto.save();

    res.json(producto);
  } catch (error) {
    console.error('Error updating producto:', error);
    next(error);
  }
};

/**
 * DELETE /api/productos/:id - Deactivate product
 */
exports.deactivate = async (req, res, next) => {
  try {
    const Productos = await getProductosModel(req.companyId);

    const producto = await Productos.findById(req.params.id);

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    producto.active = false;
    producto.historia.push({
      fecha: new Date(),
      user: {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname
      },
      accion: 'Producto desactivado'
    });

    await producto.save();

    res.json({ message: 'Producto desactivado', producto });
  } catch (error) {
    console.error('Error deactivating producto:', error);
    next(error);
  }
};

/**
 * GET /api/productos/categorias - Get list of categories
 */
exports.getCategories = async (req, res, next) => {
  try {
    const categories = [
      { value: 'GUIAS', label: 'Guías' },
      { value: 'STENTS_CORONARIOS', label: 'Stents Coronarios' },
      { value: 'STENTS_RECUBIERTOS', label: 'Stents Recubiertos' }
    ];

    res.json(categories);
  } catch (error) {
    console.error('Error getting categories:', error);
    next(error);
  }
};
