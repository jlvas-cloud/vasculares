/**
 * Locacion (Location) Schema
 * Hospitals and warehouses that hold consignment inventory
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const locacionSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  fullName: {
    type: String,
    trim: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['HOSPITAL', 'WAREHOUSE', 'CLINIC'],
  },

  // Contact information
  address: {
    street: String,
    city: String,
    province: String,
    country: String,
    postalCode: String,
  },
  contact: {
    name: String,
    phone: String,
    email: String,
    position: String,
  },

  // Stock management settings
  stockLimits: {
    minStock: {
      type: Number,
      default: 0,
    },
    maxStock: {
      type: Number,
    },
    reorderPoint: {
      type: Number,
      default: 0,
    },
  },

  // Configuration
  settings: {
    allowConsignment: {
      type: Boolean,
      default: true,
    },
    requiresApproval: {
      type: Boolean,
      default: false,
    },
    notificationEmail: String,
  },

  active: {
    type: Boolean,
    default: true,
  },

  notes: {
    type: String,
  },

  createdBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
  },

  historia: [{
    fecha: Date,
    user: {
      _id: mongoose.Types.ObjectId,
      firstname: String,
      lastname: String,
    },
    accion: String,
  }],
}, { timestamps: true });

// Indexes
locacionSchema.index({ name: 1 });
locacionSchema.index({ type: 1, active: 1 });
locacionSchema.index({ active: 1 });

module.exports = locacionSchema;
