/**
 * Inventario Objetivos Routes
 * Endpoints for managing per-location inventory targets
 */
const express = require('express');
const router = express.Router();
const inventarioObjetivosController = require('../controllers/inventarioObjetivos');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body } = require('express-validator');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation rules for upsert
const validateUpsert = [
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('locationId').notEmpty().withMessage('Location ID is required'),
  body('targetStock').optional().isInt({ min: 0 }).withMessage('Stock objetivo must be a non-negative integer'),
];

// Validation rules for update
const validateUpdate = [
  body('targetStock').optional().isInt({ min: 0 }).withMessage('Stock objetivo must be a non-negative integer'),
];

// Routes
router.get('/', inventarioObjetivosController.list);
router.get('/:id', inventarioObjetivosController.getOne);
router.post('/', validateUpsert, inventarioObjetivosController.upsert); // Create or update
router.put('/:id', validateUpdate, inventarioObjetivosController.update);
router.delete('/:id', inventarioObjetivosController.remove);

module.exports = router;
