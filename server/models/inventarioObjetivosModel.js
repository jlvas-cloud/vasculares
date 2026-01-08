/**
 * Inventario Objetivos (Inventory Targets) Schema
 * Defines target stock levels per product per location
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const inventarioObjetivosSchema = new Schema({
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

  // Target inventory levels for this product at this location
  targetStock: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Target quantity to maintain at this location',
  },
  reorderPoint: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Trigger consignment when stock falls below this level',
  },
  minStockLevel: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Minimum safety stock for this location',
  },

  // Auto-calculated metrics (updated periodically)
  avgMonthlyConsumption: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Average monthly consumption at this location (auto-calculated)',
  },
  lastCalculated: {
    type: Date,
    description: 'When avgMonthlyConsumption was last calculated',
  },

  // Coverage metrics
  daysOfCoverage: {
    type: Number,
    default: 0,
    description: 'Estimated days of stock remaining based on avg consumption',
  },

  // Metadata
  notes: {
    type: String,
    trim: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
  },
  updatedBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
  },
}, { timestamps: true });

// Compound index to ensure one target per product per location
inventarioObjetivosSchema.index({ productId: 1, locationId: 1 }, { unique: true });

// Indexes for queries
inventarioObjetivosSchema.index({ locationId: 1, active: 1 });
inventarioObjetivosSchema.index({ productId: 1, active: 1 });
inventarioObjetivosSchema.index({ avgMonthlyConsumption: -1 }); // For finding high-consumption items

module.exports = inventarioObjetivosSchema;
