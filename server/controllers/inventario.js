/**
 * Inventario Controller
 * View inventory levels and lots
 */
const {
  getInventarioModel,
  getLotesModel,
  getProductosModel,
  getLocacionesModel
} = require('../getModel');

/**
 * GET /api/inventario - Get inventory summary
 */
exports.getSummary = async (req, res, next) => {
  try {
    // Ensure all models are registered on the same connection before populate
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);

    const { productId, locationId } = req.query;

    // Build query
    let query = {};
    if (productId) query.productId = productId;
    if (locationId) query.locationId = locationId;

    const inventario = await Inventario.find(query)
      .populate('productId', 'name code category')
      .populate('locationId', 'name type')
      .lean();

    res.json(inventario);
  } catch (error) {
    console.error('Error getting inventory summary:', error);
    next(error);
  }
};

/**
 * GET /api/inventario/location/:locationId - Get inventory at specific location
 */
exports.getByLocation = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);

    const inventario = await Inventario.find({ locationId: req.params.locationId })
      .populate('productId', 'name code category specifications')
      .lean();

    res.json(inventario);
  } catch (error) {
    console.error('Error getting inventory by location:', error);
    next(error);
  }
};

/**
 * GET /api/inventario/product/:productId - Get inventory for specific product
 */
exports.getByProduct = async (req, res, next) => {
  try {
    await getLocacionesModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);

    const inventario = await Inventario.find({ productId: req.params.productId })
      .populate('locationId', 'name type')
      .lean();

    res.json(inventario);
  } catch (error) {
    console.error('Error getting inventory by product:', error);
    next(error);
  }
};

/**
 * GET /api/inventario/alerts - Get low stock and expiry alerts
 */
exports.getAlerts = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);
    const Lotes = await getLotesModel(req.companyId);

    // Low stock alerts (quantityAvailable <= 5)
    const lowStock = await Inventario.find({ quantityAvailable: { $lte: 5, $gt: 0 } })
      .populate('productId', 'name code')
      .populate('locationId', 'name type')
      .lean();

    // Expiring soon lots (within 90 days)
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    const expiringSoon = await Lotes.find({
      expiryDate: { $lte: ninetyDaysFromNow, $gt: new Date() },
      status: 'ACTIVE',
      quantityAvailable: { $gt: 0 }
    })
      .populate('productId', 'name code')
      .populate('currentLocationId', 'name type')
      .lean();

    // Expired lots
    const expired = await Lotes.find({
      expiryDate: { $lte: new Date() },
      status: { $ne: 'EXPIRED' },
      quantityAvailable: { $gt: 0 }
    })
      .populate('productId', 'name code')
      .populate('currentLocationId', 'name type')
      .lean();

    res.json({
      lowStock,
      expiringSoon,
      expired
    });
  } catch (error) {
    console.error('Error getting alerts:', error);
    next(error);
  }
};

/**
 * GET /api/lotes - Get all lots
 */
exports.getLotes = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    const Lotes = await getLotesModel(req.companyId);

    const { productId, locationId, status } = req.query;

    // Build query
    let query = {};
    if (productId) query.productId = productId;
    if (locationId) query.currentLocationId = locationId;
    if (status) query.status = status;

    const lotes = await Lotes.find(query)
      .populate('productId', 'name code category')
      .populate('currentLocationId', 'name type')
      .sort({ expiryDate: 1 })
      .lean();

    res.json(lotes);
  } catch (error) {
    console.error('Error getting lotes:', error);
    next(error);
  }
};

/**
 * GET /api/lotes/location/:locationId - Get lots at specific location
 */
exports.getLotesByLocation = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    const Lotes = await getLotesModel(req.companyId);

    const { productId } = req.query;

    let query = { currentLocationId: req.params.locationId };
    if (productId) query.productId = productId;

    const lotes = await Lotes.find(query)
      .populate('productId', 'name code category specifications')
      .sort({ expiryDate: 1 })
      .lean();

    res.json(lotes);
  } catch (error) {
    console.error('Error getting lotes by location:', error);
    next(error);
  }
};

/**
 * GET /api/lotes/expiring - Get lots expiring soon
 */
exports.getExpiringLotes = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    const Lotes = await getLotesModel(req.companyId);

    const { days = 90 } = req.query;

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(days));

    const lotes = await Lotes.find({
      expiryDate: { $lte: futureDate, $gt: new Date() },
      status: 'ACTIVE',
      quantityAvailable: { $gt: 0 }
    })
      .populate('productId', 'name code')
      .populate('currentLocationId', 'name type')
      .sort({ expiryDate: 1 })
      .lean();

    res.json(lotes);
  } catch (error) {
    console.error('Error getting expiring lotes:', error);
    next(error);
  }
};

/**
 * GET /api/dashboard/stats - Get dashboard statistics
 */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const Productos = await getProductosModel(req.companyId);
    const Locaciones = await getLocacionesModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);
    const Lotes = await getLotesModel(req.companyId);

    // Count products and locations
    const totalProducts = await Productos.countDocuments({ active: true });
    const totalLocations = await Locaciones.countDocuments({ active: true });

    // Aggregate inventory
    const inventarioStats = await Inventario.aggregate([
      {
        $group: {
          _id: null,
          totalAvailable: { $sum: '$quantityAvailable' },
          totalConsigned: { $sum: '$quantityConsigned' },
          totalConsumed: { $sum: '$quantityConsumed' }
        }
      }
    ]);

    const stats = inventarioStats[0] || {
      totalAvailable: 0,
      totalConsigned: 0,
      totalConsumed: 0
    };

    // Count alerts
    const lowStockCount = await Inventario.countDocuments({
      quantityAvailable: { $lte: 5, $gt: 0 }
    });

    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    const expiringSoonCount = await Lotes.countDocuments({
      expiryDate: { $lte: ninetyDaysFromNow, $gt: new Date() },
      status: 'ACTIVE',
      quantityAvailable: { $gt: 0 }
    });

    const expiredCount = await Lotes.countDocuments({
      expiryDate: { $lte: new Date() },
      status: { $ne: 'EXPIRED' },
      quantityAvailable: { $gt: 0 }
    });

    res.json({
      products: totalProducts,
      locations: totalLocations,
      inventory: {
        available: stats.totalAvailable,
        consigned: stats.totalConsigned,
        consumed: stats.totalConsumed
      },
      alerts: {
        lowStock: lowStockCount,
        expiringSoon: expiringSoonCount,
        expired: expiredCount
      }
    });
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    next(error);
  }
};
