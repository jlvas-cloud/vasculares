/**
 * Consumption Routes
 * Endpoints for recording consumption at Centros with SAP integration
 */
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const consumptionController = require('../controllers/consumption');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { packingListUpload, handleUploadError } = require('../middleware/upload');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation for consumption creation
const validateConsumption = [
  body('centroId').notEmpty().withMessage('Centro es requerido'),
  body('items').isArray({ min: 1 }).withMessage('Se requiere al menos un item'),
  body('items.*.loteId').notEmpty().withMessage('Lote es requerido para cada item'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Cantidad debe ser mayor a 0'),
];

// Get available inventory at a Centro
router.get('/inventory/:centroId', consumptionController.getAvailableInventory);

// Extract consumption data from documents
router.post('/extract', packingListUpload, handleUploadError, consumptionController.extractFromDocument);

// Pre-operation guard: validate SAP stock before creating consumption
router.post('/validate-sap-stock', consumptionController.validateSapStock);

// Create consumption
router.post('/', validateConsumption, consumptionController.create);

// Get consumption history
router.get('/history', consumptionController.getHistory);

// Get single consumption
router.get('/:id', consumptionController.getOne);

// Retry SAP sync
router.post('/:id/retry-sap', consumptionController.retrySap);

module.exports = router;
