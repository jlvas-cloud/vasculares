/**
 * Pedidos Routes
 * Endpoints for managing supplier orders (internal tracking)
 */
const express = require('express');
const router = express.Router();
const pedidosController = require('../controllers/pedidos');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body, query } = require('express-validator');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation rules for creating pedido
const validateCreate = [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').notEmpty().withMessage('Product ID is required for each item'),
  body('items.*.quantityOrdered').isInt({ min: 1 }).withMessage('Quantity ordered must be at least 1'),
  body('orderDate').optional().isISO8601().withMessage('Order date must be a valid date'),
  body('expectedArrivalDate').optional().isISO8601().withMessage('Expected arrival date must be a valid date'),
];

// Validation rules for receiving items
const validateReceive = [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').notEmpty().withMessage('Product ID is required for each item'),
  body('items.*.quantityReceived').isInt({ min: 1 }).withMessage('Quantity received must be at least 1'),
];

// Routes - specific routes MUST come before parameterized routes

// Get pending quantities by product (for planning calculation)
router.get('/pending-by-product', pedidosController.getPendingByProduct);

// Suggest pedidos matching given product IDs (for GoodsReceipt linking)
router.get('/suggest-for-items', pedidosController.suggestForItems);

// CRUD routes
router.get('/', pedidosController.getAll);
router.post('/', validateCreate, pedidosController.create);
router.get('/:id', pedidosController.getById);
router.put('/:id', pedidosController.update);
router.delete('/:id', pedidosController.cancel);

// Receive items (update quantities received)
router.post('/:id/receive', validateReceive, pedidosController.receiveItems);

module.exports = router;
