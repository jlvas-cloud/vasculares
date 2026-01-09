/**
 * Consignaciones Routes
 * Endpoints for managing bulk consignments from warehouse to centros
 */
const express = require('express');
const router = express.Router();
const consignacionesController = require('../controllers/consignaciones');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body } = require('express-validator');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation rules for creating consignment
// loteId and lotNumber are optional (if not provided, FIFO allocation is used)
const validateCreate = [
  body('fromLocationId').notEmpty().withMessage('From location (warehouse) is required'),
  body('toLocationId').notEmpty().withMessage('To location (centro) is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').notEmpty().withMessage('Product ID is required for each item'),
  body('items.*.quantitySent').isInt({ min: 1 }).withMessage('Quantity sent must be at least 1'),
  body('items.*.loteId').optional().isMongoId().withMessage('Lote ID must be a valid MongoDB ID'),
  body('items.*.lotNumber').optional().isString().withMessage('Lot number must be a string'),
];

// Validation rules for confirming receipt
const validateConfirm = [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').notEmpty().withMessage('Product ID is required for each item'),
  body('items.*.quantityReceived').isInt({ min: 0 }).withMessage('Quantity received must be a non-negative integer'),
];

// Routes
router.get('/', consignacionesController.list);
router.get('/:id', consignacionesController.getOne);
router.post('/', validateCreate, consignacionesController.create);
router.put('/:id/confirm', validateConfirm, consignacionesController.confirm);

module.exports = router;
