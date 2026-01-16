/**
 * UserProfile Schema
 * App-specific user data (roles, SAP credentials)
 * Links to shared user database via userId
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ROLES = ['admin', 'almacen', 'sales', 'viewer'];

const PERMISSIONS = {
  admin: ['pedidos', 'goodsReceipts', 'consignments', 'viewInventory', 'editTargetStock', 'manageUsers'],
  almacen: ['pedidos', 'goodsReceipts', 'consignments', 'viewInventory'],
  sales: ['viewInventory', 'editTargetStock'],
  viewer: ['viewInventory']
};

// Roles that require SAP credentials for their operations
const ROLES_REQUIRING_SAP = ['admin', 'almacen'];

const userProfileSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    description: 'Reference to shared user database'
  },
  companyId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  role: {
    type: String,
    enum: ROLES,
    default: 'viewer'
  },
  sapCredentials: {
    username: {
      type: String,
      trim: true
    },
    password: {
      type: String,
      description: 'AES-256-GCM encrypted'
    },
    iv: {
      type: String,
      description: 'Initialization vector for decryption'
    },
    authTag: {
      type: String,
      description: 'Authentication tag for GCM mode'
    },
    lastVerified: {
      type: Date,
      description: 'Last successful SAP connection test'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Compound unique index: one profile per user per company
userProfileSchema.index({ userId: 1, companyId: 1 }, { unique: true });

// Virtual: check if user has SAP credentials configured
userProfileSchema.virtual('hasSapCredentials').get(function() {
  return !!(this.sapCredentials?.username && this.sapCredentials?.password);
});

// Virtual: check if role requires SAP credentials
userProfileSchema.virtual('requiresSapCredentials').get(function() {
  return ROLES_REQUIRING_SAP.includes(this.role);
});

// Method: get permissions for this user's role
userProfileSchema.methods.getPermissions = function() {
  return PERMISSIONS[this.role] || [];
};

// Method: check if user has a specific permission
userProfileSchema.methods.hasPermission = function(permission) {
  const permissions = this.getPermissions();
  return permissions.includes(permission);
};

// Static: get permissions for a role
userProfileSchema.statics.getPermissionsForRole = function(role) {
  return PERMISSIONS[role] || [];
};

// Static: get all roles
userProfileSchema.statics.getRoles = function() {
  return ROLES;
};

// Static: get roles requiring SAP
userProfileSchema.statics.getRolesRequiringSap = function() {
  return ROLES_REQUIRING_SAP;
};

// Ensure virtuals are included in JSON
userProfileSchema.set('toJSON', { virtuals: true });
userProfileSchema.set('toObject', { virtuals: true });

module.exports = userProfileSchema;
