/**
 * Locacion (Location) Schema
 * Centers and warehouses that hold consignment inventory
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
    enum: ['CENTRO', 'WAREHOUSE'],
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

  // SAP Business One Integration
  sapIntegration: {
    warehouseCode: {
      type: String,
      description: 'SAP B1 WarehouseCode - "01" for Principal, "10" for Consignacion',
    },
    binAbsEntry: {
      type: Number,
      description: 'SAP B1 Bin Location AbsEntry - for CENTROs within warehouse 10',
    },
    binCode: {
      type: String,
      description: 'SAP B1 Bin Location Code (e.g., "10-CECANOR")',
    },
    // Customer info for DeliveryNotes (Entregas) - used for consumption
    cardCode: {
      type: String,
      description: 'SAP B1 Customer CardCode (e.g., "C00013" for CECANOR)',
    },
    cardName: {
      type: String,
      description: 'SAP B1 Customer name',
    },
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
locacionSchema.index({ 'sapIntegration.binAbsEntry': 1 }, { sparse: true });

module.exports = locacionSchema;
