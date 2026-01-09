/**
 * SAP Controller
 * Endpoints for SAP Business One integration
 */
const sapService = require('../services/sapService');
const { getProductosModel, getLocacionesModel } = require('../getModel');

/**
 * GET /api/sap/test
 * Test SAP connection
 */
exports.testConnection = async (req, res, next) => {
  try {
    const result = await sapService.verifyConnection();
    res.json(result);
  } catch (error) {
    console.error('SAP connection test failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/sap/warehouses
 * Get list of SAP warehouses
 */
exports.getWarehouses = async (req, res, next) => {
  try {
    await sapService.ensureSession();

    const response = await fetch(
      `${sapService.SAP_CONFIG.serviceUrl}/Warehouses?$select=WarehouseCode,WarehouseName`,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `B1SESSION=${await sapService.ensureSession()}`,
        },
        agent: require('https').Agent({ rejectUnauthorized: false }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch warehouses: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error('Error fetching SAP warehouses:', error);
    next(error);
  }
};

/**
 * GET /api/sap/bin-locations
 * Get bin locations for a warehouse (centros)
 */
exports.getBinLocations = async (req, res, next) => {
  try {
    const { warehouse } = req.query;
    await sapService.ensureSession();

    let url = `${sapService.SAP_CONFIG.serviceUrl}/BinLocations?$select=AbsEntry,BinCode,Warehouse`;
    if (warehouse) {
      url += `&$filter=Warehouse eq '${warehouse}'`;
    }

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `B1SESSION=${await sapService.ensureSession()}`,
      },
      agent: require('https').Agent({ rejectUnauthorized: false }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch bin locations: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error('Error fetching SAP bin locations:', error);
    next(error);
  }
};

/**
 * GET /api/sap/batch-stock
 * Get batch/lot stock for a product at a location
 * Query params: itemCode, warehouseCode (optional)
 */
exports.getBatchStock = async (req, res, next) => {
  try {
    const { itemCode, warehouseCode } = req.query;

    if (!itemCode) {
      return res.status(400).json({ error: 'itemCode is required' });
    }

    // Get batches from SAP
    const batches = await sapService.getItemBatches(itemCode);

    // If warehouse filter provided, we need to check stock per warehouse
    // The batch details may need additional filtering based on your SAP setup

    res.json({
      itemCode,
      warehouseCode: warehouseCode || 'all',
      batches,
    });
  } catch (error) {
    console.error('Error fetching SAP batch stock:', error);
    next(error);
  }
};

/**
 * GET /api/sap/items
 * Search SAP items
 * Query params: search (optional), top (default 20)
 */
exports.getItems = async (req, res, next) => {
  try {
    const { search, top = 20 } = req.query;
    await sapService.ensureSession();

    let url = `${sapService.SAP_CONFIG.serviceUrl}/Items?$top=${top}&$select=ItemCode,ItemName,ManageBatchNumbers`;

    if (search) {
      url += `&$filter=contains(ItemName,'${search}') or contains(ItemCode,'${search}')`;
    }

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `B1SESSION=${await sapService.ensureSession()}`,
      },
      agent: require('https').Agent({ rejectUnauthorized: false }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch items: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error('Error fetching SAP items:', error);
    next(error);
  }
};

/**
 * POST /api/sap/stock-transfer
 * Create a stock transfer in SAP
 * This is called internally by consignaciones controller
 */
exports.createStockTransfer = async (req, res, next) => {
  try {
    const { fromWarehouse, toWarehouse, toBinAbsEntry, items, comments } = req.body;

    if (!fromWarehouse || !toWarehouse || !items || items.length === 0) {
      return res.status(400).json({
        error: 'fromWarehouse, toWarehouse, and items are required',
      });
    }

    const result = await sapService.createStockTransfer({
      fromWarehouse,
      toWarehouse,
      toBinAbsEntry,
      items,
      comments,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error creating SAP stock transfer:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * GET /api/sap/inventory
 * Get inventory for products with SAP integration
 * Returns stock by batch number for each product at the warehouse
 */
exports.getInventoryForPlanning = async (req, res, next) => {
  try {
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({ error: 'locationId is required' });
    }

    // Get the location's SAP warehouse info
    const Locaciones = await getLocacionesModel(req.companyId);
    const location = await Locaciones.findById(locationId).lean();

    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!location.sapIntegration?.warehouseCode) {
      return res.status(400).json({ error: 'Location has no SAP warehouse mapping' });
    }

    // Get products with SAP item codes
    const Productos = await getProductosModel(req.companyId);
    const products = await Productos.find({
      sapItemCode: { $exists: true, $ne: null },
      active: true,
    }).lean();

    // For each product, get batch stock from SAP
    const inventory = [];

    for (const product of products) {
      try {
        const batches = await sapService.getItemBatches(product.sapItemCode);

        // Filter batches that have stock (you may need to adjust based on SAP response)
        const batchesWithStock = batches.filter(b => b.Quantity > 0);

        if (batchesWithStock.length > 0) {
          inventory.push({
            productId: product._id,
            productCode: product.code,
            productName: product.name,
            sapItemCode: product.sapItemCode,
            batches: batchesWithStock.map(b => ({
              batchNumber: b.BatchNumber || b.DistNumber,
              quantity: b.Quantity,
              expiryDate: b.ExpiryDate,
              admissionDate: b.AdmissionDate,
            })),
          });
        }
      } catch (err) {
        console.warn(`Failed to get batches for ${product.sapItemCode}:`, err.message);
      }
    }

    res.json({
      location: {
        _id: location._id,
        name: location.name,
        warehouseCode: location.sapIntegration.warehouseCode,
      },
      inventory,
    });
  } catch (error) {
    console.error('Error fetching SAP inventory for planning:', error);
    next(error);
  }
};

// Default suppliers to track for arrivals (can be configured)
const TRACKED_SUPPLIERS = [
  { cardCode: 'P00031', cardName: 'Centralmed' },
];

/**
 * GET /api/sap/suppliers
 * Get list of suppliers (business partners) from SAP
 */
exports.getSuppliers = async (req, res, next) => {
  try {
    const { search } = req.query;
    await sapService.ensureSession();

    let url = `${sapService.SAP_CONFIG.serviceUrl}/BusinessPartners?$top=50`;
    url += `&$select=CardCode,CardName,CardType`;
    url += `&$filter=CardType eq 'cSupplier'`;

    if (search) {
      url += ` and (contains(CardName,'${search}') or contains(CardCode,'${search}'))`;
    }

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `B1SESSION=${await sapService.ensureSession()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch suppliers: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data.value || []);
  } catch (error) {
    console.error('Error fetching SAP suppliers:', error);
    next(error);
  }
};

/**
 * Helper to fetch batch details from BatchNumberDetails table
 * @param {string} itemCode - SAP item code
 * @param {string} admissionDate - Date in YYYY-MM-DD format
 * @param {string} sessionId - SAP session ID
 * @returns {Array} - Array of batch objects
 */
async function fetchBatchDetails(itemCode, admissionDate, sessionId) {
  try {
    // Query BatchNumberDetails for this item on this date
    const url = `${sapService.SAP_CONFIG.serviceUrl}/BatchNumberDetails?$filter=ItemCode eq '${itemCode}' and AdmissionDate eq '${admissionDate}'`;

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `B1SESSION=${sessionId}`,
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch batch details for ${itemCode}: ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    return (data.value || []).map(b => ({
      batchNumber: b.Batch,
      expiryDate: b.ExpirationDate,
      admissionDate: b.AdmissionDate,
    }));
  } catch (err) {
    console.warn(`Error fetching batch details for ${itemCode}:`, err.message);
    return [];
  }
}

/**
 * GET /api/sap/arrivals
 * Get recent goods receipts from SAP (for arrival sync feature)
 *
 * Query params:
 * - since: Date filter (YYYY-MM-DD)
 * - supplier: Supplier CardCode to filter by (e.g., 'BIOTRONIK')
 * - warehouse: Warehouse code (default '01')
 */
exports.getArrivals = async (req, res, next) => {
  try {
    const { since, supplier, warehouse = '01' } = req.query;
    const sessionId = await sapService.ensureSession();

    // Build filter for PurchaseDeliveryNotes (Goods Receipt PO)
    const filters = [];

    if (since) {
      filters.push(`DocDate ge '${since}'`);
    }

    if (supplier) {
      // Filter by supplier CardCode
      filters.push(`CardCode eq '${supplier}'`);
    }

    let url = `${sapService.SAP_CONFIG.serviceUrl}/PurchaseDeliveryNotes?$top=100&$orderby=DocDate desc`;
    url += `&$select=DocNum,DocDate,CardCode,CardName,DocumentLines`;

    if (filters.length > 0) {
      url += `&$filter=${filters.join(' and ')}`;
    }

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `B1SESSION=${sessionId}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch arrivals: ${response.statusText}`);
    }

    const data = await response.json();

    // Process arrivals - include all items
    const arrivals = [];
    for (const doc of data.value || []) {
      // Extract date part for BatchNumberDetails query (YYYY-MM-DD)
      const docDateStr = doc.DocDate.split('T')[0];

      for (const line of doc.DocumentLines || []) {
        // Filter by warehouse if specified
        if (warehouse && line.WarehouseCode !== warehouse) {
          continue;
        }

        // Check if item has batch numbers embedded in the document
        const hasBatchesInDoc = line.BatchNumbers && line.BatchNumbers.length > 0;

        let batches;
        if (hasBatchesInDoc) {
          // Use embedded batch info (rare, but possible in some SAP configs)
          batches = line.BatchNumbers.map(b => ({
            batchNumber: b.BatchNumber,
            quantity: b.Quantity,
            expiryDate: b.ExpiryDate,
          }));
        } else {
          // Query BatchNumberDetails table for batch info
          const batchDetails = await fetchBatchDetails(line.ItemCode, docDateStr, sessionId);

          if (batchDetails.length > 0) {
            // Found batches - distribute quantity evenly (best approximation)
            const qtyPerBatch = Math.floor(line.Quantity / batchDetails.length);
            const remainder = line.Quantity % batchDetails.length;

            batches = batchDetails.map((b, idx) => ({
              batchNumber: b.batchNumber,
              quantity: qtyPerBatch + (idx < remainder ? 1 : 0),
              expiryDate: b.expiryDate,
            }));
          } else {
            // No batch info found
            batches = [{ batchNumber: 'N/A', quantity: line.Quantity, expiryDate: null }];
          }
        }

        arrivals.push({
          sapDocNum: doc.DocNum,
          docDate: doc.DocDate,
          supplierCode: doc.CardCode,
          supplierName: doc.CardName,
          itemCode: line.ItemCode,
          itemName: line.ItemDescription,
          warehouseCode: line.WarehouseCode,
          batches,
          totalQuantity: line.Quantity,
        });
      }
    }

    res.json({
      arrivals,
      filters: {
        since,
        supplier,
        warehouse,
      },
      trackedSuppliers: TRACKED_SUPPLIERS,
    });
  } catch (error) {
    console.error('Error fetching SAP arrivals:', error);
    next(error);
  }
};
