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
    const Transacciones = await getTransaccionesModel(req.companyId);

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
      // Default to last 12 months
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      dateFilter.$gte = twelveMonthsAgo;
    }

    // Build match criteria
    const matchCriteria = {
      type: 'CONSUMPTION',
      transactionDate: dateFilter,
    };
    if (productId) {
      matchCriteria.productId = productId;
    }

    // Aggregate by month and product
    const monthlyData = await Transacciones.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: {
            productId: '$productId',
            year: { $year: '$transactionDate' },
            month: { $month: '$transactionDate' },
          },
          totalQuantity: { $sum: '$quantity' },
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
    ]);

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
    const Transacciones = await getTransaccionesModel(req.companyId);

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

    // Build match criteria
    const matchCriteria = {
      type: 'CONSUMPTION',
      transactionDate: dateFilter,
    };
    if (productId) matchCriteria.productId = productId;
    if (locationId) matchCriteria.toLocationId = locationId;

    // Aggregate by location
    const locationData = await Transacciones.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: {
            locationId: '$toLocationId',
            productId: '$productId',
          },
          totalQuantity: { $sum: '$quantity' },
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
    ]);

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
    const Transacciones = await getTransaccionesModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);

    const { months = 3 } = req.query; // Default to 3 months

    // Calculate date range
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    // Get consumption per product with averages
    const trends = await Transacciones.aggregate([
      {
        $match: {
          type: 'CONSUMPTION',
          transactionDate: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: '$productId',
          totalConsumed: { $sum: '$quantity' },
          transactionCount: { $sum: 1 },
          firstTransaction: { $min: '$transactionDate' },
          lastTransaction: { $max: '$transactionDate' },
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
          // Calculate days between first and last transaction
          daysActive: {
            $divide: [
              { $subtract: ['$lastTransaction', '$firstTransaction'] },
              1000 * 60 * 60 * 24, // Convert ms to days
            ],
          },
          monthsAnalyzed: parseInt(months),
        },
      },
      {
        $addFields: {
          // Average monthly consumption
          avgMonthlyConsumption: {
            $cond: {
              if: { $gt: ['$monthsAnalyzed', 0] },
              then: { $divide: ['$totalConsumed', '$monthsAnalyzed'] },
              else: 0,
            },
          },
          // Average per transaction
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
    const Transacciones = await getTransaccionesModel(req.companyId);

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

    // Build match criteria
    const matchCriteria = {
      type: 'CONSUMPTION',
      transactionDate: dateFilter,
    };

    // Aggregate by size
    const sizeData = await Transacciones.aggregate([
      { $match: matchCriteria },
      {
        $lookup: {
          from: 'productos',
          localField: 'productId',
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
          totalQuantity: { $sum: '$quantity' },
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
    const { getInventarioObjetivosModel } = require('../getModel');

    const Locaciones = await getLocacionesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);
    const Inventario = await getInventarioModel(req.companyId);
    const Transacciones = await getTransaccionesModel(req.companyId);
    const InventarioObjetivos = await getInventarioObjetivosModel(req.companyId);

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
    let warehouseStockLevels = {}; // For location view, track warehouse stock separately

    if (isLocationView) {
      // Stock at specific location
      stockLevels = await Inventario.aggregate([
        { $match: { locationId: new mongoose.Types.ObjectId(locationId) } },
        {
          $group: {
            _id: '$productId',
            locationStock: { $sum: '$quantityAvailable' },
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
            consignedStock: {
              $sum: {
                $cond: [
                  { $in: ['$location.type', ['CENTRO', 'HOSPITAL', 'CLINIC']] },
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
        { $match: { 'location.type': { $in: ['CENTRO', 'HOSPITAL', 'CLINIC'] } } },
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
      warehouseStockLevels = {}; // Reuse this variable for centro stocks in warehouse view
      centroStockData.forEach((item) => {
        const prodId = item._id.productId.toString();
        const locId = item._id.locationId.toString();
        if (!warehouseStockLevels[prodId]) {
          warehouseStockLevels[prodId] = {};
        }
        warehouseStockLevels[prodId][locId] = item.centroStock;
      });
    }

    // Calculate consumption/outflow averages (up to 12 months, adaptive based on available data)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    let consumptionMatch = {
      transactionDate: { $gte: twelveMonthsAgo },
    };

    // If viewing specific location:
    // - Warehouse: calculate outflow (CONSIGNMENT transactions FROM warehouse)
    // - Centro: calculate consumption (CONSUMPTION transactions AT centro)
    // - Aggregated warehouse view: calculate total system consumption
    if (isLocationView) {
      if (isViewingWarehouse) {
        // Warehouse outflow: consignments from this warehouse
        consumptionMatch.type = 'CONSIGNMENT';
        consumptionMatch.fromLocationId = new mongoose.Types.ObjectId(locationId);
      } else {
        // Centro consumption: actual usage at this centro
        consumptionMatch.type = 'CONSUMPTION';
        consumptionMatch.toLocationId = new mongoose.Types.ObjectId(locationId);
      }
    } else {
      // Aggregated warehouse view: total system consumption (all centros)
      consumptionMatch.type = 'CONSUMPTION';
    }

    const consumptionData = await Transacciones.aggregate([
      { $match: consumptionMatch },
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
          // Calculate actual months of history (min 1 month to avoid division by zero)
          monthsOfHistory: {
            $max: [
              1,
              {
                $ceil: {
                  $divide: [
                    { $subtract: ['$lastTransaction', '$firstTransaction'] },
                    1000 * 60 * 60 * 24 * 30, // Convert ms to months (approx 30 days)
                  ],
                },
              },
            ],
          },
        },
      },
      {
        $addFields: {
          avgMonthlyConsumption: {
            $divide: ['$totalConsumed', '$monthsOfHistory'],
          },
        },
      },
    ]);

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
        const stock = stockMap[product._id.toString()] || { locationStock: 0 };
        const locationTarget = locationTargets[product._id.toString()];
        const warehouseStock = warehouseStockLevels[product._id.toString()] || 0;

        const currentStock = stock.locationStock;
        const targetStock = locationTarget?.targetStock || 0;

        // Calculate suggested consignment = Stock Objetivo - Stock Actual
        const suggestedConsignment = Math.max(0, targetStock - currentStock);

        // Calculate coverage days
        const daysOfCoverage =
          consumption.avgMonthlyConsumption > 0
            ? Math.round((currentStock / consumption.avgMonthlyConsumption) * 30)
            : 999;

        result = {
          ...result,
          currentStock,
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
          consignedStock: 0,
          totalStock: 0,
        };

        const settings = product.inventorySettings || {};
        const warehouseTarget = settings.targetStockWarehouse || 0;

        // Get all centro targets and stocks for this product
        const centroTargetsForProduct = allLocationTargets.filter(
          (t) => t.productId.toString() === product._id.toString() &&
                 t.locationId?.type !== 'WAREHOUSE' // Only centro targets
        );

        const centroStocksMap = warehouseStockLevels[product._id.toString()] || {};

        // Calculate system-wide totals
        let totalCentroTargets = 0;
        let totalCentroStock = 0;

        centroTargetsForProduct.forEach((target) => {
          totalCentroTargets += target.targetStock || 0;
          const locId = target.locationId._id.toString();
          totalCentroStock += centroStocksMap[locId] || 0;
        });

        // Option 1: System-wide approach
        // Total Target = Warehouse Target + All Centro Targets
        // Total Stock = Warehouse Stock + All Centro Stocks
        // Suggested Order = Total Target - Total Stock
        const systemTarget = warehouseTarget + totalCentroTargets;
        const systemStock = stock.warehouseStock + totalCentroStock;
        const suggestedOrder = Math.max(0, systemTarget - systemStock);

        // Calculate coverage days based on warehouse stock only
        const daysOfCoverage =
          consumption.avgMonthlyConsumption > 0
            ? Math.round((stock.warehouseStock / consumption.avgMonthlyConsumption) * 30)
            : 999;

        result = {
          ...result,
          warehouseStock: stock.warehouseStock,
          consignedStock: stock.consignedStock,
          totalStock: stock.totalStock,
          targetStock: warehouseTarget, // Show warehouse target in column
          systemTarget, // Total system target (for debugging/future use)
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
