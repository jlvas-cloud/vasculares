#!/usr/bin/env node
/**
 * Import Historical Consumptions from SAP
 *
 * Pulls historical SAP DeliveryNotes and creates local Consumo records with
 * origin: 'SAP_HISTORY'. These records exist purely for analytics — they do
 * NOT touch lotes or inventario, so the current inventory state is preserved.
 *
 * After running, the Dashboard and Movimientos pages will show the imported
 * months immediately (analytics queries already group by consumptionDate).
 *
 * Prerequisites:
 *   - Products imported (sapItemCode set)
 *   - Locations imported with cardCode linked (Step 3 of onboarding)
 *
 * Usage:
 *   node scripts/import-historical-consumptions.js --months 12
 *   node scripts/import-historical-consumptions.js --from 2025-04-01 --to 2026-04-01
 *   node scripts/import-historical-consumptions.js --months 12 --dry-run
 *   node scripts/import-historical-consumptions.js --months 12 --centro CCVNORTE
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const sapService = require('../services/sapService');

const COMPANY_ID = process.env.COMPANY_ID || '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;

// Parse args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const monthsArg = getArgValue('--months');
const fromArg = getArgValue('--from');
const toArg = getArgValue('--to');
const centroArg = getArgValue('--centro');

function getArgValue(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

function resolveDateRange() {
  if (fromArg && toArg) {
    return { fromDate: new Date(fromArg), toDate: new Date(toArg) };
  }
  const months = parseInt(monthsArg || '12', 10);
  if (isNaN(months) || months < 1) {
    throw new Error('--months must be a positive integer');
  }
  const toDate = new Date();
  const fromDate = new Date(toDate.getFullYear(), toDate.getMonth() - months, 1);
  return { fromDate, toDate };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Import Historical Consumptions from SAP');
  console.log('='.repeat(60));
  console.log(`Database: ${DB_NAME}`);

  const { fromDate, toDate } = resolveDateRange();
  console.log(`Date range: ${fromDate.toISOString().split('T')[0]} → ${toDate.toISOString().split('T')[0]}`);
  if (centroArg) console.log(`Centro filter: ${centroArg}`);
  if (DRY_RUN) console.log('*** DRY RUN — no records will be inserted ***');
  console.log('');

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.useDb(DB_NAME, { useCache: true });
  const productos = db.collection('productos');
  const locaciones = db.collection('locaciones');
  const consumos = db.collection('consumos');

  // 1. Build product lookup: sapItemCode → { _id, name }
  const products = await productos
    .find({ sapItemCode: { $exists: true, $ne: null } })
    .project({ _id: 1, name: 1, sapItemCode: 1 })
    .toArray();

  if (products.length === 0) {
    throw new Error('No products with sapItemCode found. Run import-orsiro-codes.js first.');
  }
  const productByCode = {};
  for (const p of products) {
    productByCode[p.sapItemCode] = p;
  }
  const itemCodes = products.map((p) => p.sapItemCode);
  console.log(`Tracking ${itemCodes.length} products with SAP codes`);

  // 2. Build centro lookup: cardCode → { _id, name }
  const centroQuery = {
    type: { $in: ['CENTRO', 'HOSPITAL', 'CLINIC'] },
    'sapIntegration.cardCode': { $exists: true, $ne: null },
  };
  if (centroArg) {
    centroQuery.name = centroArg;
  }
  const centros = await locaciones.find(centroQuery).toArray();

  if (centros.length === 0) {
    const msg = centroArg
      ? `No centro named "${centroArg}" with a linked cardCode found.`
      : 'No centros with linked cardCodes found. Link cardCodes in the Locations UI first.';
    throw new Error(msg);
  }

  const centroByCardCode = {};
  for (const c of centros) {
    centroByCardCode[c.sapIntegration.cardCode] = c;
  }
  console.log(`Importing for ${centros.length} centro(s): ${centros.map((c) => c.name).join(', ')}`);
  console.log('');

  // 3. Fetch historical DeliveryNotes from SAP (chunked by month)
  console.log('Fetching SAP DeliveryNotes (one month at a time)...');
  const result = await sapService.getHistoricalDeliveryNotes(
    fromDate,
    toDate,
    itemCodes,
    ({ month, fetched, kept }) => {
      console.log(`  ${month}: ${fetched} total, ${kept} match our products`);
    }
  );

  if (!result.success) {
    throw new Error(`SAP fetch failed: ${result.error}`);
  }
  console.log(`\nTotal: ${result.documents.length} relevant documents`);
  console.log('');

  // 4. Process each document
  const stats = {
    created: 0,
    skippedExisting: 0,
    skippedNoCentro: 0,
    skippedFiltered: 0,
    byCentro: {},
    byMonth: {},
  };

  for (const doc of result.documents) {
    // Resolve centro
    const centro = centroByCardCode[doc.cardCode];
    if (!centro) {
      stats.skippedNoCentro++;
      // If --centro filter is set and this doc isn't for it, count separately
      if (centroArg) stats.skippedFiltered++;
      continue;
    }

    // Check idempotency by sapDocEntry
    const existing = await consumos.findOne({ 'sapIntegration.docEntry': doc.sapDocEntry });
    if (existing) {
      stats.skippedExisting++;
      continue;
    }

    // Filter items to only our tracked products
    const ourItems = doc.items.filter((item) => productByCode[item.sapItemCode]);
    if (ourItems.length === 0) {
      continue;
    }

    const consumoItems = ourItems.map((item) => {
      const product = productByCode[item.sapItemCode];
      return {
        productId: product._id,
        sapItemCode: item.sapItemCode,
        productName: product.name,
        loteId: null,
        lotNumber: item.batchNumber || `UNKNOWN-${doc.sapDocEntry}`,
        quantity: item.quantity,
      };
    });

    const totalQuantity = consumoItems.reduce((s, i) => s + i.quantity, 0);

    const now = new Date();
    const consumoDoc = {
      centroId: centro._id,
      centroName: centro.name,
      sapCardCode: doc.cardCode,
      items: consumoItems,
      // Business date (when the consumption actually happened in SAP)
      consumptionDate: doc.sapDocDate,
      sapIntegration: {
        pushed: true,
        docEntry: doc.sapDocEntry,
        docNum: doc.sapDocNum,
        docType: 'DeliveryNotes',
        syncDate: doc.sapDocDate,
        retryCount: 0,
        retrying: false,
      },
      totalItems: consumoItems.length,
      totalQuantity,
      totalValue: 0,
      status: 'SYNCED',
      origin: 'SAP_HISTORY',
      notes: `Importado durante onboarding histórico (SAP DocNum ${doc.sapDocNum})`,
      // Record-insertion timestamps (distinct from consumptionDate, which is
      // the business date). Bypasses Mongoose `{ timestamps: true }` because
      // we use insertOne directly for bulk performance.
      createdAt: now,
      updatedAt: now,
    };

    if (!DRY_RUN) {
      await consumos.insertOne(consumoDoc);
    }

    stats.created++;
    stats.byCentro[centro.name] = (stats.byCentro[centro.name] || 0) + 1;
    const monthKey = `${doc.sapDocDate.getFullYear()}-${String(doc.sapDocDate.getMonth() + 1).padStart(2, '0')}`;
    stats.byMonth[monthKey] = (stats.byMonth[monthKey] || 0) + 1;
  }

  // 5. Summary
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Created:                ${stats.created}`);
  console.log(`Skipped (already exist): ${stats.skippedExisting}`);
  console.log(`Skipped (no centro match): ${stats.skippedNoCentro}`);
  if (centroArg && stats.skippedFiltered > 0) {
    console.log(`  (of which filtered out by --centro): ${stats.skippedFiltered}`);
  }
  console.log('');
  console.log('By centro:');
  for (const [name, count] of Object.entries(stats.byCentro).sort()) {
    console.log(`  ${name}: ${count}`);
  }
  console.log('');
  console.log('By month:');
  for (const [month, count] of Object.entries(stats.byMonth).sort()) {
    console.log(`  ${month}: ${count}`);
  }
  console.log('');
  if (DRY_RUN) {
    console.log('*** DRY RUN — no records were inserted ***');
  }

  await mongoose.disconnect();
  console.log('Done!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
