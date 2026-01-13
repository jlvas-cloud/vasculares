/**
 * SAP Sync Service
 * Pulls inventory data from SAP B1 Service Layer to initialize local stock
 *
 * Used for one-time onboarding sync and potential future reconciliation
 *
 * UPDATED 2026-01-13:
 * Now uses SQLQueries endpoint with AllowList access to:
 * - OIBT: Batch inventory by warehouse
 * - OBBQ: Batch quantities by bin location
 * - OBTN: Batch master data (batch numbers, expiry dates)
 * - OBIN: Bin location codes
 *
 * This provides exact batch-by-bin inventory data for accurate sync.
 */
const sapService = require('./sapService');

// Debug mode
const DEBUG_SAP = process.env.DEBUG_SAP === 'true';

// Track created SQL queries to avoid duplicates
const createdQueries = new Set();

/**
 * Execute a SQL query via SAP Service Layer SQLQueries endpoint
 * Creates the query if it doesn't exist, then executes it
 *
 * @param {string} queryCode - Unique identifier for the query
 * @param {string} queryName - Display name
 * @param {string} sqlText - SQL query text
 * @returns {Promise<Array>} Query results
 */
async function executeSQLQuery(queryCode, queryName, sqlText) {
  await sapService.ensureSession();
  const baseUrl = sapService.getServiceUrl();
  const sessionId = await sapService.ensureSession();

  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `B1SESSION=${sessionId}`,
  };

  // Create query if not already created this session
  if (!createdQueries.has(queryCode)) {
    try {
      const createResponse = await fetch(`${baseUrl}/SQLQueries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          SqlCode: queryCode,
          SqlName: queryName,
          SqlText: sqlText,
        }),
      });

      if (createResponse.ok) {
        createdQueries.add(queryCode);
      } else {
        // Query might already exist from previous session, that's OK
        const error = await createResponse.json();
        if (!error.error?.message?.value?.includes('already exists')) {
          if (DEBUG_SAP) {
            console.log(`Query creation note: ${error.error?.message?.value}`);
          }
        }
        createdQueries.add(queryCode);
      }
    } catch (err) {
      // Continue anyway - query might exist
      createdQueries.add(queryCode);
    }
  }

  // Execute the query with pagination (follow odata.nextLink)
  const allResults = [];
  let url = `${baseUrl}/SQLQueries('${queryCode}')/List`;
  let pageCount = 0;
  const maxPages = 100; // Safety limit

  while (url && pageCount < maxPages) {
    const execResponse = await fetch(url, {
      method: 'POST',
      headers,
    });

    if (!execResponse.ok) {
      const error = await execResponse.json();
      throw new Error(`SQL query failed: ${error.error?.message?.value || 'Unknown error'}`);
    }

    const data = await execResponse.json();
    const results = data.value || [];
    allResults.push(...results);

    // SAP returns odata.nextLink for pagination (ignores $top/$skip for SQLQueries)
    const nextLink = data['odata.nextLink'];
    if (nextLink) {
      // nextLink can be relative or absolute
      url = nextLink.startsWith('http') ? nextLink : `${baseUrl}/${nextLink}`;
    } else {
      url = null;
    }
    pageCount++;
  }

  return allResults;
}

/**
 * Get batch inventory from OIBT (warehouse level, no bin detail)
 * Used for warehouse 01 (main warehouse without bins)
 *
 * @param {string} itemCodeFilter - Optional filter like '419%'
 * @param {string} warehouseCode - Optional warehouse filter
 * @returns {Promise<Array>} Array of {ItemCode, BatchNum, WhsCode, Quantity}
 */
async function getBatchInventoryFromOIBT(itemCodeFilter = null, warehouseCode = null) {
  let whereClause = 'T0.Quantity > 0';
  if (itemCodeFilter) {
    whereClause += ` AND T0.ItemCode LIKE '${itemCodeFilter}'`;
  }
  if (warehouseCode) {
    whereClause += ` AND T0.WhsCode = '${warehouseCode}'`;
  }

  const queryCode = `OIBT_${itemCodeFilter || 'All'}_${warehouseCode || 'All'}`.replace(/%/g, 'pct');
  const sqlText = `
    SELECT T0.ItemCode, T0.BatchNum, T0.WhsCode, T0.Quantity, T1.ExpDate
    FROM OIBT T0
    INNER JOIN OBTN T1 ON T0.ItemCode = T1.ItemCode AND T0.BatchNum = T1.DistNumber
    WHERE ${whereClause}
    ORDER BY T0.WhsCode, T0.ItemCode
  `.trim();

  return await executeSQLQuery(queryCode, `OIBT Query`, sqlText);
}

/**
 * Get batch inventory from OBBQ (bin level detail)
 * Used for warehouse 10 (consignment with bin locations)
 *
 * @param {string} itemCodeFilter - Optional filter like '419%'
 * @param {number} binAbs - Optional bin absolute entry filter
 * @returns {Promise<Array>} Array of {ItemCode, BatchNum, WhsCode, BinAbs, BinCode, Quantity, ExpDate}
 */
async function getBatchInventoryByBin(itemCodeFilter = null, binAbs = null) {
  let whereClause = 'T0.OnHandQty > 0';
  if (itemCodeFilter) {
    whereClause += ` AND T0.ItemCode LIKE '${itemCodeFilter}'`;
  }
  if (binAbs) {
    whereClause += ` AND T0.BinAbs = ${binAbs}`;
  }

  const queryCode = `OBBQ_${itemCodeFilter || 'All'}_${binAbs || 'All'}`.replace(/%/g, 'pct');
  const sqlText = `
    SELECT T0.ItemCode, T1.DistNumber AS BatchNum, T0.WhsCode, T0.BinAbs, T2.BinCode,
           T0.OnHandQty AS Quantity, T1.ExpDate
    FROM OBBQ T0
    INNER JOIN OBTN T1 ON T0.SnBMDAbs = T1.AbsEntry
    LEFT JOIN OBIN T2 ON T0.BinAbs = T2.AbsEntry
    WHERE ${whereClause}
    ORDER BY T0.BinAbs, T0.ItemCode
  `.trim();

  return await executeSQLQuery(queryCode, `OBBQ Query`, sqlText);
}

/**
 * Get all Orsiro batch inventory (combined warehouse and bin data)
 *
 * @returns {Promise<Object>} { warehouse01: [...], byBin: [...] }
 */
async function getOrsiroInventory() {
  // Get warehouse 01 inventory (no bins)
  const warehouse01 = await getBatchInventoryFromOIBT('419%', '01');

  // Get bin-level inventory (warehouse 10 with bins)
  const byBin = await getBatchInventoryByBin('419%');

  return { warehouse01, byBin };
}

/**
 * Get batch stock for an item at a specific location
 *
 * @param {string} itemCode - SAP item code
 * @param {string} warehouseCode - SAP warehouse code
 * @param {number|null} binAbsEntry - Bin absolute entry (for bin locations)
 * @returns {Promise<Array>} Array of batch records
 */
async function getBatchStockForLocation(itemCode, warehouseCode, binAbsEntry = null) {
  if (binAbsEntry) {
    // Location with bin - use OBBQ
    const results = await getBatchInventoryByBin(itemCode, binAbsEntry);
    return results.filter(r => r.ItemCode === itemCode);
  } else {
    // Location without bin - use OIBT
    const results = await getBatchInventoryFromOIBT(itemCode, warehouseCode);
    return results.filter(r => r.ItemCode === itemCode);
  }
}

/**
 * Sync inventory from SAP for all products at a specific location
 *
 * @param {Object} options Sync options
 * @param {Object} options.location - Location document with sapIntegration
 * @param {Array} options.products - Products to sync (with sapItemCode)
 * @param {Function} options.onProgress - Progress callback (product, index, total)
 * @param {boolean} options.dryRun - If true, don't save to database
 * @returns {Promise<Object>} Sync results
 */
async function syncLocationInventory({ location, products, onProgress, dryRun = false }) {
  const results = {
    location: location.name,
    warehouseCode: location.sapIntegration?.warehouseCode,
    binAbsEntry: location.sapIntegration?.binAbsEntry,
    productsProcessed: 0,
    lotesCreated: 0,
    lotesUpdated: 0,
    errors: [],
    batches: [],
    warnings: [],
  };

  if (!location.sapIntegration?.warehouseCode) {
    results.errors.push({ message: 'Location has no SAP warehouse mapping' });
    return results;
  }

  const warehouseCode = location.sapIntegration.warehouseCode;
  const binAbsEntry = location.sapIntegration.binAbsEntry;

  // Fetch all inventory data for this location in one query
  let allBatchStock;
  if (binAbsEntry) {
    // Location with bin - get bin-specific data
    allBatchStock = await getBatchInventoryByBin('419%', binAbsEntry);
  } else {
    // Location without bin - get warehouse data
    allBatchStock = await getBatchInventoryFromOIBT('419%', warehouseCode);
  }

  if (DEBUG_SAP) {
    console.log(`  Fetched ${allBatchStock.length} batch records for ${location.name}`);
  }

  // Process each product
  for (let i = 0; i < products.length; i++) {
    const product = products[i];

    if (onProgress) {
      onProgress(product, i, products.length);
    }

    if (!product.sapItemCode) {
      continue;
    }

    try {
      // Filter batches for this product
      const productBatches = allBatchStock.filter(b => b.ItemCode === product.sapItemCode);

      for (const batch of productBatches) {
        if (batch.Quantity <= 0) continue;

        const batchRecord = {
          productId: product._id,
          productCode: product.code,
          productName: product.name,
          sapItemCode: product.sapItemCode,
          lotNumber: batch.BatchNum,
          quantity: batch.Quantity,
          expiryDate: batch.ExpDate,
          locationId: location._id,
          locationName: location.name,
          binAbs: batch.BinAbs || null,
          binCode: batch.BinCode || null,
        };

        results.batches.push(batchRecord);
      }

      results.productsProcessed++;
    } catch (error) {
      results.errors.push({
        productCode: product.code,
        sapItemCode: product.sapItemCode,
        message: error.message,
      });
    }
  }

  return results;
}

/**
 * Full inventory sync from SAP
 * Syncs all products across all configured locations
 *
 * @param {Object} options Sync options
 * @param {Object} options.db - Mongoose database connection
 * @param {Function} options.onProgress - Progress callback
 * @param {boolean} options.dryRun - If true, don't save changes
 * @returns {Promise<Object>} Full sync results
 */
async function fullInventorySync({ db, onProgress, dryRun = false }) {
  const Productos = db.model('productos');
  const Locaciones = db.model('locaciones');
  const Lotes = db.model('lotes');
  const Inventario = db.model('inventario');

  const results = {
    startTime: new Date(),
    endTime: null,
    locations: [],
    totalLotesCreated: 0,
    totalLotesUpdated: 0,
    totalErrors: [],
  };

  // Get all products with SAP item codes
  const products = await Productos.find({
    sapItemCode: { $exists: true, $ne: null, $ne: '' },
    active: true,
  }).lean();

  console.log(`Found ${products.length} products with SAP item codes`);

  // Get all locations with SAP warehouse mapping
  const locations = await Locaciones.find({
    'sapIntegration.warehouseCode': { $exists: true, $ne: null },
    active: true,
  }).lean();

  console.log(`Found ${locations.length} locations with SAP mapping`);

  // Sync each location
  for (const location of locations) {
    console.log(`\nSyncing location: ${location.name} (WH: ${location.sapIntegration.warehouseCode}, Bin: ${location.sapIntegration.binAbsEntry || 'none'})`);

    const locationResults = await syncLocationInventory({
      location,
      products,
      onProgress: (product, index, total) => {
        if (onProgress) {
          onProgress({
            phase: 'sync',
            location: location.name,
            product: product.name,
            progress: Math.round(((index + 1) / total) * 100),
          });
        }
      },
      dryRun,
    });

    console.log(`  Found ${locationResults.batches.length} batches`);

    // Create/update lotes for this location
    if (!dryRun && locationResults.batches.length > 0) {
      for (const batch of locationResults.batches) {
        try {
          // Check if lote exists (using unique constraint)
          const existingLote = await Lotes.findOne({
            productId: batch.productId,
            lotNumber: batch.lotNumber,
            currentLocationId: batch.locationId,
          });

          if (existingLote) {
            // Update existing lote
            existingLote.quantityTotal = batch.quantity;
            existingLote.quantityAvailable = batch.quantity;
            if (batch.expiryDate) {
              existingLote.expiryDate = new Date(batch.expiryDate);
            }
            existingLote.historia.push({
              fecha: new Date(),
              accion: 'SAP Sync',
              detalles: `Updated from SAP: qty=${batch.quantity}`,
            });
            await existingLote.save();
            locationResults.lotesUpdated++;
          } else {
            // Create new lote
            const newLote = new Lotes({
              productId: batch.productId,
              lotNumber: batch.lotNumber,
              currentLocationId: batch.locationId,
              quantityTotal: batch.quantity,
              quantityAvailable: batch.quantity,
              quantityConsigned: 0,
              quantityConsumed: 0,
              expiryDate: batch.expiryDate ? new Date(batch.expiryDate) : new Date('2030-12-31'),
              receivedDate: new Date(),
              supplier: 'SAP Sync',
              status: 'ACTIVE',
              historia: [{
                fecha: new Date(),
                accion: 'SAP Sync',
                detalles: `Imported from SAP: qty=${batch.quantity}`,
              }],
            });
            await newLote.save();
            locationResults.lotesCreated++;
          }

          // Update Inventario aggregation
          await updateInventarioForProduct(Lotes, Inventario, batch.productId, batch.locationId);

        } catch (error) {
          if (error.code === 11000) {
            // Duplicate key - race condition, try update
            console.warn(`Duplicate lote detected, updating: ${batch.lotNumber}`);
          } else {
            locationResults.errors.push({
              batch: batch.lotNumber,
              message: error.message,
            });
          }
        }
      }
    }

    results.locations.push(locationResults);
    results.totalLotesCreated += locationResults.lotesCreated;
    results.totalLotesUpdated += locationResults.lotesUpdated;
    results.totalErrors.push(...locationResults.errors);
  }

  results.endTime = new Date();
  return results;
}

/**
 * Update Inventario aggregation for a product at a location
 * Sums all lotes for this product/location combination
 */
async function updateInventarioForProduct(Lotes, Inventario, productId, locationId) {
  // Aggregate all lotes for this product at this location
  const lotes = await Lotes.find({
    productId,
    currentLocationId: locationId,
    status: { $ne: 'DEPLETED' },
  }).lean();

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
    quantityReturned: 0,
  });

  await Inventario.findOneAndUpdate(
    { productId, locationId },
    {
      $set: {
        ...aggregated,
        lastMovementDate: new Date(),
        lastReceivedDate: new Date(),
      },
    },
    { upsert: true }
  );
}

// Legacy functions for backwards compatibility
async function getWarehouseStock(itemCode) {
  const results = await getBatchInventoryFromOIBT(itemCode);
  const warehouseMap = new Map();

  for (const r of results) {
    const current = warehouseMap.get(r.WhsCode) || 0;
    warehouseMap.set(r.WhsCode, current + r.Quantity);
  }

  return Array.from(warehouseMap.entries()).map(([WhsCode, InStock]) => ({
    WarehouseCode: WhsCode,
    InStock,
  }));
}

async function getBatchMasterData(itemCode) {
  const batches = await sapService.getItemBatches(itemCode);
  return batches.map(b => ({
    BatchNumber: b.Batch || b.BatchNumber || b.DistNumber,
    ExpiryDate: b.ExpirationDate || b.ExpiryDate,
    AdmissionDate: b.AdmissionDate,
    Status: b.Status,
  }));
}

async function getStockAtWarehouse(itemCode, warehouseCode) {
  const results = await getBatchInventoryFromOIBT(itemCode, warehouseCode);
  return results.reduce((sum, r) => sum + r.Quantity, 0);
}

async function getAllBatchStock(itemCode) {
  // Get warehouse-level data
  const warehouseStock = await getBatchInventoryFromOIBT(itemCode);

  // Get bin-level data
  const binStock = await getBatchInventoryByBin(itemCode);

  // Combine, preferring bin-level data when available
  const results = [];
  const processedKeys = new Set();

  // Add bin-level data first
  for (const b of binStock) {
    const key = `${b.ItemCode}-${b.BatchNum}-${b.WhsCode}-${b.BinAbs}`;
    processedKeys.add(key);
    results.push({
      ItemCode: b.ItemCode,
      BatchNumber: b.BatchNum,
      WarehouseCode: b.WhsCode,
      BinEntry: b.BinAbs,
      BinCode: b.BinCode,
      Quantity: b.Quantity,
      ExpiryDate: b.ExpDate,
    });
  }

  // Add warehouse-level data for items not in bins
  for (const w of warehouseStock) {
    // Check if this warehouse uses bins (warehouse 10)
    if (w.WhsCode === '10') continue; // Skip, should use bin data

    results.push({
      ItemCode: w.ItemCode,
      BatchNumber: w.BatchNum,
      WarehouseCode: w.WhsCode,
      BinEntry: null,
      BinCode: null,
      Quantity: w.Quantity,
      ExpiryDate: w.ExpDate,
    });
  }

  return results;
}

module.exports = {
  // New SQLQueries-based functions
  executeSQLQuery,
  getBatchInventoryFromOIBT,
  getBatchInventoryByBin,
  getOrsiroInventory,
  getBatchStockForLocation,

  // Main sync functions
  syncLocationInventory,
  fullInventorySync,
  updateInventarioForProduct,

  // Legacy compatibility
  getWarehouseStock,
  getBatchMasterData,
  getStockAtWarehouse,
  getAllBatchStock,
};
