/**
 * Migrate inventory data from SAP B1 export
 *
 * Reads a CSV export from SAP and creates:
 * - Products (if not exists, by sapItemCode)
 * - Lotes with batch numbers
 * - Inventory records at locations
 *
 * Expected CSV format (from SAP Stock Aging report or similar):
 * ItemCode,ItemName,BatchNum,WhsCode,OnHand,ExpiryDate
 *
 * Usage:
 *   node scripts/migrate-from-sap-export.js data/sap-inventory.csv
 *   node scripts/migrate-from-sap-export.js data/sap-inventory.csv --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Import schemas
const productoSchema = require('../models/productoModel');
const loteSchema = require('../models/loteModel');
const inventarioSchema = require('../models/inventarioModel');
const locacionSchema = require('../models/locacionModel');

// Configuration
const COMPANY_ID = '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;
const DRY_RUN = process.argv.includes('--dry-run');

// Map SAP warehouse codes to location types
// Warehouse 01 = main warehouse, 10 = bin locations for centros
const WAREHOUSE_MAPPING = {
  '01': { type: 'WAREHOUSE', binBased: false },
  '10': { type: 'CENTRO', binBased: true },
};

/**
 * Parse CSV file
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    data.push(row);
  }

  return data;
}

/**
 * Parse date from SAP format (YYYYMMDD or YYYY-MM-DD)
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  // Remove any non-numeric characters for YYYYMMDD format
  const cleaned = dateStr.replace(/\D/g, '');
  if (cleaned.length === 8) {
    return new Date(
      parseInt(cleaned.slice(0, 4)),
      parseInt(cleaned.slice(4, 6)) - 1,
      parseInt(cleaned.slice(6, 8))
    );
  }

  // Try standard date parsing
  return new Date(dateStr);
}

/**
 * Extract product info from SAP item name
 * Example: "Orsiro Mission 2.50/9" -> { diameter: 2.5, length: 9, size: "2.50/9" }
 */
function extractProductSpecs(itemName) {
  const specs = {};

  // Match pattern like "2.50/9" or "3.00/15"
  const sizeMatch = itemName.match(/(\d+\.?\d*)\/(\d+)/);
  if (sizeMatch) {
    specs.diameter = parseFloat(sizeMatch[1]);
    specs.length = parseInt(sizeMatch[2], 10);
    specs.size = `${sizeMatch[1]}/${sizeMatch[2]}`;
  }

  return specs;
}

/**
 * Determine product category from item name
 */
function determineCategory(itemName) {
  const nameLower = itemName.toLowerCase();

  if (nameLower.includes('stent') || nameLower.includes('orsiro') || nameLower.includes('mission')) {
    return 'STENTS_CORONARIOS';
  }
  if (nameLower.includes('guidewire') || nameLower.includes('guia') || nameLower.includes('wire')) {
    return 'GUIAS';
  }
  if (nameLower.includes('catheter') || nameLower.includes('cateter')) {
    return 'CATETERES';
  }
  if (nameLower.includes('balloon') || nameLower.includes('balon')) {
    return 'BALONES';
  }

  return 'OTROS';
}

