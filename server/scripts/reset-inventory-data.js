#!/usr/bin/env node
/**
 * Reset Inventory Data for Testing
 *
 * Clears all transactional/inventory data while preserving master data.
 * Use this to reset the system for testing the onboarding flow.
 *
 * KEEPS:
 * - productos (product catalog)
 * - locaciones (warehouses and centros)
 *
 * DELETES:
 * - lotes (batch/lot records)
 * - inventario (aggregated stock)
 * - consignaciones (warehouse→centro transfers)
 * - consumos (consumption records)
 * - goodsreceipts (incoming stock)
 * - transacciones (movement audit log)
 *
 * Usage:
 *   node scripts/reset-inventory-data.js --dry-run    # Preview what will be deleted
 *   node scripts/reset-inventory-data.js --confirm    # Actually delete data
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const readline = require('readline');

// Configuration
const COMPANY_ID = process.env.COMPANY_ID || '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIRMED = args.includes('--confirm');

// Collections to DELETE (transactional data)
// Note: Mongoose pluralizes collection names, so 'inventario' becomes 'inventarios'
const COLLECTIONS_TO_DELETE = [
  'lotes',
  'inventarios',
  'consignaciones',
  'consumos',
  'goodsreceipts',
  'transacciones',
];

// Collections to KEEP (master data)
const COLLECTIONS_TO_KEEP = [
  'productos',
  'locaciones',
];

async function promptConfirmation() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\n⚠️  Are you sure you want to delete all inventory data? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('Reset Inventory Data for Testing');
  console.log('='.repeat(60));
  console.log(`Database: ${DB_NAME}`);
  console.log('');

  // Show what will happen
  console.log('Collections to DELETE:');
  for (const col of COLLECTIONS_TO_DELETE) {
    console.log(`  ❌ ${col}`);
  }
  console.log('');
  console.log('Collections to KEEP:');
  for (const col of COLLECTIONS_TO_KEEP) {
    console.log(`  ✅ ${col}`);
  }
  console.log('');

  // Check mode
  if (!DRY_RUN && !CONFIRMED) {
    console.log('Usage:');
    console.log('  --dry-run    Preview what will be deleted (no changes)');
    console.log('  --confirm    Actually delete the data');
    console.log('');
    console.log('Run with --dry-run first to see counts.');
    process.exit(0);
  }

  // Connect to MongoDB
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    throw new Error('MONGODB_URI not found in environment');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(dbUri);
  console.log('Connected to MongoDB\n');

  // Get database reference
  const db = mongoose.connection.useDb(DB_NAME, { useCache: true });

  // Get counts before deletion
  console.log('Current document counts:');
  console.log('-'.repeat(40));

  const counts = {};
  for (const collectionName of [...COLLECTIONS_TO_DELETE, ...COLLECTIONS_TO_KEEP]) {
    try {
      const collection = db.collection(collectionName);
      const count = await collection.countDocuments();
      counts[collectionName] = count;

      const status = COLLECTIONS_TO_DELETE.includes(collectionName) ? '❌' : '✅';
      console.log(`  ${status} ${collectionName}: ${count} documents`);
    } catch (err) {
      counts[collectionName] = 0;
      console.log(`  ⚪ ${collectionName}: (collection doesn't exist)`);
    }
  }
  console.log('');

  if (DRY_RUN) {
    console.log('='.repeat(60));
    console.log('DRY RUN - No changes made');
    console.log('='.repeat(60));
    console.log('\nTo delete the data, run:');
    console.log('  node scripts/reset-inventory-data.js --confirm');
    await mongoose.disconnect();
    return;
  }

  // Confirm before deletion
  if (!await promptConfirmation()) {
    console.log('\nAborted. No changes made.');
    await mongoose.disconnect();
    return;
  }

  // Delete collections
  console.log('\nDeleting data...');
  console.log('-'.repeat(40));

  let totalDeleted = 0;
  for (const collectionName of COLLECTIONS_TO_DELETE) {
    try {
      const collection = db.collection(collectionName);
      const result = await collection.deleteMany({});
      console.log(`  ✓ ${collectionName}: deleted ${result.deletedCount} documents`);
      totalDeleted += result.deletedCount;
    } catch (err) {
      console.log(`  ⚠ ${collectionName}: ${err.message}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Reset Complete');
  console.log('='.repeat(60));
  console.log(`Total documents deleted: ${totalDeleted}`);
  console.log('');
  console.log('Master data preserved:');
  console.log(`  ✅ productos: ${counts.productos || 0} documents`);
  console.log(`  ✅ locaciones: ${counts.locaciones || 0} documents`);
  console.log('');
  console.log('You can now run the onboarding steps:');
  console.log('  1. node scripts/sync-inventory-from-sap.js');
  console.log('');

  await mongoose.disconnect();
  console.log('Done!');
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
