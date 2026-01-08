const express = require('express');
const router = express.Router();
const inventarioController = require('../controllers/inventario');
const { verifyUser, getCompanyId } = require('../util/authenticate');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Inventory routes
router.get('/', inventarioController.getSummary);
router.get('/location/:locationId', inventarioController.getByLocation);
router.get('/product/:productId', inventarioController.getByProduct);
router.get('/alerts', inventarioController.getAlerts);

// Lotes routes
router.get('/lotes', inventarioController.getLotes);
router.get('/lotes/location/:locationId', inventarioController.getLotesByLocation);
router.get('/lotes/expiring', inventarioController.getExpiringLotes);

// Dashboard
router.get('/dashboard/stats', inventarioController.getDashboardStats);

module.exports = router;
