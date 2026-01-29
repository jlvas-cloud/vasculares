/**
 * UserProfiles Controller
 * Manages user roles and SAP credentials
 */
const { getUserProfilesModel, getLocalUsersModel } = require('../getModel');
const encryptionService = require('../services/encryptionService');
const sapService = require('../services/sapService');

/**
 * GET /api/user-profiles/me
 * Get current user's profile (creates if doesn't exist)
 */
exports.getMyProfile = async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const userId = req.user._id;

    const UserProfiles = await getUserProfilesModel(companyId);

    let profile = await UserProfiles.findOne({ userId, companyId });

    // Auto-create profile for new users with default role
    if (!profile) {
      profile = new UserProfiles({
        userId,
        companyId,
        role: 'viewer', // Default role
        isActive: true
      });
      await profile.save();
    }

    res.json({
      ...profile.toObject(),
      // Never send encrypted password
      sapCredentials: profile.sapCredentials ? {
        username: profile.sapCredentials.username,
        hasPassword: !!profile.sapCredentials.password,
        lastVerified: profile.sapCredentials.lastVerified
      } : null
    });
  } catch (error) {
    console.error('Error getting profile:', error);
    next(error);
  }
};

/**
 * PUT /api/user-profiles/sap-credentials
 * Save or update SAP credentials for current user
 */
exports.saveSapCredentials = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const companyId = req.companyId;
    const userId = req.user._id;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Check encryption is configured
    if (!encryptionService.isConfigured()) {
      return res.status(500).json({ error: 'Encryption not configured. Contact administrator.' });
    }

    const UserProfiles = await getUserProfilesModel(companyId);

    let profile = await UserProfiles.findOne({ userId, companyId });
    if (!profile) {
      profile = new UserProfiles({ userId, companyId, role: 'viewer' });
    }

    // Encrypt password
    const { encrypted, iv, authTag } = encryptionService.encrypt(password);

    profile.sapCredentials = {
      username,
      password: encrypted,
      iv,
      authTag,
      lastVerified: null // Will be set on successful test
    };

    await profile.save();

    res.json({
      success: true,
      message: 'SAP credentials saved. Please test the connection.',
      sapCredentials: {
        username: profile.sapCredentials.username,
        hasPassword: true,
        lastVerified: null
      }
    });
  } catch (error) {
    console.error('Error saving SAP credentials:', error);
    next(error);
  }
};

/**
 * POST /api/user-profiles/sap-credentials/test
 * Test SAP credentials by attempting to login
 */
exports.testSapCredentials = async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const userId = req.user._id;

    const UserProfiles = await getUserProfilesModel(companyId);
    const profile = await UserProfiles.findOne({ userId, companyId });

    if (!profile?.sapCredentials?.password) {
      return res.status(400).json({ error: 'No SAP credentials configured' });
    }

    // Decrypt password
    const password = encryptionService.decrypt(
      profile.sapCredentials.password,
      profile.sapCredentials.iv,
      profile.sapCredentials.authTag
    );

    // Attempt SAP login
    try {
      await sapService.testUserCredentials(
        profile.sapCredentials.username,
        password
      );

      // Update lastVerified on success
      profile.sapCredentials.lastVerified = new Date();
      await profile.save();

      res.json({
        success: true,
        message: 'SAP connection successful',
        lastVerified: profile.sapCredentials.lastVerified
      });
    } catch (sapError) {
      res.status(400).json({
        success: false,
        error: 'SAP authentication failed',
        message: sapError.message || 'Invalid username or password'
      });
    }
  } catch (error) {
    console.error('Error testing SAP credentials:', error);
    next(error);
  }
};

/**
 * DELETE /api/user-profiles/sap-credentials
 * Remove SAP credentials for current user
 */
exports.deleteSapCredentials = async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const userId = req.user._id;

    const UserProfiles = await getUserProfilesModel(companyId);
    const profile = await UserProfiles.findOne({ userId, companyId });

    if (profile) {
      profile.sapCredentials = undefined;
      await profile.save();
    }

    res.json({ success: true, message: 'SAP credentials removed' });
  } catch (error) {
    console.error('Error deleting SAP credentials:', error);
    next(error);
  }
};

// ============================================
// ADMIN ENDPOINTS (User Management)
// ============================================

/**
 * GET /api/user-profiles
 * Get all user profiles (admin only)
 */
