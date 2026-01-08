/**
 * Inventario Objetivos Controller
 * Manage target stock levels per product per location
 */
const {
  getInventarioObjetivosModel,
  getProductosModel,
  getLocacionesModel,
} = require('../getModel');

/**
 * GET /api/inventario-objetivos
 * Get all inventory targets, optionally filtered
 */
exports.list = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    const InventarioObjetivos = await getInventarioObjetivosModel(req.companyId);

    const { productId, locationId, active } = req.query;

    const query = {};
    if (productId) query.productId = productId;
    if (locationId) query.locationId = locationId;
    if (active !== undefined) query.active = active === 'true';

    const objetivos = await InventarioObjetivos.find(query)
      .populate('productId', 'name code category specifications')
      .populate('locationId', 'name type')
      .lean();

    res.json(objetivos);
  } catch (error) {
    console.error('Error listing inventory targets:', error);
    next(error);
  }
};

/**
 * GET /api/inventario-objetivos/:id
 * Get single inventory target
 */
exports.getOne = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    const InventarioObjetivos = await getInventarioObjetivosModel(req.companyId);

    const objetivo = await InventarioObjetivos.findById(req.params.id)
      .populate('productId', 'name code category specifications')
      .populate('locationId', 'name type')
      .lean();

    if (!objetivo) {
      return res.status(404).json({ error: 'Target not found' });
    }

    res.json(objetivo);
  } catch (error) {
    console.error('Error getting inventory target:', error);
    next(error);
  }
};

/**
 * POST /api/inventario-objetivos
 * Create or update inventory target for a product/location
 */
exports.upsert = async (req, res, next) => {
  try {
    const InventarioObjetivos = await getInventarioObjetivosModel(req.companyId);

    const {
      productId,
      locationId,
      targetStock,
      reorderPoint,
      minStockLevel,
      notes,
    } = req.body;

    // Check if target already exists for this product/location
    let objetivo = await InventarioObjetivos.findOne({ productId, locationId });

    if (objetivo) {
      // Update existing
      objetivo.targetStock = targetStock !== undefined ? targetStock : objetivo.targetStock;
      objetivo.reorderPoint = reorderPoint !== undefined ? reorderPoint : objetivo.reorderPoint;
      objetivo.minStockLevel = minStockLevel !== undefined ? minStockLevel : objetivo.minStockLevel;
      objetivo.notes = notes !== undefined ? notes : objetivo.notes;
      objetivo.updatedBy = {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname,
      };

      await objetivo.save();

      res.json({
        message: 'Target updated successfully',
        objetivo,
      });
    } else {
      // Create new
      objetivo = new InventarioObjetivos({
        productId,
        locationId,
        targetStock: targetStock || 0,
        reorderPoint: reorderPoint || 0,
        minStockLevel: minStockLevel || 0,
        notes,
        createdBy: {
          _id: req.user._id,
          firstname: req.user.firstname,
          lastname: req.user.lastname,
        },
        active: true,
      });

      await objetivo.save();

      res.status(201).json({
        message: 'Target created successfully',
        objetivo,
      });
    }
  } catch (error) {
    console.error('Error upserting inventory target:', error);
    next(error);
  }
};

/**
 * PUT /api/inventario-objetivos/:id
 * Update inventory target
 */
exports.update = async (req, res, next) => {
  try {
    const InventarioObjetivos = await getInventarioObjetivosModel(req.companyId);

    const {
      targetStock,
      reorderPoint,
      minStockLevel,
      notes,
      active,
    } = req.body;

    const objetivo = await InventarioObjetivos.findById(req.params.id);

    if (!objetivo) {
      return res.status(404).json({ error: 'Target not found' });
    }

    // Update fields
    if (targetStock !== undefined) objetivo.targetStock = targetStock;
    if (reorderPoint !== undefined) objetivo.reorderPoint = reorderPoint;
    if (minStockLevel !== undefined) objetivo.minStockLevel = minStockLevel;
    if (notes !== undefined) objetivo.notes = notes;
    if (active !== undefined) objetivo.active = active;

    objetivo.updatedBy = {
      _id: req.user._id,
      firstname: req.user.firstname,
      lastname: req.user.lastname,
    };

    await objetivo.save();

    res.json({
      message: 'Target updated successfully',
      objetivo,
    });
  } catch (error) {
    console.error('Error updating inventory target:', error);
    next(error);
  }
};

/**
 * DELETE /api/inventario-objetivos/:id
 * Delete (deactivate) inventory target
 */
exports.remove = async (req, res, next) => {
  try {
    const InventarioObjetivos = await getInventarioObjetivosModel(req.companyId);

    const objetivo = await InventarioObjetivos.findById(req.params.id);

    if (!objetivo) {
      return res.status(404).json({ error: 'Target not found' });
    }

    objetivo.active = false;
    objetivo.updatedBy = {
      _id: req.user._id,
      firstname: req.user.firstname,
      lastname: req.user.lastname,
    };

    await objetivo.save();

    res.json({ message: 'Target deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating inventory target:', error);
    next(error);
  }
};