async function migrate() {
  // Get CSV file path from arguments
  const csvPath = process.argv[2];
  if (!csvPath || csvPath.startsWith('--')) {
    console.error('Usage: node migrate-from-sap-export.js <csv-file> [--dry-run]');
    process.exit(1);
  }

  const fullPath = path.resolve(csvPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Migrate from SAP Export');
  console.log('='.repeat(60));
  console.log(`File: ${fullPath}`);

  if (DRY_RUN) {
    console.log('\n*** DRY RUN MODE - No changes will be made ***\n');
  }

  // Parse CSV
  console.log('\nParsing CSV...');
  const records = parseCSV(fullPath);
  console.log(`Found ${records.length} records`);

  // Connect to MongoDB
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    throw new Error('MONGODB_URI not found in environment');
  }

  console.log(`\nConnecting to MongoDB...`);
  await mongoose.connect(dbUri);
  console.log('Connected');

  // Get models for company database
  const db = mongoose.connection.useDb(DB_NAME, { useCache: true });
  const Productos = db.model('productos', productoSchema);
  const Lotes = db.model('lotes', loteSchema);
  const Inventario = db.model('inventario', inventarioSchema);
  const Locaciones = db.model('locaciones', locacionSchema);

  // Load all locations for mapping
  const locations = await Locaciones.find({}).lean();
  const locationByBin = {};
  const locationByWarehouse = {};

  for (const loc of locations) {
    if (loc.sapIntegration?.binAbsEntry) {
      locationByBin[loc.sapIntegration.binAbsEntry] = loc;
    }
    if (loc.sapIntegration?.warehouseCode && loc.type === 'WAREHOUSE') {
      locationByWarehouse[loc.sapIntegration.warehouseCode] = loc;
    }
  }

  console.log(`\nLoaded ${locations.length} locations`);

  // Stats
  const stats = {
    productsCreated: 0,
    productsUpdated: 0,
    lotesCreated: 0,
    inventoryUpdated: 0,
    skipped: 0,
    errors: [],
  };

  // Group records by ItemCode for easier processing
  const recordsByItem = {};
  for (const record of records) {
    const itemCode = record.ItemCode;
    if (!itemCode) continue;

    if (!recordsByItem[itemCode]) {
      recordsByItem[itemCode] = [];
    }
    recordsByItem[itemCode].push(record);
  }

  console.log(`\nProcessing ${Object.keys(recordsByItem).length} unique items...\n`);

  // Process each item
  for (const [itemCode, itemRecords] of Object.entries(recordsByItem)) {
    const firstRecord = itemRecords[0];
    const itemName = firstRecord.ItemName || itemCode;

    console.log(`\n[${itemCode}] ${itemName}`);

    try {
      // Find or create product
      let product = await Productos.findOne({ sapItemCode: itemCode });

      if (!product) {
        const specs = extractProductSpecs(itemName);
        const category = determineCategory(itemName);

        const productData = {
          code: itemCode,
          sapItemCode: itemCode,
          name: itemName,
          category,
          specifications: specs,
          active: true,
        };

        if (DRY_RUN) {
          console.log(`  → Would create product: ${itemName}`);
          stats.productsCreated++;
        } else {
          product = new Productos(productData);
          await product.save();
          console.log(`  → Created product`);
          stats.productsCreated++;
        }
      } else {
        console.log(`  → Product exists`);
        stats.productsUpdated++;
      }

      // Process each batch record for this item
      for (const record of itemRecords) {
        const batchNum = record.BatchNum || record.DistNumber || 'NO-LOT';
        const whsCode = record.WhsCode;
        const quantity = parseInt(record.OnHand || record.Quantity || '0', 10);
        const expiryDate = parseDate(record.ExpiryDate);
        const binEntry = record.BinEntry ? parseInt(record.BinEntry, 10) : null;

        if (quantity <= 0) {
          console.log(`    Batch ${batchNum}: skipped (qty: ${quantity})`);
          stats.skipped++;
          continue;
        }

        // Determine location
        let location = null;
        if (binEntry && locationByBin[binEntry]) {
          location = locationByBin[binEntry];
        } else if (whsCode && locationByWarehouse[whsCode]) {
          location = locationByWarehouse[whsCode];
        }

        if (!location) {
          console.log(`    Batch ${batchNum}: skipped (no location for whs ${whsCode}, bin ${binEntry})`);
          stats.skipped++;
          continue;
        }

        console.log(`    Batch ${batchNum}: ${quantity} units at ${location.name}`);

        if (DRY_RUN) {
          stats.lotesCreated++;
          continue;
        }

        // Create or update lote
        let lote = await Lotes.findOne({
          productId: product._id,
          lotNumber: batchNum,
        });

        if (!lote) {
          lote = new Lotes({
            productId: product._id,
            lotNumber: batchNum,
            expiryDate: expiryDate || new Date('2026-12-31'),
            quantityTotal: quantity,
            quantityAvailable: quantity,
            currentLocationId: location._id,
            receivedDate: new Date(),
            supplier: 'SAP Import',
            status: 'ACTIVE',
            historia: [{
              fecha: new Date(),
              accion: 'Imported from SAP export',
              detalles: `Qty: ${quantity}, Whs: ${whsCode}`,
            }],
          });
          await lote.save();
          stats.lotesCreated++;
        } else {
          // Update existing lote quantities
          lote.quantityTotal = quantity;
          lote.quantityAvailable = quantity;
          lote.currentLocationId = location._id;
          if (expiryDate) lote.expiryDate = expiryDate;
          await lote.save();
        }

        // Update inventory record
        await Inventario.findOneAndUpdate(
          { productId: product._id, locationId: location._id },
          {
            $inc: { quantityTotal: quantity, quantityAvailable: quantity },
            $set: { lastReceivedDate: new Date() },
          },
          { upsert: true }
        );
        stats.inventoryUpdated++;
      }
    } catch (error) {
      console.error(`  → Error: ${error.message}`);
      stats.errors.push({ itemCode, error: error.message });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Products created: ${stats.productsCreated}`);
  console.log(`Products updated: ${stats.productsUpdated}`);
  console.log(`Lotes created:    ${stats.lotesCreated}`);
  console.log(`Inventory updates: ${stats.inventoryUpdated}`);
  console.log(`Skipped records:  ${stats.skipped}`);
  console.log(`Errors:           ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors:');
    stats.errors.forEach(e => console.log(`  - ${e.itemCode}: ${e.error}`));
  }

  if (DRY_RUN) {
    console.log('\n*** DRY RUN - No changes were made ***');
  }

  await mongoose.disconnect();
  console.log('\nDone!');
}

// Run
migrate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
