/**
 * Lote (Batch/Lot) Schema
 * Tracks batches of products with quantities
 * Used for both stents and guidewires
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const loteSchema = new Schema({
  productId: {
    type: mongoose.Types.ObjectId,
    ref: 'productos',
    required: true,
  },
  lotNumber: {
    type: String,
    required: true,
    trim: true,
  },
  expiryDate: {
    type: Date,
    required: true,
  },
  manufactureDate: {
    type: Date,
  },

  // Quantities
  quantityTotal: {
    type: Number,
    required: true,
    min: 0,
  },
  quantityAvailable: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  quantityConsigned: {
    type: Number,
    default: 0,
    min: 0,
  },
  quantityConsumed: {
    type: Number,
    default: 0,
    min: 0,
  },
  quantityDamaged: {
    type: Number,
    default: 0,
    min: 0,
  },
  quantityReturned: {
    type: Number,
    default: 0,
    min: 0,
  },

  // Current location
  currentLocationId: {
    type: mongoose.Types.ObjectId,
    ref: 'locaciones',
    required: true,
  },

  status: {
    type: String,
    enum: ['ACTIVE', 'DEPLETED', 'EXPIRED', 'RECALLED'],
    default: 'ACTIVE',
  },

  // Purchase info
  receivedDate: {
    type: Date,
    required: true,
  },
  purchaseOrderId: {
    type: mongoose.Types.ObjectId,
    ref: 'ordenes_compra',
  },
  supplier: {
    type: String,
    trim: true,
  },
  unitCost: {
    type: Number,
    min: 0,
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
    detalles: String,
  }],
}, { timestamps: true });

// Indexes
// Unique constraint: One lote record per (product, lotNumber, location)
// Multiple shipments of same lot to same location UPDATE the single record's quantity
// This prevents duplicate records from race conditions or bugs
loteSchema.index({ productId: 1, lotNumber: 1, currentLocationId: 1 }, { unique: true });
loteSchema.index({ currentLocationId: 1, status: 1 });
loteSchema.index({ expiryDate: 1, status: 1 });
loteSchema.index({ status: 1 });
// Keep non-unique index for queries that don't filter by location
loteSchema.index({ productId: 1, lotNumber: 1 });

// Virtual: Is this lot expiring soon? (within 90 days)
loteSchema.virtual('expiringSoon').get(function() {
  const daysUntilExpiry = Math.floor((this.expiryDate - new Date()) / (1000 * 60 * 60 * 24));
  return daysUntilExpiry <= 90 && daysUntilExpiry > 0;
});

// Virtual: Is this lot expired?
loteSchema.virtual('isExpired').get(function() {
  return this.expiryDate < new Date();
});

module.exports = loteSchema;
