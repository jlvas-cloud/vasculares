/**
 * Reconciliation Routes
 * API endpoints for SAP document reconciliation
 */
const express = require('express');
const router = express.Router();
const reconciliationController = require('../controllers/reconciliation');
const { verifyUser, getCompanyId } = require('../util/authenticate');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Trigger on-demand reconciliation
router.post('/run', reconciliationController.triggerRun);

// Get reconciliation status (latest run + pending count)
router.get('/status', reconciliationController.getStatus);

// Get run history
router.get('/runs', reconciliationController.getRunHistory);

// Get external documents
router.get('/external-documents', reconciliationController.getExternalDocuments);

// Update external document status
router.put('/external-documents/:id/status', reconciliationController.updateDocumentStatus);

// Get reconciliation config (goLiveDate, etc.)
router.get('/config', reconciliationController.getConfig);

// Set goLiveDate manually
router.put('/config/go-live-date', reconciliationController.setGoLiveDate);

module.exports = router;
