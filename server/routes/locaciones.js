const express = require('express');
const router = express.Router();
const locacionesController = require('../controllers/locaciones');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body } = require('express-validator');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation rules
const validateLocation = [
  body('name').trim().notEmpty().withMessage('Nombre es requerido'),
  body('type').isIn(['HOSPITAL', 'WAREHOUSE', 'CLINIC']).withMessage('Tipo inválido'),
];

// Routes
router.get('/tipos', locacionesController.getTypes);
router.get('/', locacionesController.list);
router.get('/:id', locacionesController.getOne);
router.post('/', validateLocation, locacionesController.create);
router.put('/:id', validateLocation, locacionesController.update);
router.delete('/:id', locacionesController.deactivate);

module.exports = router;
