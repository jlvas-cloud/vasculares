/**
 * Analytics Controller
 * Provides consumption analytics and inventory insights
 */
const {
  getTransaccionesModel,
  getProductosModel,
  getLocacionesModel,
  getInventarioModel,
} = require('../getModel');

/**
 * GET /api/analytics/consumption/monthly
 * Get monthly consumption data per product
 */
exports.getMonthlyConsumption = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    const { getConsumosModel } = require('../getModel');
    const Consumos = await getConsumosModel(req.companyId);

    const { productId, startDate, endDate, year } = req.query;

    // Build date range
    let dateFilter = {};
    if (year) {
      dateFilter = {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31T23:59:59`),
      };
    } else if (startDate || endDate) {
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);
    } else {
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      dateFilter.$gte = twelveMonthsAgo;
    }

    // Build match criteria on Consumos collection
    const matchCriteria = { createdAt: dateFilter };

    // Aggregate by month and product from Consumos
    const pipeline = [
      { $match: matchCriteria },
      { $unwind: '$items' },
    ];

    if (productId) {
      const mongoose = require('mongoose');
      pipeline.push({ $match: { 'items.productId': new mongoose.Types.ObjectId(productId) } });
    }

    pipeline.push(
      {
        $group: {
          _id: {
            productId: '$items.productId',
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          totalQuantity: { $sum: '$items.quantity' },
          transactionCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'productos',
          localField: '_id.productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: 0,
          productId: '$_id.productId',
          productName: '$product.name',
          productCode: '$product.code',
          productSize: '$product.specifications.size',
          year: '$_id.year',
          month: '$_id.month',
          totalQuantity: 1,
          transactionCount: 1,
        },
      },
      { $sort: { year: 1, month: 1, productName: 1 } },
    );

    const monthlyData = await Consumos.aggregate(pipeline);
    res.json(monthlyData);
  } catch (error) {
    console.error('Error getting monthly consumption:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/consumption/by-location
 * Get consumption data grouped by location
 */
exports.getConsumptionByLocation = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getLocacionesModel(req.companyId);
    const { getConsumosModel } = require('../getModel');
    const Consumos = await getConsumosModel(req.companyId);

    const { productId, locationId, startDate, endDate } = req.query;

    // Build date range (default to last 3 months)
    let dateFilter = {};
    if (startDate || endDate) {
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);
    } else {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      dateFilter.$gte = threeMonthsAgo;
    }

    const mongoose = require('mongoose');
    const matchCriteria = { createdAt: dateFilter };
    if (locationId) matchCriteria.centroId = new mongoose.Types.ObjectId(locationId);

    const pipeline = [
      { $match: matchCriteria },
      { $unwind: '$items' },
    ];

    if (productId) {
      pipeline.push({ $match: { 'items.productId': new mongoose.Types.ObjectId(productId) } });
    }

    pipeline.push(
      {
        $group: {
          _id: {
            locationId: '$centroId',
            productId: '$items.productId',
          },
          totalQuantity: { $sum: '$items.quantity' },
          transactionCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'locaciones',
          localField: '_id.locationId',
          foreignField: '_id',
          as: 'location',
        },
      },
      { $unwind: '$location' },
      {
        $lookup: {
          from: 'productos',
          localField: '_id.productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: 0,
          locationId: '$_id.locationId',
          locationName: '$location.name',
          locationType: '$location.type',
          productId: '$_id.productId',
          productName: '$product.name',
          productCode: '$product.code',
          productSize: '$product.specifications.size',
          totalQuantity: 1,
          transactionCount: 1,
        },
      },
      { $sort: { locationName: 1, productName: 1 } },
    );

    const locationData = await Consumos.aggregate(pipeline);
    res.json(locationData);
  } catch (error) {
    console.error('Error getting consumption by location:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/consumption/trends
 * Get consumption trends and averages per product
 */
exports.getConsumptionTrends = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    await getInventarioModel(req.companyId);
    const { getConsumosModel } = require('../getModel');
    const Consumos = await getConsumosModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);

    const { months = 3 } = req.query; // Default to 3 months

    // Calculate date range
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    // Get consumption per product with averages from Consumos
    const trends = await Consumos.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          totalConsumed: { $sum: '$items.quantity' },
          transactionCount: { $sum: 1 },
          firstTransaction: { $min: '$createdAt' },
          lastTransaction: { $max: '$createdAt' },
        },
      },
      {
        $lookup: {
          from: 'productos',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $addFields: {
          daysActive: {
            $divide: [
              { $subtract: ['$lastTransaction', '$firstTransaction'] },
              1000 * 60 * 60 * 24,
            ],
          },
          monthsAnalyzed: parseInt(months),
        },
      },
      {
        $addFields: {
          avgMonthlyConsumption: {
            $cond: {
              if: { $gt: ['$monthsAnalyzed', 0] },
              then: { $divide: ['$totalConsumed', '$monthsAnalyzed'] },
              else: 0,
            },
          },
          avgPerTransaction: {
            $cond: {
              if: { $gt: ['$transactionCount', 0] },
              then: { $divide: ['$totalConsumed', '$transactionCount'] },
              else: 0,
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          productId: '$_id',
          productName: '$product.name',
          productCode: '$product.code',
          productSize: '$product.specifications.size',
          category: '$product.category',
          totalConsumed: 1,
          transactionCount: 1,
          avgMonthlyConsumption: { $round: ['$avgMonthlyConsumption', 2] },
          avgPerTransaction: { $round: ['$avgPerTransaction', 2] },
          firstTransaction: 1,
          lastTransaction: 1,
          monthsAnalyzed: 1,
        },
      },
      { $sort: { totalConsumed: -1 } },
    ]);

    // Get current stock levels for each product
    const stockLevels = await Inventario.aggregate([
      {
        $group: {
          _id: '$productId',
          totalAvailable: { $sum: '$quantityAvailable' },
          totalConsigned: { $sum: '$quantityConsigned' },
        },
      },
    ]);

    // Merge stock data with trends
    const stockMap = {};
    stockLevels.forEach((item) => {
      stockMap[item._id.toString()] = item;
    });

    const enrichedTrends = trends.map((trend) => {
      const stock = stockMap[trend.productId.toString()] || {
        totalAvailable: 0,
        totalConsigned: 0,
      };

      // Calculate days of coverage (stock / avg monthly consumption * 30)
      const daysOfCoverage =
        trend.avgMonthlyConsumption > 0
          ? Math.round(
              (stock.totalAvailable / trend.avgMonthlyConsumption) * 30
            )
          : 999;

      return {
        ...trend,
        currentStock: stock.totalAvailable,
        currentConsigned: stock.totalConsigned,
        daysOfCoverage,
        status:
          daysOfCoverage < 15
            ? 'critical'
            : daysOfCoverage < 30
            ? 'warning'
            : 'ok',
      };
    });

    res.json(enrichedTrends);
  } catch (error) {
    console.error('Error getting consumption trends:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/consumption/by-size
 * Get consumption grouped by product size
 */
exports.getConsumptionBySize = async (req, res, next) => {
  try {
    await getProductosModel(req.companyId);
    const { getConsumosModel } = require('../getModel');
    const Consumos = await getConsumosModel(req.companyId);

    const { category, startDate, endDate } = req.query;

    // Build date range (default to last 3 months)
    let dateFilter = {};
    if (startDate || endDate) {
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);
    } else {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      dateFilter.$gte = threeMonthsAgo;
    }

    const matchCriteria = { createdAt: dateFilter };

    // Aggregate by size from Consumos
    const sizeData = await Consumos.aggregate([
      { $match: matchCriteria },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'productos',
          localField: 'items.productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      ...(category
        ? [{ $match: { 'product.category': category } }]
        : []),
      {
        $group: {
          _id: {
            size: '$product.specifications.size',
            category: '$product.category',
          },
          totalQuantity: { $sum: '$items.quantity' },
          transactionCount: { $sum: 1 },
          products: { $addToSet: '$product.name' },
        },
      },
      {
        $project: {
          _id: 0,
          size: '$_id.size',
          category: '$_id.category',
          totalQuantity: 1,
          transactionCount: 1,
          productCount: { $size: '$products' },
          avgPerTransaction: {
            $cond: {
              if: { $gt: ['$transactionCount', 0] },
              then: {
                $round: [
                  { $divide: ['$totalQuantity', '$transactionCount'] },
                  2,
                ],
              },
              else: 0,
            },
          },
        },
      },
      { $sort: { category: 1, size: 1 } },
    ]);

    res.json(sizeData);
  } catch (error) {
    console.error('Error getting consumption by size:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/planning-data
 * Get comprehensive planning data for all products
 * Supports both warehouse view and per-location view
 * @query category - Filter by product category
 * @query locationId - Get data for specific location (if not provided, shows warehouse data)
 */
exports.getPlanningData = async (req, res, next) => {
  try {
    const { getInventarioObjetivosModel, getPedidosModel } = require('../getModel');

    const Locaciones = await getLocacionesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);
    const Transacciones = await getTransaccionesModel(req.companyId);
    const InventarioObjetivos = await getInventarioObjetivosModel(req.companyId);
    const Pedidos = await getPedidosModel(req.companyId);

    const { category, locationId } = req.query;
    const isLocationView = !!locationId;

    // Get location details if viewing specific location
    let viewedLocation = null;
    let isViewingWarehouse = false;
    if (isLocationView) {
      viewedLocation = await Locaciones.findById(locationId).lean();
      isViewingWarehouse = viewedLocation?.type === 'WAREHOUSE';
    }

    // Helper to get diameter/length - uses numeric fields, falls back to parsing size string
    const getDimensions = (product) => {
      const specs = product.specifications || {};
      // Use numeric fields if available
      if (specs.diameter != null && specs.length != null) {
        return { diameter: specs.diameter, length: specs.length };
      }
      // Fallback: parse size string (e.g., "2.25/13")
      if (specs.size && typeof specs.size === 'string') {
        const parts = specs.size.split('/');
        return {
          diameter: parseFloat(parts[0]) || 999,
          length: parseFloat(parts[1]) || 999,
        };
      }
      return { diameter: 999, length: 999 }; // Sort products without size at the end
    };

    // Get all products with filters
    const productQuery = { active: true };
    if (category) productQuery.category = category;

    let products = await Productos.find(productQuery).lean();

    // Sort by: category, name (product line), diameter, then length
    products.sort((a, b) => {
      // First by category
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      // Then by product name (e.g., "Orsiro" before "Resolute")
      const nameA = a.name.split(' ')[0] || a.name;
      const nameB = b.name.split(' ')[0] || b.name;
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB);
      }
      // Then by diameter
      const dimA = getDimensions(a);
      const dimB = getDimensions(b);
      if (dimA.diameter !== dimB.diameter) {
        return dimA.diameter - dimB.diameter;
      }
      // Finally by length
      return dimA.length - dimB.length;
    });

    // Get stock levels per product
    const mongoose = require('mongoose');
    let stockLevels;
    let warehouseStockLevels = {}; // For location view: warehouse stock per product (for consignment availability)
    let centroStocksByLocation = {}; // For warehouse view: centro stocks per product per location

    if (isLocationView) {
      // Stock at specific location (including in-transit)
      stockLevels = await Inventario.aggregate([
        { $match: { locationId: new mongoose.Types.ObjectId(locationId) } },
        {
          $group: {
            _id: '$productId',
            locationStock: { $sum: '$quantityAvailable' },
            inTransit: { $sum: '$quantityConsigned' }, // Stock sent but not yet confirmed
          },
        },
      ]);

      // Also get warehouse stock for all products (to show availability for consignment)
      const warehouseStockData = await Inventario.aggregate([
        {
          $lookup: {
            from: 'locaciones',
            localField: 'locationId',
            foreignField: '_id',
            as: 'location',
          },
        },
        { $unwind: '$location' },
        { $match: { 'location.type': 'WAREHOUSE' } },
        {
          $group: {
            _id: '$productId',
            warehouseStock: { $sum: '$quantityAvailable' },
          },
        },
      ]);

      // Create map for warehouse stock
      warehouseStockData.forEach((item) => {
        warehouseStockLevels[item._id.toString()] = item.warehouseStock;
      });
    } else {
      // Warehouse view with consigned breakdown
      stockLevels = await Inventario.aggregate([
        {
          $lookup: {
            from: 'locaciones',
            localField: 'locationId',
            foreignField: '_id',
            as: 'location',
          },
        },
        { $unwind: '$location' },
        {
          $group: {
            _id: '$productId',
            warehouseStock: {
              $sum: {
                $cond: [
                  { $eq: ['$location.type', 'WAREHOUSE'] },
                  '$quantityAvailable',
                  0,
                ],
              },
            },
            warehouseInTransit: {
              $sum: {
                $cond: [
                  { $eq: ['$location.type', 'WAREHOUSE'] },
                  '$quantityConsigned', // Stock sent out from warehouse, not yet confirmed
                  0,
                ],
              },
            },
            consignedStock: {
              $sum: {
                $cond: [
                  { $eq: ['$location.type', 'CENTRO'] },
                  '$quantityAvailable',
                  0,
                ],
              },
            },
            totalStock: { $sum: '$quantityAvailable' },
          },
        },
      ]);

      // Also get per-centro stock breakdown for calculating system-wide needs
      const centroStockData = await Inventario.aggregate([
        {
          $lookup: {
            from: 'locaciones',
            localField: 'locationId',
            foreignField: '_id',
            as: 'location',
          },
        },
        { $unwind: '$location' },
        { $match: { 'location.type': 'CENTRO' } },
        {
          $group: {
            _id: {
              productId: '$productId',
              locationId: '$locationId',
            },
            centroStock: { $sum: '$quantityAvailable' },
          },
        },
      ]);

      // Create map for centro stocks: { productId: { locationId: stock } }
      centroStockData.forEach((item) => {
        const prodId = item._id.productId.toString();
        const locId = item._id.locationId.toString();
        if (!centroStocksByLocation[prodId]) {
          centroStocksByLocation[prodId] = {};
        }
        centroStocksByLocation[prodId][locId] = item.centroStock;
      });
    }

    // Calculate consumption/outflow averages (up to 12 months, adaptive based on available data)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    let consumptionData;

    // If viewing specific location:
    // - Warehouse: calculate outflow (CONSIGNMENT transactions FROM warehouse) — uses Transacciones
    // - Centro: calculate consumption — uses Consumos collection
    // - Aggregated warehouse view: calculate total system consumption — uses Consumos collection
    if (isLocationView && isViewingWarehouse) {
      // Warehouse outflow: consignments from this warehouse (Transacciones has these)
      consumptionData = await Transacciones.aggregate([
        {
          $match: {
            type: 'CONSIGNMENT',
            fromLocationId: new mongoose.Types.ObjectId(locationId),
            transactionDate: { $gte: twelveMonthsAgo },
          },
        },
        {
          $group: {
            _id: '$productId',
            totalConsumed: { $sum: '$quantity' },
            firstTransaction: { $min: '$transactionDate' },
            lastTransaction: { $max: '$transactionDate' },
          },
        },
        {
          $addFields: {
            monthsOfHistory: {
              $max: [1, { $ceil: { $divide: [{ $subtract: ['$lastTransaction', '$firstTransaction'] }, 1000 * 60 * 60 * 24 * 30] } }],
            },
          },
        },
        { $addFields: { avgMonthlyConsumption: { $divide: ['$totalConsumed', '$monthsOfHistory'] } } },
      ]);
    } else {
      // Centro or aggregated view: query Consumos collection
      const { getConsumosModel } = require('../getModel');
      const Consumos = await getConsumosModel(req.companyId);

      const consumosMatch = { createdAt: { $gte: twelveMonthsAgo } };
      if (isLocationView) {
        // Specific centro
        consumosMatch.centroId = new mongoose.Types.ObjectId(locationId);
      }

      consumptionData = await Consumos.aggregate([
        { $match: consumosMatch },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            totalConsumed: { $sum: '$items.quantity' },
            firstTransaction: { $min: '$createdAt' },
            lastTransaction: { $max: '$createdAt' },
          },
        },
        {
          $addFields: {
            monthsOfHistory: {
              $max: [1, { $ceil: { $divide: [{ $subtract: ['$lastTransaction', '$firstTransaction'] }, 1000 * 60 * 60 * 24 * 30] } }],
            },
          },
        },
        { $addFields: { avgMonthlyConsumption: { $divide: ['$totalConsumed', '$monthsOfHistory'] } } },
      ]);
    }

    // Get per-location targets
    let locationTargets = {};
    let allLocationTargets = []; // For warehouse view, get all centro targets

    if (isLocationView) {
      const targets = await InventarioObjetivos.find({
        locationId,
        active: true,
      }).lean();

      targets.forEach((target) => {
        locationTargets[target.productId.toString()] = target;
      });
    } else {
      // Warehouse view: get all centro targets to calculate total needs
      allLocationTargets = await InventarioObjetivos.find({
        active: true,
      })
        .populate('locationId', 'type')
        .lean();
    }

    // Get pending orders per product (for warehouse view)
    // Aggregates quantities from PENDIENTE and PARCIAL pedidos
    let pendingOrdersByProduct = {};
    if (!isLocationView) {
      const pendingPedidos = await Pedidos.find({
        companyId: req.companyId,
        status: { $in: ['PENDIENTE', 'PARCIAL'] },
      }).lean();

      for (const pedido of pendingPedidos) {
        for (const item of pedido.items) {
          const pending = Math.max(0, item.quantityOrdered - item.quantityReceived);
          if (pending > 0) {
            const productId = item.productId.toString();
            pendingOrdersByProduct[productId] = (pendingOrdersByProduct[productId] || 0) + pending;
          }
        }
      }
    }

    // Create maps for easy lookup
    const stockMap = {};
    stockLevels.forEach((item) => {
      stockMap[item._id.toString()] = item;
    });

    const consumptionMap = {};
    consumptionData.forEach((item) => {
      consumptionMap[item._id.toString()] = item;
    });

    // Combine all data
    const planningData = products.map((product) => {
      const consumption = consumptionMap[product._id.toString()] || {
        avgMonthlyConsumption: 0,
      };

      let result = {
        productId: product._id,
        name: product.name,
        code: product.code,
        category: product.category,
        size: product.specifications?.size || 'N/A',
        avgMonthlyConsumption: Math.round(consumption.avgMonthlyConsumption * 100) / 100,
      };

      // Helper to calculate status based on percentage of target
      const calculateStatus = (current, target) => {
        if (target === 0) return 'sin_configurar';
        const percentage = (current / target) * 100;
        if (percentage < 50) return 'critical';
        if (percentage < 75) return 'warning';
        return 'ok';
      };

      if (isLocationView) {
        // Location-specific view
        const stock = stockMap[product._id.toString()] || { locationStock: 0, inTransit: 0 };
        const locationTarget = locationTargets[product._id.toString()];
        const warehouseStock = warehouseStockLevels[product._id.toString()] || 0;

        const currentStock = stock.locationStock;
        const inTransit = stock.inTransit || 0; // Stock sent to this location but not yet confirmed
        const targetStock = locationTarget?.targetStock || 0;

        // Calculate suggested consignment = Stock Objetivo - (Stock Actual + En Tránsito)
        // Don't suggest more if stock is already on the way
        const effectiveStock = currentStock + inTransit;
        const suggestedConsignment = Math.max(0, targetStock - effectiveStock);

        // Calculate coverage days
        const daysOfCoverage =
          consumption.avgMonthlyConsumption > 0
            ? Math.round((currentStock / consumption.avgMonthlyConsumption) * 30)
            : 999;

        result = {
          ...result,
          currentStock,
          inTransit, // Stock in transit to this location
          warehouseStock, // Available in warehouse for consignment
          targetStock,
          suggestedConsignment,
          daysOfCoverage,
          status: calculateStatus(currentStock, targetStock),
          hasTarget: !!locationTarget,
        };
      } else {
        // Warehouse view - Option 1: System-wide calculation
        const stock = stockMap[product._id.toString()] || {
          warehouseStock: 0,
          warehouseInTransit: 0,
          consignedStock: 0,
          totalStock: 0,
        };

        const warehouseInTransit = stock.warehouseInTransit || 0; // Stock sent from warehouse, not yet confirmed
        const settings = product.inventorySettings || {};
        const warehouseTarget = settings.targetStockWarehouse || 0;

        // Get all centro targets and stocks for this product
        const centroTargetsForProduct = allLocationTargets.filter(
          (t) => t.productId.toString() === product._id.toString() &&
                 t.locationId?.type !== 'WAREHOUSE' // Only centro targets
        );

        const centroStocksMap = centroStocksByLocation[product._id.toString()] || {};

        // Calculate centro deficits individually (stock is NOT fungible between centros)
        // A surplus at CDC cannot help a deficit at CECANOR
        let totalCentroDeficit = 0;
        let totalCentroTargets = 0;

        centroTargetsForProduct.forEach((target) => {
          const centroTarget = target.targetStock || 0;
          const locId = target.locationId._id.toString();
          const centroStock = centroStocksMap[locId] || 0;
          totalCentroTargets += centroTarget;
          // Only count deficits, not surpluses (surplus can't help other centros)
          totalCentroDeficit += Math.max(0, centroTarget - centroStock);
        });

        // Get pending orders for this product
        const pendingOrders = pendingOrdersByProduct[product._id.toString()] || 0;

        // Correct formula:
        // suggestedOrder = centroDeficits + warehouseTarget - warehouseStock - pendingOrders
        // This avoids double-counting because warehouse stock can cover either
        // its own target OR centro deficits (it's the flexible pool)
        const suggestedOrder = Math.max(0,
          totalCentroDeficit + warehouseTarget - stock.warehouseStock - pendingOrders
        );

        // Calculate coverage days based on warehouse stock only
        const daysOfCoverage =
          consumption.avgMonthlyConsumption > 0
            ? Math.round((stock.warehouseStock / consumption.avgMonthlyConsumption) * 30)
            : 999;

        result = {
          ...result,
          warehouseStock: stock.warehouseStock,
          warehouseInTransit, // Stock sent from warehouse, awaiting confirmation (consignaciones)
          pendingOrders, // Orders to supplier not yet received
          consignedStock: stock.consignedStock,
          totalStock: stock.totalStock,
          targetStock: warehouseTarget, // Show warehouse target in column
          totalCentroDeficit, // Centro needs (for debugging/display)
          suggestedOrder,
          daysOfCoverage,
          status: calculateStatus(stock.warehouseStock, warehouseTarget),
        };
      }

      return result;
    });

    res.json(planningData);
  } catch (error) {
    console.error('Error getting planning data:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/monthly-movements
 * Get per-product monthly consumption at a specific centro over trailing 12 months
 * @query centroId - Required: centro location ID
 * @query category - Optional: filter by product category
 */
exports.getMonthlyMovements = async (req, res, next) => {
  try {
    const { getInventarioObjetivosModel } = require('../getModel');
    const mongoose = require('mongoose');

    const { getConsumosModel } = require('../getModel');

    const Productos = await getProductosModel(req.companyId);
    const Consumos = await getConsumosModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);
    const InventarioObjetivos = await getInventarioObjetivosModel(req.companyId);

    const { centroId, category } = req.query;

    if (!centroId) {
      return res.status(400).json({ error: 'centroId is required' });
    }

    // Build trailing 12 months labels
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }

    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // Aggregate from Consumos collection (unwind items to get per-product data)
    const consumptionData = await Consumos.aggregate([
      {
        $match: {
          centroId: new mongoose.Types.ObjectId(centroId),
          createdAt: { $gte: twelveMonthsAgo },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            productId: '$items.productId',
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          quantity: { $sum: '$items.quantity' },
        },
      },
    ]);

    // Build lookup: productId -> { "YYYY-MM": quantity }
    const consumptionByProduct = {};
    for (const row of consumptionData) {
      const pid = row._id.productId.toString();
      if (!consumptionByProduct[pid]) consumptionByProduct[pid] = {};
      const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`;
      consumptionByProduct[pid][key] = row.quantity;
    }

    // Get all products
    const productQuery = { active: true };
    if (category) productQuery.category = category;
    const products = await Productos.find(productQuery).lean();

    // Sort by category, name, diameter, length (same as planning)
    const getDimensions = (product) => {
      const specs = product.specifications || {};
      if (specs.diameter != null && specs.length != null) {
        return { diameter: specs.diameter, length: specs.length };
      }
      if (specs.size && typeof specs.size === 'string') {
        const parts = specs.size.split('/');
        return {
          diameter: parseFloat(parts[0]) || 999,
          length: parseFloat(parts[1]) || 999,
        };
      }
      return { diameter: 999, length: 999 };
    };

    products.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      const nameA = a.name.split(' ')[0] || a.name;
      const nameB = b.name.split(' ')[0] || b.name;
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      const dimA = getDimensions(a);
      const dimB = getDimensions(b);
      if (dimA.diameter !== dimB.diameter) return dimA.diameter - dimB.diameter;
      return dimA.length - dimB.length;
    });

    // Get stock at this centro
    const stockData = await Inventario.aggregate([
      { $match: { locationId: new mongoose.Types.ObjectId(centroId) } },
      {
        $group: {
          _id: '$productId',
          currentStock: { $sum: '$quantityAvailable' },
        },
      },
    ]);
    const stockByProduct = {};
    for (const s of stockData) {
      stockByProduct[s._id.toString()] = s.currentStock;
    }

    // Get target stocks for this centro
    const targets = await InventarioObjetivos.find({
      locationId: centroId,
      active: true,
    }).lean();
    const targetByProduct = {};
    for (const t of targets) {
      targetByProduct[t.productId.toString()] = t.targetStock;
    }

    // Build response items
    const calculateStatus = (current, target) => {
      if (target === 0) return 'sin_configurar';
      const pct = (current / target) * 100;
      if (pct < 50) return 'critical';
      if (pct < 75) return 'warning';
      return 'ok';
    };

    const items = products.map((p) => {
      const pid = p._id.toString();
      const monthlyData = {};
      let total = 0;

      for (const m of months) {
        const qty = (consumptionByProduct[pid] && consumptionByProduct[pid][m.key]) || 0;
        monthlyData[m.key] = qty;
        total += qty;
      }

      const average = Math.round((total / 12) * 100) / 100;
      const currentStock = stockByProduct[pid] || 0;
      const targetStock = targetByProduct[pid] || 0;

      return {
        productId: pid,
        productName: p.name,
        sapItemCode: p.sapItemCode || p.code,
        category: p.category,
        size: p.specifications?.size || '',
        monthlyData,
        total,
        average,
        currentStock,
        targetStock,
        status: calculateStatus(currentStock, targetStock),
      };
    });

    res.json({
      months: months.map((m) => m.key),
      items,
    });
  } catch (error) {
    console.error('Error getting monthly movements:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/dashboard-consumption
 * Aggregated monthly consumption across all centros for the dashboard
 * No params — always returns trailing 12 months
 */
exports.getDashboardConsumption = async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const { getConsumosModel } = require('../getModel');

    const Consumos = await getConsumosModel(req.companyId);
    const Locaciones = await getLocacionesModel(req.companyId);

    // Trailing 12 months
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // Get active centros
    const centros = await Locaciones.find({
      type: { $in: ['CENTRO', 'HOSPITAL', 'CLINIC'] },
      active: true,
    }).select('_id name').lean();

    // Aggregate: total items consumed per centro per month
    const consumptionData = await Consumos.aggregate([
      { $match: { createdAt: { $gte: twelveMonthsAgo } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            centroId: '$centroId',
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          quantity: { $sum: '$items.quantity' },
        },
      },
    ]);

    // Initialize maps
    const totalByMonth = {};
    const byCentroByMonth = {};

    for (const m of months) {
      totalByMonth[m.key] = 0;
    }
    for (const centro of centros) {
      const cid = centro._id.toString();
      byCentroByMonth[cid] = {};
      for (const m of months) {
        byCentroByMonth[cid][m.key] = 0;
      }
    }

    // Fill in data
    for (const row of consumptionData) {
      const cid = row._id.centroId.toString();
      const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`;
      if (totalByMonth[key] !== undefined) {
        totalByMonth[key] += row.quantity;
      }
      if (byCentroByMonth[cid] && byCentroByMonth[cid][key] !== undefined) {
        byCentroByMonth[cid][key] = row.quantity;
      }
    }

    // Summary
    const monthKeys = months.map((m) => m.key);
    const currentMonthKey = monthKeys[monthKeys.length - 1];
    const previousMonthKey = monthKeys[monthKeys.length - 2];
    const currentMonth = totalByMonth[currentMonthKey] || 0;
    const previousMonth = totalByMonth[previousMonthKey] || 0;
    const totalLast12Months = Object.values(totalByMonth).reduce((s, v) => s + v, 0);
    const trend = previousMonth > 0
      ? Math.round(((currentMonth - previousMonth) / previousMonth) * 1000) / 10
      : 0;

    res.json({
      months: monthKeys,
      centros: centros.map((c) => ({ _id: c._id, name: c.name })),
      totalByMonth,
      byCentroByMonth,
      summary: {
        totalLast12Months,
        currentMonth,
        previousMonth,
        trend,
      },
    });
  } catch (error) {
    console.error('Error getting dashboard consumption:', error);
    next(error);
  }
};
