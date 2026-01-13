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
  // SAP Business One Integration
  sapItemCode: {
    type: String,
    sparse: true,
    description: 'SAP B1 ItemCode for API integration (same as code, as string)',
  },
  legacyCode: {
    type: Number,
    sparse: true,
    description: 'Old Orsiro code equivalent - for reference when old inventory exists in SAP',
  },
  category: {
    type: String,
    required: true,
    enum: ['GUIAS', 'STENTS_CORONARIOS', 'STENTS_RECUBIERTOS'],
  },
  subcategory: {
    type: String,
    trim: true,
  },
  specifications: {
    size: { type: String }, // Legacy field, kept for display (e.g., "2.25/13")
    diameter: {
      type: Number,
      min: 0,
      description: 'Stent/guide diameter in mm (e.g., 2.25, 2.5, 3.0)',
    },
    length: {
      type: Number,
      min: 0,
      description: 'Stent/guide length in mm (e.g., 13, 15, 18, 22)',
    },
    type: { type: String },
    description: { type: String },
  },
  inventorySettings: {
    targetStockWarehouse: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Stock Objetivo - ideal quantity to maintain in central warehouse',
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
productoSchema.index({ sapItemCode: 1 }, { sparse: true });
productoSchema.index({ legacyCode: 1 }, { sparse: true });
productoSchema.index({ category: 1, active: 1 });
productoSchema.index({ name: 'text' }); // Text search

module.exports = productoSchema;
