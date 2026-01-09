/**
 * Import Centros (Locations) with SAP bin location mapping
 *
 * Creates locations with:
 * - type: CENTRO or WAREHOUSE
 * - sapIntegration: { warehouseCode, binAbsEntry, binCode }
 *
 * Usage:
 *   node scripts/import-centros.js
 *   node scripts/import-centros.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// Import schema
const locacionSchema = require('../models/locacionModel');

// Configuration
const COMPANY_ID = '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;
const DRY_RUN = process.argv.includes('--dry-run');

// Locations to create/update
// Add more centros here as needed
const LOCATIONS = [
  // Warehouse (Almacén Principal)
  {
    name: 'Almacén Principal',
    fullName: 'Almacén Principal - Santo Domingo',
    type: 'WAREHOUSE',
    sapIntegration: {
      warehouseCode: '01',
      binAbsEntry: null,
      binCode: null,
    },
    address: {
      city: 'Santo Domingo',
      country: 'República Dominicana',
    },
  },

  // Centros (from SAP bin locations in warehouse 10)
  {
    name: 'CDC',
    fullName: 'CDC',
    type: 'CENTRO',
    sapIntegration: {
      warehouseCode: '10',
      binAbsEntry: 3,
      binCode: '10-CDC',
    },
  },
  {
    name: 'CECANOR',
    fullName: 'CECANOR',
    type: 'CENTRO',
    sapIntegration: {
      warehouseCode: '10',
      binAbsEntry: 4,
      binCode: '10-CECANOR',
    },
  },
  {
    name: 'INCAE',
    fullName: 'INCAE',
    type: 'CENTRO',
    sapIntegration: {
      warehouseCode: '10',
      binAbsEntry: 37,
      binCode: '10-INCAE',
    },
  },
  {
    name: 'CENICARDIO',
    fullName: 'CENICARDIO',
    type: 'CENTRO',
    sapIntegration: {
      warehouseCode: '10',
      binAbsEntry: 38,
      binCode: '10-CENICARDIO',
    },
  },
  {
    name: 'CERECA',
    fullName: 'CERECA',
    type: 'CENTRO',
    sapIntegration: {
      warehouseCode: '10',
      binAbsEntry: 40,
      binCode: '10-CERECA',
    },
  },
];

async function importCentros() {
  console.log('='.repeat(60));
  console.log('Import Centros (Locations) with SAP Integration');
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

  // Get the Locaciones model for the company database
  const db = mongoose.connection.useDb(DB_NAME, { useCache: true });
  const Locaciones = db.model('locaciones', locacionSchema);

  // Stats
  const stats = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  console.log(`Processing ${LOCATIONS.length} locations...\n`);

  for (const locData of LOCATIONS) {
    const identifier = locData.sapIntegration.binAbsEntry
      ? `binAbsEntry: ${locData.sapIntegration.binAbsEntry}`
      : `warehouseCode: ${locData.sapIntegration.warehouseCode}`;

    console.log(`Processing: ${locData.name} (${locData.type}) [${identifier}]`);

    if (DRY_RUN) {
      console.log(`  → Would create/update`);
      stats.created++;
      continue;
    }

    try {
      // Find existing location by name and type, or by SAP binAbsEntry
      let location = await Locaciones.findOne({
        $or: [
          { name: locData.name, type: locData.type },
          { 'sapIntegration.binAbsEntry': locData.sapIntegration.binAbsEntry },
        ],
      });

      if (location) {
        // Update existing location with SAP integration
        location.sapIntegration = locData.sapIntegration;
        if (locData.fullName) location.fullName = locData.fullName;
        if (locData.address) location.address = { ...location.address, ...locData.address };
        await location.save();
        console.log(`  → Updated existing location`);
        stats.updated++;
      } else {
        // Create new location
        location = new Locaciones({
          ...locData,
          active: true,
          settings: {
            allowConsignment: true,
            requiresApproval: false,
          },
        });
        await location.save();
        console.log(`  → Created new location`);
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
  console.log(`Total:   ${LOCATIONS.length}`);

  if (DRY_RUN) {
    console.log('\n*** DRY RUN - No changes were made ***');
  }

  await mongoose.disconnect();
  console.log('\nDone!');
}

// Run
importCentros().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
