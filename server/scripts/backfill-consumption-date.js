#!/usr/bin/env node
/**
 * Backfill consumptionDate on existing Consumos records.
 *
 * Context:
 *   The consumoModel was extended with a required `consumptionDate` field
 *   that drives all analytics (Dashboard, Movimientos, trends). This script
 *   populates it on records created before the field existed.
 *
 * Backfill priority:
 *   1. procedureDate (if set — app-created consumptions with user-entered date)
 *   2. createdAt (fallback — Mongo insertion timestamp)
 *
 * Safe to re-run: only updates records where consumptionDate is missing.
 *
 * Usage:
 *   node scripts/backfill-consumption-date.js --dry-run
 *   node scripts/backfill-consumption-date.js --confirm
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const COMPANY_ID = process.env.COMPANY_ID || '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIRMED = args.includes('--confirm');

async function main() {
  console.log('='.repeat(60));
  console.log('Backfill consumptionDate on Consumos');
  console.log('='.repeat(60));
  console.log(`Database: ${DB_NAME}`);
  console.log('');

  if (!DRY_RUN && !CONFIRMED) {
    console.log('Usage:');
    console.log('  --dry-run    Preview changes without writing');
    console.log('  --confirm    Apply the backfill');
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.useDb(DB_NAME, { useCache: true });
  const consumos = db.collection('consumos');

  const missingCount = await consumos.countDocuments({
    consumptionDate: { $exists: false },
  });
  const totalCount = await consumos.countDocuments({});

  console.log(`Total consumos: ${totalCount}`);
  console.log(`Missing consumptionDate: ${missingCount}`);
  console.log('');

  if (missingCount === 0) {
    console.log('Nothing to backfill.');
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    // Show a breakdown of what the backfill would do
    const sample = await consumos
      .find({ consumptionDate: { $exists: false } })
      .project({ _id: 1, procedureDate: 1, createdAt: 1, centroName: 1 })
      .limit(10)
      .toArray();

    const withProcedureDate = await consumos.countDocuments({
      consumptionDate: { $exists: false },
      procedureDate: { $ne: null, $exists: true },
    });
    const withoutProcedureDate = missingCount - withProcedureDate;

    console.log('Backfill source breakdown:');
    console.log(`  From procedureDate: ${withProcedureDate}`);
    console.log(`  From createdAt:     ${withoutProcedureDate}`);
    console.log('');
    console.log('Sample records:');
    for (const doc of sample) {
      const source = doc.procedureDate ? 'procedureDate' : 'createdAt';
      const resolved = doc.procedureDate || doc.createdAt;
      console.log(`  ${doc._id} [${doc.centroName || '?'}] ${source} → ${resolved?.toISOString?.() || resolved}`);
    }
    console.log('');
    console.log('DRY RUN - no changes made. Use --confirm to apply.');
    await mongoose.disconnect();
    return;
  }

  // Apply backfill. Use aggregation pipeline update so we can reference
  // other fields (procedureDate, createdAt) within a single atomic op.
  console.log('Applying backfill...');
  const result = await consumos.updateMany(
    { consumptionDate: { $exists: false } },
    [
      {
        $set: {
          consumptionDate: {
            $ifNull: ['$procedureDate', '$createdAt'],
          },
        },
      },
    ]
  );

  console.log('');
  console.log(`Updated: ${result.modifiedCount}`);
  console.log(`Matched: ${result.matchedCount}`);

  // Verify
  const stillMissing = await consumos.countDocuments({
    consumptionDate: { $exists: false },
  });
  console.log(`Still missing consumptionDate: ${stillMissing}`);

  if (stillMissing > 0) {
    console.warn('WARNING: Some records could not be backfilled (no procedureDate AND no createdAt).');
  }

  await mongoose.disconnect();
  console.log('');
  console.log('Done!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
