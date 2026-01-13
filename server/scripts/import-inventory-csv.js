#!/usr/bin/env node
/**
 * Importar Inventario desde CSV exportado de SAP
 *
 * Este script importa datos de la tabla OIBT (lotes por almacén/ubicación)
 * exportados manualmente desde SAP Business One.
 *
 * CÓMO EXPORTAR DESDE SAP:
 * 1. En SAP B1 Client, ir a: Herramientas → Consultas → Administrador de consultas
 * 2. Crear nueva consulta con el SQL proporcionado abajo
 * 3. Ejecutar y exportar a Excel/CSV
 * 4. Guardar el archivo en server/data/
 * 5. Ejecutar este script
 *
 * SQL PARA EXPORTAR DESDE SAP:
 *
 * SELECT
 *   T0.ItemCode,
 *   T0.BatchNum,
 *   T0.WhsCode,
 *   T0.BinAbs,
 *   T0.Quantity,
 *   T1.ExpDate,
 *   T2.BinCode
 * FROM OIBT T0
 * INNER JOIN OBTN T1 ON T0.ItemCode = T1.ItemCode AND T0.BatchNum = T1.DistNumber
 * LEFT JOIN OBIN T2 ON T0.BinAbs = T2.AbsEntry
 * WHERE T0.Quantity > 0
 * ORDER BY T0.WhsCode, T2.BinCode, T0.ItemCode
 *
 * USO:
 *   node scripts/import-inventory-csv.js data/oibt-export.csv
 *   node scripts/import-inventory-csv.js data/oibt-export.csv --dry-run
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
const COMPANY_ID = process.env.COMPANY_ID || '613a3e44b934a2e264187048';
const DB_NAME = `${COMPANY_ID}_vasculares`;

// Parse arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const csvFile = args.find(arg => !arg.startsWith('--'));

if (!csvFile) {
  console.log(`
Uso: node scripts/import-inventory-csv.js <archivo.csv> [opciones]

Opciones:
  --dry-run    Vista previa sin guardar cambios
  --verbose    Mostrar detalles de cada registro

Ejemplo:
  node scripts/import-inventory-csv.js data/oibt-export.csv --dry-run

Formato CSV esperado (separado por comas o punto y coma):
  ItemCode,BatchNum,WhsCode,BinAbs,Quantity,ExpDate,BinCode
  419113,04244766,10,3,1,2026-06-24,10-CDC
  419113,07245012,10,4,2,2026-09-29,10-CECANOR
  `);
  process.exit(0);
}

/**
 * Parse CSV file
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    throw new Error('CSV vacío o sin datos');
  }

  // Detect separator (comma or semicolon)
  const firstLine = lines[0];
  const separator = firstLine.includes(';') ? ';' : ',';

  // Parse header
  const headers = lines[0].split(separator).map(h => h.trim().replace(/"/g, ''));
  console.log('Columnas detectadas:', headers.join(', '));

  // Map common column names
  const columnMap = {
    'ItemCode': ['ItemCode', 'itemcode', 'ITEMCODE', 'Codigo', 'codigo'],
    'BatchNum': ['BatchNum', 'batchnum', 'BATCHNUM', 'Lote', 'lote', 'DistNumber'],
    'WhsCode': ['WhsCode', 'whscode', 'WHSCODE', 'Almacen', 'almacen', 'Warehouse'],
    'BinAbs': ['BinAbs', 'binabs', 'BINABS', 'BinEntry', 'binentry'],
    'Quantity': ['Quantity', 'quantity', 'QUANTITY', 'Cantidad', 'cantidad', 'Qty'],
    'ExpDate': ['ExpDate', 'expdate', 'EXPDATE', 'FechaVenc', 'ExpiryDate', 'Vencimiento'],
    'BinCode': ['BinCode', 'bincode', 'BINCODE', 'Ubicacion', 'ubicacion'],
  };

  // Find column indices
  const indices = {};
  for (const [key, aliases] of Object.entries(columnMap)) {
    const idx = headers.findIndex(h => aliases.includes(h));
    if (idx !== -1) {
      indices[key] = idx;
    }
  }

  // Validate required columns
  const required = ['ItemCode', 'BatchNum', 'Quantity'];
  for (const col of required) {
    if (indices[col] === undefined) {
      throw new Error(`Columna requerida no encontrada: ${col}`);
    }
  }

  // Parse data rows
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(separator).map(v => v.trim().replace(/"/g, ''));

    if (values.length < headers.length) continue;

    const record = {
      ItemCode: values[indices.ItemCode],
      BatchNum: values[indices.BatchNum],
      WhsCode: indices.WhsCode !== undefined ? values[indices.WhsCode] : '01',
      BinAbs: indices.BinAbs !== undefined ? parseInt(values[indices.BinAbs]) || null : null,
      Quantity: parseFloat(values[indices.Quantity]) || 0,
      ExpDate: indices.ExpDate !== undefined ? values[indices.ExpDate] : null,
      BinCode: indices.BinCode !== undefined ? values[indices.BinCode] : null,
    };

    if (record.Quantity > 0) {
      records.push(record);
    }
  }

  return records;
}

/**
 * Find location by warehouse code and bin
 */
async function findLocation(Locaciones, whsCode, binAbs, binCode) {
  // Try to find by bin code first (more reliable)
  if (binCode) {
    const loc = await Locaciones.findOne({
      'sapIntegration.warehouseCode': whsCode,
      $or: [
        { 'sapIntegration.binAbsEntry': binAbs },
        { 'sapIntegration.binCode': binCode },
        { name: binCode.replace(/^\d+-/, '') }, // Remove prefix like "10-CDC" -> "CDC"
      ],
    }).lean();
    if (loc) return loc;
  }

  // Try by bin abs entry
  if (binAbs) {
    const loc = await Locaciones.findOne({
      'sapIntegration.warehouseCode': whsCode,
      'sapIntegration.binAbsEntry': binAbs,
    }).lean();
    if (loc) return loc;
  }

  // Fallback to warehouse only
  const loc = await Locaciones.findOne({
    'sapIntegration.warehouseCode': whsCode,
    'sapIntegration.binAbsEntry': { $exists: false },
  }).lean();

  return loc;
}

