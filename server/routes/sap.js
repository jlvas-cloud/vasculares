/**
 * SAP Routes
 * Endpoints for SAP Business One integration
 */
const express = require('express');
const router = express.Router();
const sapController = require('../controllers/sap');
const { verifyUser, getCompanyId } = require('../util/authenticate');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Connection test
router.get('/test', sapController.testConnection);

// SAP master data
router.get('/warehouses', sapController.getWarehouses);
router.get('/bin-locations', sapController.getBinLocations);
router.get('/items', sapController.getItems);
router.get('/suppliers', sapController.getSuppliers);

// Inventory and batch data
router.get('/batch-stock', sapController.getBatchStock);
router.get('/inventory', sapController.getInventoryForPlanning);

// Stock transfers (used by consignaciones)
router.post('/stock-transfer', sapController.createStockTransfer);

module.exports = router;
