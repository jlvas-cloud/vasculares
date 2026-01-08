const express = require('express');
const router = express.Router();
const productosController = require('../controllers/productos');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body } = require('express-validator');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation rules for creation
const validateProductCreate = [
  body('name').trim().notEmpty().withMessage('Nombre es requerido'),
  body('code').isInt().withMessage('Código debe ser un número'),
  body('category').isIn(['GUIAS', 'STENTS_CORONARIOS']).withMessage('Categoría inválida'),
];

// Validation rules for update (all optional)
const validateProductUpdate = [
  body('name').optional().trim().notEmpty().withMessage('Nombre no puede estar vacío'),
  body('code').optional().isInt().withMessage('Código debe ser un número'),
  body('category').optional().isIn(['GUIAS', 'STENTS_CORONARIOS']).withMessage('Categoría inválida'),
];

// Routes
router.get('/categorias', productosController.getCategories);
router.get('/', productosController.list);
router.get('/:id', productosController.getOne);
router.post('/', validateProductCreate, productosController.create);
router.put('/:id', validateProductUpdate, productosController.update);
router.delete('/:id', productosController.deactivate);

module.exports = router;