/**
 * Update Inventario aggregation
 */
async function updateInventario(Lotes, Inventario, productId, locationId) {
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
    return acc;
  }, {
    quantityTotal: 0,
    quantityAvailable: 0,
    quantityConsigned: 0,
    quantityConsumed: 0,
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

async function main() {
  console.log('='.repeat(60));
  console.log('Importar Inventario desde CSV');
  console.log('='.repeat(60));
  console.log(`Archivo: ${csvFile}`);
  console.log(`Dry Run: ${DRY_RUN ? 'SÍ (sin cambios)' : 'NO'}`);
  console.log('');

  // Check file exists
  const fullPath = path.resolve(csvFile);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Archivo no encontrado: ${fullPath}`);
  }

  // Parse CSV
  console.log('Leyendo CSV...');
  const records = parseCSV(fullPath);
  console.log(`Registros encontrados: ${records.length}`);
  console.log('');

  // Connect to MongoDB
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    throw new Error('MONGODB_URI no encontrada en .env');
  }

  console.log('Conectando a MongoDB...');
  await mongoose.connect(dbUri);
  console.log('Conectado');

  // Get models
  const db = mongoose.connection.useDb(DB_NAME, { useCache: true });
  const Productos = db.model('productos', productoSchema);
  const Lotes = db.model('lotes', loteSchema);
  const Inventario = db.model('inventario', inventarioSchema);
  const Locaciones = db.model('locaciones', locacionSchema);

  // Load products and locations for mapping
  const products = await Productos.find({ sapItemCode: { $exists: true } }).lean();
  const productMap = new Map(products.map(p => [p.sapItemCode, p]));
  console.log(`Productos cargados: ${products.length}`);

  const locations = await Locaciones.find({ active: true }).lean();
  console.log(`Ubicaciones cargadas: ${locations.length}`);
  console.log('');

  // Stats
  const stats = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Process records
  console.log('-'.repeat(60));
  console.log('Procesando registros...');
  console.log('-'.repeat(60));

  for (const record of records) {
    stats.processed++;

    // Find product
    const product = productMap.get(record.ItemCode);
    if (!product) {
      if (VERBOSE) {
        console.log(`  ⚠ Producto no encontrado: ${record.ItemCode}`);
      }
      stats.skipped++;
      continue;
    }

    // Find location
    const location = await findLocation(Locaciones, record.WhsCode, record.BinAbs, record.BinCode);
    if (!location) {
      if (VERBOSE) {
        console.log(`  ⚠ Ubicación no encontrada: ${record.WhsCode}/${record.BinCode || record.BinAbs}`);
      }
      stats.skipped++;
      continue;
    }

    if (VERBOSE) {
      console.log(`  ${record.ItemCode} / ${record.BatchNum} → ${location.name}: ${record.Quantity}`);
    }

    if (DRY_RUN) {
      stats.created++;
      continue;
    }

    // Create or update lote
    try {
      const existingLote = await Lotes.findOne({
        productId: product._id,
        lotNumber: record.BatchNum,
        currentLocationId: location._id,
      });

      if (existingLote) {
        existingLote.quantityTotal = record.Quantity;
        existingLote.quantityAvailable = record.Quantity;
        if (record.ExpDate) {
          existingLote.expiryDate = new Date(record.ExpDate);
        }
        existingLote.historia.push({
          fecha: new Date(),
          accion: 'CSV Import',
          detalles: `Actualizado: qty=${record.Quantity}`,
        });
        await existingLote.save();
        stats.updated++;
      } else {
        const newLote = new Lotes({
          productId: product._id,
          lotNumber: record.BatchNum,
          currentLocationId: location._id,
          quantityTotal: record.Quantity,
          quantityAvailable: record.Quantity,
          quantityConsigned: 0,
          quantityConsumed: 0,
          expiryDate: record.ExpDate ? new Date(record.ExpDate) : new Date('2030-12-31'),
          receivedDate: new Date(),
          supplier: 'CSV Import',
          status: 'ACTIVE',
          historia: [{
            fecha: new Date(),
            accion: 'CSV Import',
            detalles: `Importado: qty=${record.Quantity}`,
          }],
        });
        await newLote.save();
        stats.created++;
      }

      // Update inventario
      await updateInventario(Lotes, Inventario, product._id, location._id);

    } catch (error) {
      if (error.code === 11000) {
        stats.skipped++;
      } else {
        stats.errors.push({
          record,
          message: error.message,
        });
      }
    }
  }

  // Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('Importación Completa');
  console.log('='.repeat(60));
  console.log(`Registros procesados: ${stats.processed}`);
  console.log(`Lotes creados: ${stats.created}`);
  console.log(`Lotes actualizados: ${stats.updated}`);
  console.log(`Omitidos: ${stats.skipped}`);
  console.log(`Errores: ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nErrores:');
    for (const err of stats.errors.slice(0, 5)) {
      console.log(`  - ${err.record.ItemCode}/${err.record.BatchNum}: ${err.message}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n*** DRY RUN - No se guardaron cambios ***');
  }

  await mongoose.disconnect();
  console.log('\n¡Listo!');
}

// Run
main().catch(error => {
  console.error('Error fatal:', error);
  process.exit(1);
});
