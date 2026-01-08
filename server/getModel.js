const mongoose = require('mongoose');
const { mongoDb } = require('./connection');

// Import schemas (will be created)
const productoSchema = require('./models/productoModel');
const locacionSchema = require('./models/locacionModel');
const inventarioSchema = require('./models/inventarioModel');
const transaccionSchema = require('./models/transaccionModel');
const ordenCompraSchema = require('./models/ordenCompraModel');
const loteSchema = require('./models/loteModel');
const inventarioObjetivosSchema = require('./models/inventarioObjetivosModel');
const consignacionSchema = require('./models/consignacionModel');
const usersSchema = require('./models/usersModel');
const companySchema = require('./models/companyModel');

/**
 * Get a database connection for a specific tenant's vasculares data
 * Database naming convention: {companyId}_vasculares
 */
const getVascularesDb = async (companyId, modelName, schema) => {
  try {
    await mongoDb; // Wait for the connection to be established
    const dbName = `${companyId}_vasculares`;
    const db = mongoose.connection.useDb(dbName, { useCache: true });
    if (!db.models[modelName]) {
      db.model(modelName, schema);
    }
    return db;
  } catch (error) {
    console.error('Could not get vasculares database:', error);
    throw error;
  }
};

/**
 * Get a database connection for shared databases (users, company)
 * These databases are shared with Xirugias and Nomina apps
 */
const getSharedDb = async (databaseName, modelName, schema) => {
  try {
    await mongoDb;
    const db = mongoose.connection.useDb(databaseName, { useCache: true });
    if (!db.models[modelName]) {
      db.model(modelName, schema);
    }
    return db;
  } catch (error) {
    console.error('Could not get shared database:', error);
    throw error;
  }
};

// ============================================
// VASCULARES-SPECIFIC MODELS (per-tenant _vasculares database)
// ============================================

/**
 * Get Productos model for a specific company
 * Stored in: {companyId}_vasculares database
 */
exports.getProductosModel = async (companyId) => {
  const db = await getVascularesDb(companyId, 'productos', productoSchema);
  return db.model('productos');
};

/**
 * Get Locaciones model for a specific company
 * Stored in: {companyId}_vasculares database
 */
exports.getLocacionesModel = async (companyId) => {
  const db = await getVascularesDb(companyId, 'locaciones', locacionSchema);
  return db.model('locaciones');
};

/**
 * Get Inventario model for a specific company
 * Stored in: {companyId}_vasculares database
 */
exports.getInventarioModel = async (companyId) => {
  const db = await getVascularesDb(companyId, 'inventario', inventarioSchema);
  return db.model('inventario');
};

/**
 * Get Transacciones model for a specific company
 * Stored in: {companyId}_vasculares database
 */
exports.getTransaccionesModel = async (companyId) => {
  const db = await getVascularesDb(companyId, 'transacciones', transaccionSchema);
  return db.model('transacciones');
};

/**
 * Get OrdenesCompra model for a specific company
 * Stored in: {companyId}_vasculares database
 */
exports.getOrdenesCompraModel = async (companyId) => {
  const db = await getVascularesDb(companyId, 'ordenes_compra', ordenCompraSchema);
  return db.model('ordenes_compra');
};

/**
 * Get Lotes model for a specific company
 * Stored in: {companyId}_vasculares database
 */
exports.getLotesModel = async (companyId) => {
  const db = await getVascularesDb(companyId, 'lotes', loteSchema);
  return db.model('lotes');
};

/**
 * Get InventarioObjetivos model for a specific company
 * Stored in: {companyId}_vasculares database
 * Defines target stock levels per product per location
 */
exports.getInventarioObjetivosModel = async (companyId) => {
  const db = await getVascularesDb(companyId, 'inventario_objetivos', inventarioObjetivosSchema);
  return db.model('inventario_objetivos');
};

/**
 * Get Consignaciones model for a specific company
 * Stored in: {companyId}_vasculares database
 * Tracks bulk consignments from warehouse to centros
 */
exports.getConsignacionesModel = async (companyId) => {
  const db = await getVascularesDb(companyId, 'consignaciones', consignacionSchema);
  return db.model('consignaciones');
};

// ============================================
// SHARED MODELS (same databases as Xirugias and Nomina)
// ============================================

/**
 * Get Users model from shared users database
 * This is the central authentication database shared with Xirugias and Nomina
 */
exports.getUserModel = async () => {
  const db = await getSharedDb('users', 'users', usersSchema);
  return db.model('users');
};

/**
 * Get Company model from shared company database
 * Contains company info, subscriptions, configuration
 */
exports.getCompanyModel = async () => {
  const db = await getSharedDb('company', 'infos', companySchema);
  return db.model('infos');
};

/**
 * Get local users from a tenant's database
 * This is for accessing user data within a company's local database
 */
exports.getLocalUsersModel = async (companyId) => {
  try {
    await mongoDb;
    // Access the tenant's main database (Xirugias database)
    const db = mongoose.connection.useDb(companyId, { useCache: true });
    if (!db.models['users']) {
      db.model('users', usersSchema);
    }
    return db.model('users');
  } catch (error) {
    console.error('Could not get local users:', error);
    throw error;
  }
};

// Export database helpers for advanced use cases
exports.getVascularesDb = getVascularesDb;
exports.getSharedDb = getSharedDb;
