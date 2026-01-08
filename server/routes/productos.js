const express = require('express');
const router = express.Router();
const productosController = require('../controllers/productos');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body } = require('express-validator');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation rules
const validateProduct = [
  body('name').trim().notEmpty().withMessage('Nombre es requerido'),
  body('code').isInt().withMessage('Código debe ser un número'),
  body('category').isIn(['GUIAS', 'STENTS_CORONARIOS']).withMessage('Categoría inválida'),
];

// Routes
router.get('/categorias', productosController.getCategories);
router.get('/', productosController.list);
router.get('/:id', productosController.getOne);
router.post('/', validateProduct, productosController.create);
router.put('/:id', validateProduct, productosController.update);
router.delete('/:id', productosController.deactivate);

module.exports = router;
