const express = require('express');
const router = express.Router();
const transaccionesController = require('../controllers/transacciones');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body } = require('express-validator');

// All routes require authentication
router.use(verifyUser, getCompanyId);

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
router.post('/consumption', validateConsumption, transaccionesController.consumption);

module.exports = router;
