/**
 * Producto Schema
 * Catalog of vascular products (guidewires and coronary stents)
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const productoSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  code: {
    type: Number,
    required: true,
    unique: true,
  },
  missionCode: {
    type: Number,
    sparse: true,
  },
  category: {
    type: String,
    required: true,
    enum: ['GUIAS', 'STENTS_CORONARIOS'],
  },
  subcategory: {
    type: String,
    trim: true,
  },
  specifications: {
    size: { type: String },
    type: { type: String },
    description: { type: String },
  },
  inventorySettings: {
    targetStockWarehouse: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Ideal quantity to maintain in central warehouse',
    },
    reorderPoint: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Trigger reorder when stock falls below this level',
    },
    minStockLevel: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Minimum safety stock level',
    },
    maxStockLevel: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Maximum stock level to avoid overstocking',
    },
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

// Indexes for performance
productoSchema.index({ code: 1 });
productoSchema.index({ category: 1, active: 1 });
productoSchema.index({ name: 'text' }); // Text search

module.exports = productoSchema;
