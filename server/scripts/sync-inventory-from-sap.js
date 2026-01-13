#!/usr/bin/env node
/**
 * Sync Inventory from SAP B1 Service Layer
 *
 * One-time onboarding sync that pulls inventory data directly from SAP
 * and creates local Lote and Inventario records.
 *
 * UPDATED 2026-01-13:
 * Now uses SQLQueries endpoint with AllowList access to:
 * - OIBT: Batch inventory by warehouse (for warehouse 01)
 * - OBBQ: Batch quantities by bin location (for warehouse 10 centros)
 * - OBTN: Batch master data (batch numbers, expiry dates)
 * - OBIN: Bin location codes
 *
 * This provides exact batch-by-bin inventory data for accurate sync.
 *
 * Prerequisites:
 * - Products exist in local DB with sapItemCode (run import-orsiro-codes.js)
 * - Locations exist with sapIntegration.warehouseCode/binAbsEntry (run import-centros.js)
 * - SAP credentials configured in .env
 * - OIBT, OBBQ, OBTN, OBIN tables in SAP AllowList
 *
 * Usage:
 *   node scripts/sync-inventory-from-sap.js                    # Full sync
 *   node scripts/sync-inventory-from-sap.js --dry-run          # Preview only
 *   node scripts/sync-inventory-from-sap.js --verbose          # Detailed output
 *   node scripts/sync-inventory-from-sap.js --location "CDC"   # Specific location
 *   node scripts/sync-inventory-from-sap.js --product "419113" # Specific product
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// Import schemas
const productoSchema = require('../models/productoModel');
const loteSchema = require('../models/loteModel');
const inventarioSchema = require('../models/inventarioModel');
const locacionSchema = require('../models/locacionModel');

// Import sync service
const sapSyncService = require('../services/sapSyncService');
const sapService = require('../services/sapService');

// Configuration
const COMPANY_ID = process.env.COMPANY_ID || '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose') || args.includes('-v');

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return null;
}

const LOCATION_FILTER = getArgValue('--location');
const PRODUCT_FILTER = getArgValue('--product');

// Default expiry date for batches without valid expiry (5 years from now)
const DEFAULT_EXPIRY_DATE = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000);

/**
 * Safely parse a date value from SAP
 * @param {*} dateValue - The date value from SAP (could be string, null, undefined)
 * @returns {Date} - A valid Date object or default expiry date
 */