exports.getAllProfiles = async (req, res, next) => {
  try {
    const companyId = req.companyId;

    const UserProfiles = await getUserProfilesModel(companyId);
    const Users = await getLocalUsersModel(companyId);

    // Get all profiles for this company
    const profiles = await UserProfiles.find({ companyId }).lean();

    // Get user details from shared database
    const userIds = profiles.map(p => p.userId);
    const users = await Users.find({ _id: { $in: userIds } })
      .select('firstname lastname email')
      .lean();

    const usersMap = {};
    users.forEach(u => { usersMap[u._id.toString()] = u; });

    // Combine profile with user data
    const enrichedProfiles = profiles.map(profile => ({
      ...profile,
      user: usersMap[profile.userId.toString()] || null,
      sapCredentials: profile.sapCredentials ? {
        username: profile.sapCredentials.username,
        hasPassword: !!profile.sapCredentials.password,
        lastVerified: profile.sapCredentials.lastVerified
      } : null
    }));

    res.json(enrichedProfiles);
  } catch (error) {
    console.error('Error getting all profiles:', error);
    next(error);
  }
};

/**
 * GET /api/user-profiles/available-users
 * Get users who don't have a profile yet (for adding new users)
 */
exports.getAvailableUsers = async (req, res, next) => {
  try {
    const companyId = req.companyId;

    const UserProfiles = await getUserProfilesModel(companyId);
    const Users = await getLocalUsersModel(companyId);

    // Get existing profile userIds (keep as ObjectIds for proper $nin comparison)
    const existingProfiles = await UserProfiles.find({ companyId }).select('userId').lean();
    const existingUserIds = existingProfiles.map(p => p.userId);

    // Get all active users from company who don't have a profile
    const availableUsers = await Users.find({
      _id: { $nin: existingUserIds },
      status: 'active'
    })
      .select('firstname lastname email')
      .lean();

    res.json(availableUsers);
  } catch (error) {
    console.error('Error getting available users:', error);
    next(error);
  }
};

/**
 * POST /api/user-profiles
 * Create a new user profile (admin only)
 */
exports.createProfile = async (req, res, next) => {
  try {
    const { userId, role } = req.body;
    const companyId = req.companyId;

    if (!userId || !role) {
      return res.status(400).json({ error: 'userId and role are required' });
    }

    const UserProfiles = await getUserProfilesModel(companyId);

    // Check if profile already exists
    const existing = await UserProfiles.findOne({ userId, companyId });
    if (existing) {
      return res.status(409).json({ error: 'Profile already exists for this user' });
    }

    // Validate role
    const validRoles = UserProfiles.schema.statics.getRoles();
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const profile = new UserProfiles({
      userId,
      companyId,
      role,
      isActive: true
    });

    await profile.save();

    res.status(201).json(profile);
  } catch (error) {
    console.error('Error creating profile:', error);
    next(error);
  }
};

/**
 * PUT /api/user-profiles/:id/role
 * Update a user's role (admin only)
 */
exports.updateRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const companyId = req.companyId;
    const currentUserId = req.user._id.toString();

    if (!role) {
      return res.status(400).json({ error: 'role is required' });
    }

    const UserProfiles = await getUserProfilesModel(companyId);

    const profile = await UserProfiles.findOne({ _id: id, companyId });
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Prevent admin from demoting themselves
    if (profile.userId.toString() === currentUserId && profile.role === 'admin' && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot demote yourself from admin' });
    }

    // Validate role
    const validRoles = UserProfiles.schema.statics.getRoles();
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    profile.role = role;
    await profile.save();

    res.json(profile);
  } catch (error) {
    console.error('Error updating role:', error);
    next(error);
  }
};

/**
 * PUT /api/user-profiles/:id/status
 * Activate or deactivate a user (admin only)
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const companyId = req.companyId;
    const currentUserId = req.user._id.toString();

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const UserProfiles = await getUserProfilesModel(companyId);

    const profile = await UserProfiles.findOne({ _id: id, companyId });
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Prevent admin from deactivating themselves
    if (profile.userId.toString() === currentUserId && !isActive) {
      return res.status(400).json({ error: 'Cannot deactivate yourself' });
    }

    profile.isActive = isActive;
    await profile.save();

    res.json(profile);
  } catch (error) {
    console.error('Error updating status:', error);
    next(error);
  }
};

/**
 * GET /api/user-profiles/roles
 * Get available roles and their permissions
 */
exports.getRoles = async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const UserProfiles = await getUserProfilesModel(companyId);

    const roles = UserProfiles.schema.statics.getRoles();
    const rolesRequiringSap = UserProfiles.schema.statics.getRolesRequiringSap();

    const rolesInfo = roles.map(role => ({
      role,
      permissions: UserProfiles.schema.statics.getPermissionsForRole(role),
      requiresSap: rolesRequiringSap.includes(role)
    }));

    res.json(rolesInfo);
  } catch (error) {
    console.error('Error getting roles:', error);
    next(error);
  }
};
