/**
 * Import Orsiro Mission products with legacy code mapping
 *
 * Creates products with:
 * - code: New Orsiro Mission code (419xxx)
 * - sapItemCode: Same as code (for SAP API)
 * - legacyCode: Old Orsiro code (364xxx) for reference
 *
 * Usage:
 *   node scripts/import-orsiro-codes.js
 *   node scripts/import-orsiro-codes.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const xlsx = require('xlsx');
const path = require('path');

// Import schema
const productoSchema = require('../models/productoModel');

// Configuration
const COMPANY_ID = '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;
const EXCEL_FILE = path.join(__dirname, 'orsiro-codes.xlsx');
const DRY_RUN = process.argv.includes('--dry-run');

async function importOrsiroCodes() {
  console.log('='.repeat(60));
  console.log('Import Orsiro Mission Products');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\n*** DRY RUN MODE - No changes will be made ***\n');
  }

  // Connect to MongoDB
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    throw new Error('MONGODB_URI not found in environment');
  }

  console.log(`Connecting to: ${dbUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
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

  // Skip header row
  const dataRows = rows.slice(1);
  console.log(`Found ${dataRows.length} products to import\n`);

  // Stats
  const stats = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  // Process each row
  for (const row of dataRows) {
    const [name, newCode, oldCode] = row;

    if (!name || !newCode) {
      console.log(`Skipping invalid row: ${JSON.stringify(row)}`);
      stats.skipped++;
      continue;
    }

    // Parse diameter and length from name (e.g., "Orsiro 2.25/13")
    const sizeMatch = name.match(/(\d+\.?\d*)\s*\/\s*(\d+)/);
    const diameter = sizeMatch ? parseFloat(sizeMatch[1]) : null;
    const length = sizeMatch ? parseInt(sizeMatch[2], 10) : null;
    const size = sizeMatch ? `${sizeMatch[1]}/${sizeMatch[2]}` : null;

    // Build product name with "Mission"
    const productName = name.replace('Orsiro', 'Orsiro Mission');

    // Prepare product data
    const productData = {
      name: productName,
      code: newCode,
      sapItemCode: String(newCode),
      legacyCode: oldCode !== '-' && oldCode ? oldCode : null,
      category: 'STENTS_CORONARIOS',
      subcategory: 'Orsiro Mission',
      specifications: {
        size,
        diameter,
        length,
        type: 'Drug-Eluting Stent',
        description: 'Stent coronario medicado Orsiro Mission',
      },
      active: true,
    };

    console.log(`Processing: ${productName} (${newCode})` +
                (productData.legacyCode ? ` → legacy: ${productData.legacyCode}` : ' [no legacy]'));

    if (DRY_RUN) {
      stats.created++;
      continue;
    }

    try {
      // Find existing product by code
      let product = await Productos.findOne({ code: newCode });

      if (product) {
        // Update existing product
        product.sapItemCode = productData.sapItemCode;
        product.legacyCode = productData.legacyCode;
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
  console.log(`Created: ${stats.created}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Errors:  ${stats.errors}`);
  console.log(`Total:   ${dataRows.length}`);

  if (DRY_RUN) {
    console.log('\n*** DRY RUN - No changes were made ***');
  }

  await mongoose.disconnect();
  console.log('\nDone!');
}

// Run
importOrsiroCodes().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
