/**
 * Import Packing List Script
 * Reads extracted packing list data and imports products/lotes into the database
 *
 * Usage: node server/scripts/import-packing-list.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// Import schemas
const productoSchema = require('../models/productoModel');
const loteSchema = require('../models/loteModel');
const inventarioSchema = require('../models/inventarioModel');
const locacionSchema = require('../models/locacionModel');
const transaccionSchema = require('../models/transaccionModel');

// Configuration
const COMPANY_ID = '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;

// Load packing list data
const packingListData = require('./packing-list-data.json');

async function importPackingList() {
  console.log('='.repeat(60));
  console.log('PACKING LIST IMPORT SCRIPT');
  console.log('='.repeat(60));
  console.log(`\nDocument: ${packingListData.packingList.documentNumber}`);
  console.log(`Supplier: ${packingListData.packingList.supplier}`);
  console.log(`Items to import: ${packingListData.items.length}`);
  console.log(`Received Date: ${packingListData.packingList.receivedDate}`);
  console.log('');

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Get database and models
    const db = mongoose.connection.useDb(DB_NAME, { useCache: true });
    const Productos = db.model('productos', productoSchema);
    const Lotes = db.model('lotes', loteSchema);
    const Inventario = db.model('inventario', inventarioSchema);
    const Locaciones = db.model('locaciones', locacionSchema);
    const Transacciones = db.model('transacciones', transaccionSchema);

    // Get or create warehouse location
    let warehouse = await Locaciones.findOne({ type: 'WAREHOUSE' });
    if (!warehouse) {
      console.log('No warehouse found. Creating default warehouse...');
      warehouse = new Locaciones({
        name: 'Almacén Principal',
        type: 'WAREHOUSE',
        address: 'Santo Domingo',
        active: true,
      });
      await warehouse.save();
      console.log(`Created warehouse: ${warehouse.name}`);
    }
    console.log(`Warehouse: ${warehouse.name} (${warehouse._id})\n`);

    const receivedDate = new Date(packingListData.packingList.receivedDate);
    const supplier = packingListData.packingList.supplier;

    // Statistics
    let productsCreated = 0;
    let productsFound = 0;
    let lotesCreated = 0;
    let totalUnits = 0;

    console.log('Processing items...\n');

    for (const item of packingListData.items) {
      // 1. Find or create product
      let product = await Productos.findOne({ code: item.code });

      if (!product) {
        // Parse dimensions from name (e.g., "Orsiro Mission 2.25/15" -> diameter=2.25, length=15)
        product = new Productos({
          name: item.name,
          code: item.code,
          category: 'STENTS_CORONARIOS',
          subcategory: 'Orsiro Mission',
          specifications: {
            size: `${item.diameter}/${item.length}`,
            diameter: item.diameter,
            length: item.length,
            type: 'Drug-eluting stent',
            description: 'BIOTRONIK Orsiro Mission coronary stent',
          },
          active: true,
          historia: [{
            fecha: new Date(),
            accion: `Created from packing list #${packingListData.packingList.documentNumber}`,
          }],
        });
        await product.save();
        productsCreated++;
        console.log(`  [NEW] Product: ${item.name} (code: ${item.code})`);
      } else {
        productsFound++;
        console.log(`  [EXISTS] Product: ${item.name} (code: ${item.code})`);
      }

      // 2. Create lote at warehouse
      const lote = new Lotes({
        productId: product._id,
        lotNumber: item.lotNumber,
        expiryDate: new Date(item.expiryDate),
        quantityTotal: item.quantity,
        quantityAvailable: item.quantity,
        quantityConsigned: 0,
        quantityConsumed: 0,
        quantityDamaged: 0,
        quantityReturned: 0,
        currentLocationId: warehouse._id,
        status: 'ACTIVE',
        receivedDate: receivedDate,
        supplier: supplier,
        notes: `Packing list #${packingListData.packingList.documentNumber}`,
        historia: [{
          fecha: new Date(),
          tipo: 'WAREHOUSE_RECEIPT',
          cantidad: item.quantity,
          usuario: 'Import Script',
          detalles: `Received from ${supplier} - Document #${packingListData.packingList.documentNumber}`,
        }],
      });
      await lote.save();
      lotesCreated++;
      totalUnits += item.quantity;

      // 3. Create transaction record
      const transaccion = new Transacciones({
        type: 'WAREHOUSE_RECEIPT',
        productId: product._id,
        lotId: lote._id,
        lotNumber: item.lotNumber,
        toLocationId: warehouse._id,
        quantity: item.quantity,
        notes: `Packing list #${packingListData.packingList.documentNumber} from ${supplier}`,
        performedBy: {
          firstname: 'Import',
          lastname: 'Script',
        },
        status: 'COMPLETED',
      });
      await transaccion.save();

      // 4. Update inventory
      await updateInventario(Lotes, Inventario, product._id, warehouse._id);
    }

    console.log('\n' + '='.repeat(60));
    console.log('IMPORT COMPLETE');
    console.log('='.repeat(60));
    console.log(`\nProducts created: ${productsCreated}`);
    console.log(`Products already existed: ${productsFound}`);
    console.log(`Lotes created: ${lotesCreated}`);
    console.log(`Total units imported: ${totalUnits}`);

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');

  } catch (error) {
    console.error('\nError during import:', error);
    process.exit(1);
  }
}

/**
 * Update inventory record for a product at a location
 */
async function updateInventario(Lotes, Inventario, productId, locationId) {
  // Aggregate all lotes for this product at this location
  const lotes = await Lotes.find({
    productId,
    currentLocationId: locationId,
  });

  const aggregated = lotes.reduce(
    (acc, lote) => {
      acc.quantityTotal += lote.quantityTotal || 0;
      acc.quantityAvailable += lote.quantityAvailable || 0;
      acc.quantityConsigned += lote.quantityConsigned || 0;
      acc.quantityConsumed += lote.quantityConsumed || 0;
      acc.quantityDamaged += lote.quantityDamaged || 0;
      acc.quantityReturned += lote.quantityReturned || 0;
      return acc;
    },
    {
      quantityTotal: 0,
      quantityAvailable: 0,
      quantityConsigned: 0,
      quantityConsumed: 0,
      quantityDamaged: 0,
      quantityReturned: 0,
    }
  );

  await Inventario.findOneAndUpdate(
    { productId, locationId },
    {
      $set: {
        ...aggregated,
        lastMovementDate: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

// Run the import
importPackingList();
