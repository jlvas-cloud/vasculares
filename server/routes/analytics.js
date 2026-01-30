/**
 * Analytics Routes
 * Endpoints for consumption analytics and inventory insights
 */
const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics');
const { verifyUser, getCompanyId } = require('../util/authenticate');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Consumption analytics endpoints
router.get('/consumption/monthly', analyticsController.getMonthlyConsumption);
router.get('/consumption/by-location', analyticsController.getConsumptionByLocation);
router.get('/consumption/trends', analyticsController.getConsumptionTrends);
router.get('/consumption/by-size', analyticsController.getConsumptionBySize);

// Planning data endpoint (Excel-like view)
router.get('/planning-data', analyticsController.getPlanningData);

// Monthly movements per product per centro (trailing 12 months)
router.get('/monthly-movements', analyticsController.getMonthlyMovements);

// Dashboard consumption analytics (all centros, trailing 12 months)
router.get('/dashboard-consumption', analyticsController.getDashboardConsumption);

module.exports = router;
