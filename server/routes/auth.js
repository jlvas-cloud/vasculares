const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth');
const { verifyUser, getCompanyId } = require('../util/authenticate');

// Public routes
router.post('/login', authController.login);

// Protected routes (require authentication)
router.get('/verify', verifyUser, getCompanyId, authController.verify);
router.get('/me', verifyUser, getCompanyId, authController.getMe);

module.exports = router;
