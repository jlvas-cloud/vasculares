/**
 * Permission Middleware
 * Checks user roles and permissions for protected routes
 */
const { getUserProfilesModel } = require('../getModel');
const encryptionService = require('../services/encryptionService');

/**
 * Load user profile and attach to request
 * Call this early in the middleware chain
 */
const loadUserProfile = async (req, res, next) => {
  try {
    if (!req.user || !req.companyId) {
      return next(); // No user logged in, skip
    }

    const UserProfiles = await getUserProfilesModel(req.companyId);
    let profile = await UserProfiles.findOne({
      userId: req.user._id,
      companyId: req.companyId
    });

    // Auto-create profile for new users
    if (!profile) {
      profile = new UserProfiles({
        userId: req.user._id,
        companyId: req.companyId,
        role: 'viewer',
        isActive: true
      });
      await profile.save();
    }

    // Check if user is active
    if (!profile.isActive) {
      return res.status(403).json({
        error: 'Account deactivated',
        code: 'ACCOUNT_DEACTIVATED',
        message: 'Tu cuenta ha sido desactivada. Contacta al administrador.'
      });
    }

    // Attach profile to request
    req.userProfile = profile;
    req.userPermissions = profile.getPermissions();

    next();
  } catch (error) {
    console.error('Error loading user profile:', error);
    next(error);
  }
};

/**
 * Require a specific permission
 * @param {string} permission - Required permission
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.userProfile) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!req.userProfile.hasPermission(permission)) {
      return res.status(403).json({
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
        message: `No tienes permiso para esta acción (requiere: ${permission})`,
        requiredPermission: permission,
        userRole: req.userProfile.role
      });
    }

    next();
  };
};

/**
 * Require one of multiple permissions
 * @param {string[]} permissions - Array of permissions (user needs at least one)
 */
const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    if (!req.userProfile) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const hasAny = permissions.some(p => req.userProfile.hasPermission(p));
    if (!hasAny) {
      return res.status(403).json({
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
        message: `No tienes permiso para esta acción`,
        requiredPermissions: permissions,
        userRole: req.userProfile.role
      });
    }

    next();
  };
};

/**
 * Require specific role(s)
 * @param {string|string[]} roles - Required role(s)
 */
const requireRole = (roles) => {
  const roleArray = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.userProfile) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!roleArray.includes(req.userProfile.role)) {
      return res.status(403).json({
        error: 'Role required',
        code: 'ROLE_REQUIRED',
        message: `Esta acción requiere rol: ${roleArray.join(' o ')}`,
        requiredRoles: roleArray,
        userRole: req.userProfile.role
      });
    }

    next();
  };
};

/**
 * Require SAP credentials for operations that need them
 * Returns user's decrypted SAP credentials if valid
 */
const requireSapCredentials = async (req, res, next) => {
  try {
    if (!req.userProfile) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    // Check if role requires SAP credentials
    const rolesRequiringSap = ['admin', 'almacen'];
    if (!rolesRequiringSap.includes(req.userProfile.role)) {
      // Role doesn't need SAP, skip
      return next();
    }

    // Check if credentials are configured
    if (!req.userProfile.sapCredentials?.password) {
      return res.status(403).json({
        error: 'SAP credentials required',
        code: 'SAP_CREDENTIALS_MISSING',
        message: 'Configura tus credenciales SAP para realizar esta operación'
      });
    }

    // Check encryption is configured
    if (!encryptionService.isConfigured()) {
      return res.status(500).json({
        error: 'System configuration error',
        code: 'ENCRYPTION_NOT_CONFIGURED',
        message: 'Error de configuración del sistema. Contacta al administrador.'
      });
    }

    // Decrypt and attach credentials
    try {
      const decryptedPassword = encryptionService.decrypt(
        req.userProfile.sapCredentials.password,
        req.userProfile.sapCredentials.iv,
        req.userProfile.sapCredentials.authTag
      );

      req.sapCredentials = {
        username: req.userProfile.sapCredentials.username,
        password: decryptedPassword
      };

      next();
    } catch (decryptError) {
      console.error('Error decrypting SAP credentials:', decryptError);
      return res.status(500).json({
        error: 'Credential error',
        code: 'SAP_CREDENTIALS_INVALID',
        message: 'Error con las credenciales SAP. Por favor, configúralas de nuevo.'
      });
    }
  } catch (error) {
    console.error('Error in requireSapCredentials:', error);
    next(error);
  }
};

module.exports = {
  loadUserProfile,
  requirePermission,
  requireAnyPermission,
  requireRole,
  requireSapCredentials
};
