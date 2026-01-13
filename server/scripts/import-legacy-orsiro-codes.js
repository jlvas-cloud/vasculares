/**
 * Import Legacy Orsiro products (364xxx codes)
 *
 * Creates separate products for old Orsiro codes that still have inventory in SAP.
 * These will be tracked separately from Orsiro Mission (419xxx) but can be
 * consolidated in planning views by diameter/length.
 *
 * Usage:
 *   node scripts/import-legacy-orsiro-codes.js
 *   node scripts/import-legacy-orsiro-codes.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const xlsx = require('xlsx');
const path = require('path');

// Import schema
const productoSchema = require('../models/productoModel');

// Configuration
const COMPANY_ID = process.env.COMPANY_ID || '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;
const EXCEL_FILE = process.env.ORSIRO_EXCEL || path.join(process.env.HOME, 'Downloads', 'Orsiros codes.xlsx');
const DRY_RUN = process.argv.includes('--dry-run');

async function importLegacyOrsiroCodes() {
  console.log('='.repeat(60));
  console.log('Import Legacy Orsiro Products (364xxx)');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\n*** DRY RUN MODE - No changes will be made ***\n');
  }

  // Connect to MongoDB
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    throw new Error('MONGODB_URI not found in environment');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(dbUri);
  console.log('Connected to MongoDB');
  console.log(`Using database: ${DB_NAME}\n`);

  // Get the Productos model for the company database
  const db = mongoose.connection.useDb(DB_NAME, { useCache: true });
  const Productos = db.model('productos', productoSchema);

  // Read Excel file
  console.log(`Reading: ${EXCEL_FILE}`);
  const workbook = xlsx.readFile(EXCEL_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  // Find header row (contains "New Code" and "Old code")
  let headerIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row && row.some(cell => cell === 'New Code' || cell === 'Old code')) {
      headerIndex = i;
      break;
    }
  }

  // Get data rows (skip header)
  const dataRows = rows.slice(headerIndex + 1);
  console.log(`Found ${dataRows.length} rows to process\n`);

  // Stats
  const stats = {
    created: 0,
    updated: 0,
    skipped: 0,
    noLegacy: 0,
    errors: 0,
  };

  // Process each row
  for (const row of dataRows) {
    // Columns: [Name, New Code, Old Code] - xlsx collapses empty columns
    const name = row[0];
    const newCode = row[1];
    const oldCode = row[2];

    if (!name || !oldCode || oldCode === '-') {
      if (name && newCode) {
        console.log(`Skipping ${name} (${newCode}) - no legacy code`);
        stats.noLegacy++;
      }
      continue;
    }

    // Parse diameter and length from name (e.g., "Orsiro 2.25/13")
    const sizeMatch = name.match(/(\d+\.?\d*)\s*\/\s*(\d+)/);
    const diameter = sizeMatch ? parseFloat(sizeMatch[1]) : null;
    const length = sizeMatch ? parseInt(sizeMatch[2], 10) : null;
    const size = sizeMatch ? `${sizeMatch[1]}/${sizeMatch[2]}` : null;

    // Build product name (keep as "Orsiro" not "Orsiro Mission")
    const productName = name.trim();

    // Prepare product data
    const productData = {
      name: productName,
      code: oldCode,
      sapItemCode: String(oldCode),
      legacyCode: null, // This IS the legacy product
      missionCode: newCode, // Reference to new Mission code
      category: 'STENTS_CORONARIOS',
      subcategory: 'Orsiro', // NOT "Orsiro Mission"
      specifications: {
        size,
        diameter,
        length,
        type: 'Drug-Eluting Stent',
        description: 'Stent coronario medicado Orsiro (legacy)',
      },
      active: true,
    };

    console.log(`Processing: ${productName} (${oldCode}) → Mission equivalent: ${newCode}`);

    if (DRY_RUN) {
      stats.created++;
      continue;
    }

    try {
      // Find existing product by code
      let product = await Productos.findOne({ code: oldCode });

      if (product) {
        // Update existing product
        product.sapItemCode = productData.sapItemCode;
        product.name = productData.name;
        product.specifications = productData.specifications;
        product.subcategory = productData.subcategory;
        await product.save();
        console.log(`  → Updated existing product`);
        stats.updated++;
      } else {
        // Create new product
        product = new Productos(productData);
        await product.save();
        console.log(`  → Created new product`);
        stats.created++;
      }
    } catch (error) {
      console.error(`  → Error: ${error.message}`);
      stats.errors++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Created:   ${stats.created}`);
  console.log(`Updated:   ${stats.updated}`);
  console.log(`No legacy: ${stats.noLegacy} (skipped - these only exist as Mission)`);
  console.log(`Errors:    ${stats.errors}`);

  if (DRY_RUN) {
    console.log('\n*** DRY RUN - No changes were made ***');
  }

  await mongoose.disconnect();
  console.log('\nDone!');
}

// Run
importLegacyOrsiroCodes().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