function parseExpiryDate(dateValue) {
  if (!dateValue) {
    return DEFAULT_EXPIRY_DATE;
  }
  const parsed = new Date(dateValue);
  // Check if valid date (not NaN)
  if (isNaN(parsed.getTime())) {
    return DEFAULT_EXPIRY_DATE;
  }
  return parsed;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Sync Inventory from SAP B1 Service Layer');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Database: ${DB_NAME}`);
  console.log(`Dry Run: ${DRY_RUN ? 'YES (no changes will be saved)' : 'NO'}`);
  if (LOCATION_FILTER) console.log(`Location Filter: ${LOCATION_FILTER}`);
  if (PRODUCT_FILTER) console.log(`Product Filter: ${PRODUCT_FILTER}`);
  console.log('');

  // Connect to MongoDB
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    throw new Error('MONGODB_URI not found in environment');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(dbUri);
  console.log('Connected to MongoDB');

  // Get models for company database
  const db = mongoose.connection.useDb(DB_NAME, { useCache: true });
  const Productos = db.model('productos', productoSchema);
  const Lotes = db.model('lotes', loteSchema);
  const Inventario = db.model('inventario', inventarioSchema);
  const Locaciones = db.model('locaciones', locacionSchema);

  // Test SAP connection
  console.log('\nTesting SAP connection...');
  const sapTest = await sapService.verifyConnection();
  if (!sapTest.success) {
    throw new Error(`SAP connection failed: ${sapTest.message}`);
  }
  console.log('SAP connection OK');

  // Get products with SAP item codes
  let productQuery = {
    sapItemCode: { $exists: true, $ne: null, $ne: '' },
    active: true,
  };
  if (PRODUCT_FILTER) {
    productQuery.$or = [
      { code: PRODUCT_FILTER },
      { sapItemCode: PRODUCT_FILTER },
    ];
  }

  const products = await Productos.find(productQuery).lean();
  console.log(`\nFound ${products.length} products with SAP item codes`);

  if (products.length === 0) {
    console.log('No products to sync. Run import-orsiro-codes.js first.');
    await mongoose.disconnect();
    return;
  }

  // Get locations with SAP warehouse mapping
  let locationQuery = {
    'sapIntegration.warehouseCode': { $exists: true, $ne: null },
    active: true,
  };

  if (LOCATION_FILTER) {
    locationQuery.name = { $regex: LOCATION_FILTER, $options: 'i' };
  }

  const locations = await Locaciones.find(locationQuery).lean();
  console.log(`Found ${locations.length} locations with SAP mapping`);

  if (locations.length === 0) {
    console.log('No locations to sync. Run import-centros.js first.');
    await mongoose.disconnect();
    return;
  }

  // Show location summary
  console.log('\nLocations to sync:');
  for (const loc of locations) {
    const binInfo = loc.sapIntegration.binAbsEntry
      ? ` (bin: ${loc.sapIntegration.binAbsEntry})`
      : '';
    console.log(`  - ${loc.name}: warehouse ${loc.sapIntegration.warehouseCode}${binInfo}`);
  }

  // Stats
  const stats = {
    startTime: new Date(),
    locationsProcessed: 0,
    productsProcessed: 0,
    batchesFound: 0,
    lotesCreated: 0,
    lotesUpdated: 0,
    inventarioUpdated: 0,
    errors: [],
  };

  // Process each location
  console.log('\n' + '-'.repeat(60));
  console.log('Starting sync...');
  console.log('-'.repeat(60));

  for (const location of locations) {
    const warehouseCode = location.sapIntegration.warehouseCode;
    const binAbsEntry = location.sapIntegration.binAbsEntry;

    console.log(`\n[${location.name}] (warehouse: ${warehouseCode}${binAbsEntry ? `, bin: ${binAbsEntry}` : ''})`);

    let locationBatchCount = 0;

    // Fetch all batch data for this location in one query
    // Query: Orsiro Mission (419%), legacy Orsiro (364%, 391%), Papyrus (369%, 381%)
    let allBatchStock = [];
    try {
      if (binAbsEntry) {
        // Centro with bin location - use OBBQ for bin-specific data
        const mission = await sapSyncService.getBatchInventoryByBin('419%', binAbsEntry);
        const legacy364 = await sapSyncService.getBatchInventoryByBin('364%', binAbsEntry);
        const legacy391 = await sapSyncService.getBatchInventoryByBin('391%', binAbsEntry);
        const papyrus369 = await sapSyncService.getBatchInventoryByBin('369%', binAbsEntry);
        const papyrus381 = await sapSyncService.getBatchInventoryByBin('381%', binAbsEntry);
        allBatchStock = [...mission, ...legacy364, ...legacy391, ...papyrus369, ...papyrus381];
        if (VERBOSE) {
          console.log(`  Fetched ${allBatchStock.length} batch records from OBBQ (bin ${binAbsEntry})`);
          console.log(`    - Orsiro Mission: ${mission.length}, Legacy: ${legacy364.length + legacy391.length}, Papyrus: ${papyrus369.length + papyrus381.length}`);
        }
      } else {
        // Main warehouse (no bins) - use OIBT
        const mission = await sapSyncService.getBatchInventoryFromOIBT('419%', warehouseCode);
        const legacy364 = await sapSyncService.getBatchInventoryFromOIBT('364%', warehouseCode);
        const legacy391 = await sapSyncService.getBatchInventoryFromOIBT('391%', warehouseCode);
        const papyrus369 = await sapSyncService.getBatchInventoryFromOIBT('369%', warehouseCode);
        const papyrus381 = await sapSyncService.getBatchInventoryFromOIBT('381%', warehouseCode);
        allBatchStock = [...mission, ...legacy364, ...legacy391, ...papyrus369, ...papyrus381];
        if (VERBOSE) {
          console.log(`  Fetched ${allBatchStock.length} batch records from OIBT (warehouse ${warehouseCode})`);
          console.log(`    - Orsiro Mission: ${mission.length}, Legacy: ${legacy364.length + legacy391.length}, Papyrus: ${papyrus369.length + papyrus381.length}`);
        }
      }
    } catch (error) {
      console.error(`  Error fetching batch data: ${error.message}`);
      stats.errors.push({
        location: location.name,
        message: `Failed to fetch batch data: ${error.message}`,
      });
      continue;
    }

    // Group batches by ItemCode for efficient processing
    const batchesByItem = new Map();
    for (const batch of allBatchStock) {
      if (!batchesByItem.has(batch.ItemCode)) {
        batchesByItem.set(batch.ItemCode, []);
      }
      batchesByItem.get(batch.ItemCode).push(batch);
    }

    // Process each product
    for (let i = 0; i < products.length; i++) {
      const product = products[i];

      if (VERBOSE) {
        process.stdout.write(`  Processing ${product.code}... `);
      }

      try {
        // Get batches for this product from pre-fetched data
        const locationBatches = batchesByItem.get(product.sapItemCode) || [];

        // Filter positive quantities
        const validBatches = locationBatches.filter(b => b.Quantity > 0);

        if (validBatches.length === 0) {
          if (VERBOSE) console.log('no stock');
          continue;
        }

        if (VERBOSE) {
          console.log(`${validBatches.length} batch(es)`);
        }

        // Process each batch
        for (const batch of validBatches) {
          locationBatchCount++;
          stats.batchesFound++;

          if (DRY_RUN) {
            console.log(`    [DRY RUN] Would create/update: ${product.code} / ${batch.BatchNum} qty=${batch.Quantity}`);
            continue;
          }

          // Create or update lote
          try {
            const existingLote = await Lotes.findOne({
              productId: product._id,
              lotNumber: batch.BatchNum,
              currentLocationId: location._id,
            });

            if (existingLote) {
              // Update existing
              const oldQty = existingLote.quantityAvailable;
              existingLote.quantityTotal = batch.Quantity;
              existingLote.quantityAvailable = batch.Quantity;
              existingLote.expiryDate = parseExpiryDate(batch.ExpDate);
              existingLote.historia.push({
                fecha: new Date(),
                accion: 'SAP Sync',
                detalles: `Updated: ${oldQty} → ${batch.Quantity}`,
              });
              await existingLote.save();
              stats.lotesUpdated++;

              if (VERBOSE) {
                console.log(`    Updated: ${batch.BatchNum} (${oldQty} → ${batch.Quantity})`);
              }
            } else {
              // Create new lote
              const newLote = new Lotes({
                productId: product._id,
                lotNumber: batch.BatchNum,
                currentLocationId: location._id,
                quantityTotal: batch.Quantity,
                quantityAvailable: batch.Quantity,
                quantityConsigned: 0,
                quantityConsumed: 0,
                expiryDate: parseExpiryDate(batch.ExpDate),
                receivedDate: new Date(),
                supplier: 'SAP Sync',
                status: 'ACTIVE',
                historia: [{
                  fecha: new Date(),
                  accion: 'SAP Sync',
                  detalles: `Imported: qty=${batch.Quantity}`,
                }],
              });
              await newLote.save();
              stats.lotesCreated++;

              if (VERBOSE) {
                console.log(`    Created: ${batch.BatchNum} qty=${batch.Quantity}`);
              }
            }
          } catch (error) {
            if (error.code === 11000) {
              // Duplicate key - try update
              console.warn(`    Duplicate detected, skipping: ${batch.BatchNum}`);
            } else {
              throw error;
            }
          }
        }

        // Update Inventario for this product at this location
        if (!DRY_RUN && validBatches.length > 0) {
          await sapSyncService.updateInventarioForProduct(
            Lotes,
            Inventario,
            product._id,
            location._id
          );
          stats.inventarioUpdated++;
        }

        stats.productsProcessed++;

      } catch (error) {
        const errorInfo = {
          location: location.name,
          product: product.code,
          sapItemCode: product.sapItemCode,
          message: error.message,
        };
        stats.errors.push(errorInfo);
        console.error(`  Error processing ${product.code}: ${error.message}`);
      }
    }

    stats.locationsProcessed++;
    console.log(`  → Found ${locationBatchCount} batches at ${location.name}`);
  }

  // Summary
  stats.endTime = new Date();
  const duration = (stats.endTime - stats.startTime) / 1000;

  console.log('\n' + '='.repeat(60));
  console.log('Sync Complete');
  console.log('='.repeat(60));
  console.log(`Duration: ${duration.toFixed(1)} seconds`);
  console.log(`Locations processed: ${stats.locationsProcessed}`);
  console.log(`Products checked: ${stats.productsProcessed}`);
  console.log(`Batches found: ${stats.batchesFound}`);
  console.log(`Lotes created: ${stats.lotesCreated}`);
  console.log(`Lotes updated: ${stats.lotesUpdated}`);
  console.log(`Inventario updated: ${stats.inventarioUpdated}`);
  console.log(`Errors: ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of stats.errors.slice(0, 10)) {
      console.log(`  - ${err.location}/${err.product || ''}: ${err.message}`);
    }
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more`);
    }
  }

  if (DRY_RUN) {
    console.log('\n*** DRY RUN - No changes were saved ***');
  }

  // Logout from SAP
  await sapService.logout();
  await mongoose.disconnect();
  console.log('\nDone!');
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
