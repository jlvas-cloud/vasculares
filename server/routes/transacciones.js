const express = require('express');
const router = express.Router();
const transaccionesController = require('../controllers/transacciones');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body } = require('express-validator');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation rules for warehouse receipt
const validateWarehouseReceipt = [
  body('productId').notEmpty().withMessage('Producto es requerido'),
  body('locationId').notEmpty().withMessage('Locación es requerida'),
  body('lotNumber').trim().notEmpty().withMessage('Número de lote es requerido'),
  body('quantity').isInt({ min: 1 }).withMessage('Cantidad debe ser mayor a 0'),
  body('expiryDate').isISO8601().withMessage('Fecha de vencimiento inválida'),
];

// Validation rules for consignment out
const validateConsignmentOut = [
  body('productId').notEmpty().withMessage('Producto es requerido'),
  body('lotId').notEmpty().withMessage('Lote es requerido'),
  body('fromLocationId').notEmpty().withMessage('Locación de origen es requerida'),
  body('toLocationId').notEmpty().withMessage('Locación de destino es requerida'),
  body('quantity').isInt({ min: 1 }).withMessage('Cantidad debe ser mayor a 0'),
];

// Validation rules for consumption
const validateConsumption = [
  body('productId').notEmpty().withMessage('Producto es requerido'),
  body('lotId').notEmpty().withMessage('Lote es requerido'),
  body('locationId').notEmpty().withMessage('Locación es requerida'),
  body('quantity').isInt({ min: 1 }).withMessage('Cantidad debe ser mayor a 0'),
];

// Routes
router.get('/', transaccionesController.list);
router.get('/:id', transaccionesController.getOne);
router.post('/warehouse-receipt', validateWarehouseReceipt, transaccionesController.warehouseReceipt);
router.post('/consignment-out', validateConsignmentOut, transaccionesController.consignmentOut);
router.post('/consumption', validateConsumption, transaccionesController.consumption);

module.exports = router;
