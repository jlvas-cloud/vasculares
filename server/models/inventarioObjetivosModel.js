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

  // Stock Objetivo for this product at this location
  targetStock: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Stock Objetivo - ideal quantity to maintain at this location',
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
