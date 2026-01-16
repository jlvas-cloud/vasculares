/**
 * UserProfiles Routes
 * /api/user-profiles
 */
const express = require('express');
const router = express.Router();
const userProfilesController = require('../controllers/userProfiles');
const { verifyUser, getCompanyIdWithProfile } = require('../util/authenticate');
const { requirePermission } = require('../middleware/permissions');

// All routes require authentication
router.use(verifyUser, getCompanyIdWithProfile);

// ============================================
// CURRENT USER ENDPOINTS
// ============================================

// Get current user's profile
router.get('/me', userProfilesController.getMyProfile);

// SAP credentials management (current user)
router.put('/sap-credentials', userProfilesController.saveSapCredentials);
router.post('/sap-credentials/test', userProfilesController.testSapCredentials);
router.delete('/sap-credentials', userProfilesController.deleteSapCredentials);

// ============================================
// ADMIN ENDPOINTS (require manageUsers permission)
// ============================================

// Get available roles info
router.get('/roles', userProfilesController.getRoles);

// Get all profiles (admin)
router.get('/', requirePermission('manageUsers'), userProfilesController.getAllProfiles);

// Get users without profiles (admin)
router.get('/available-users', requirePermission('manageUsers'), userProfilesController.getAvailableUsers);

// Create new profile (admin)
router.post('/', requirePermission('manageUsers'), userProfilesController.createProfile);

// Update user role (admin)
router.put('/:id/role', requirePermission('manageUsers'), userProfilesController.updateRole);

// Update user status (admin)
router.put('/:id/status', requirePermission('manageUsers'), userProfilesController.updateStatus);

module.exports = router;
