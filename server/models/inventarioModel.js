/**
 * Inventario (Inventory) Schema
 * Aggregated inventory per product per location
 * This is computed/updated from Lotes data
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const inventarioSchema = new Schema({
  productId: {
    type: mongoose.Types.ObjectId,
    ref: 'productos',
    required: true,
  },
  locationId: {
    type: mongoose.Types.ObjectId,
    ref: 'locaciones',
    required: true,
  },

  // Aggregated quantities (sum of all lotes at this location)
  quantityTotal: {
    type: Number,
    default: 0,
    min: 0,
  },
  quantityAvailable: {
    type: Number,
    default: 0,
    min: 0,
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
  quantityExpired: {
    type: Number,
    default: 0,
    min: 0,
  },

  // Metadata
  lastMovementDate: {
    type: Date,
  },
  lastReceivedDate: {
    type: Date,
  },
  lastConsumedDate: {
    type: Date,
  },

  // Alerts
  alerts: [{
    type: String,
    date: Date,
    message: String,
  }],

  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Indexes for fast lookups
inventarioSchema.index({ productId: 1, locationId: 1 }, { unique: true });
inventarioSchema.index({ locationId: 1 });
inventarioSchema.index({ productId: 1 });
inventarioSchema.index({ quantityAvailable: 1 });

// Virtual: Is stock low?
inventarioSchema.virtual('isLowStock').get(function() {
  // This would compare against location's minStock threshold
  return this.quantityAvailable <= 5; // Simple default
});

module.exports = inventarioSchema;
