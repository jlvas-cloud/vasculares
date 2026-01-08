/**
 * Inventario Objetivos Routes
 * Endpoints for managing per-location inventory targets
 */
const express = require('express');
const router = express.Router();
const inventarioObjetivosController = require('../controllers/inventarioObjetivos');
const { verifyUser, getCompanyId } = require('../util/authenticate');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Routes
router.get('/', inventarioObjetivosController.list);
router.get('/:id', inventarioObjetivosController.getOne);
router.post('/', inventarioObjetivosController.upsert); // Create or update
router.put('/:id', inventarioObjetivosController.update);
router.delete('/:id', inventarioObjetivosController.remove);

module.exports = router;
