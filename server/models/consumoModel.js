/**
 * Consumo (Consumption) Schema
 * Records consumption events at Centros with SAP DeliveryNote integration
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const consumoItemSchema = new Schema({
  productId: {
    type: mongoose.Types.ObjectId,
    ref: 'productos',
    required: true,
  },
  sapItemCode: {
    type: String,
    required: true,
  },
  productName: String,
  loteId: {
    type: mongoose.Types.ObjectId,
    ref: 'lotes',
  },
  lotNumber: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: Number,
  currency: {
    type: String,
    default: 'USD',
  },
});

const consumoSchema = new Schema({
  // Centro where consumption occurred
  centroId: {
    type: mongoose.Types.ObjectId,
    ref: 'locaciones',
    required: true,
  },
  centroName: String,
  sapCardCode: String,  // SAP customer code for the Centro

  // Consumption details
  items: [consumoItemSchema],

  // Canonical business date when consumption occurred. Drives all analytics
  // queries (Dashboard, Movimientos, trends). The default function runs
  // BEFORE validation so callsites that omit this field still pass the
  // `required` check, falling back to procedureDate → now.
  consumptionDate: {
    type: Date,
    required: true,
    default: function() {
      return this.procedureDate || new Date();
    },
  },

  // Optional patient/procedure info
  patientName: String,
  doctorName: String,
  procedureDate: Date,
  procedureType: String,

  // SAP Integration (standardized field names)
  sapIntegration: {
    pushed: {
      type: Boolean,
      default: false,
    },
    docEntry: {
      type: Number,
      description: 'SAP Document Entry number',
    },
    docNum: {
      type: Number,
      description: 'SAP Document Number',
    },
    docType: {
      type: String,
      default: 'DeliveryNotes',
    },
    syncDate: {
      type: Date,
      description: 'When SAP sync was last attempted',
    },
    error: {
      type: String,
      description: 'Error message if SAP sync failed',
    },
    retryCount: {
      type: Number,
      default: 0,
      description: 'Number of retry attempts',
    },
    retrying: {
      type: Boolean,
      default: false,
      description: 'Lock flag to prevent concurrent retries',
    },
  },

  // Totals
  totalItems: {
    type: Number,
    default: 0,
  },
  totalQuantity: {
    type: Number,
    default: 0,
  },
  totalValue: {
    type: Number,
    default: 0,
  },

  // Metadata
  notes: String,
  status: {
    type: String,
    enum: ['PENDING', 'SYNCED', 'FAILED', 'RETRYING'],
    default: 'PENDING',
  },

  createdBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
    email: String,
  },

  // Origin tracking (for distinguishing app-created vs imported documents)
  origin: {
    type: String,
    enum: ['APP', 'SAP_IMPORT', 'SAP_HISTORY'],
    default: 'APP',
    description: 'Where the document was created. SAP_HISTORY = bulk historical import during onboarding (analytics only, no inventory impact).',
  },
  importedFromId: {
    type: mongoose.Types.ObjectId,
    ref: 'externalsapdocuments',
    description: 'Reference to ExternalSapDocument if imported',
  },
}, { timestamps: true });

// Indexes
consumoSchema.index({ centroId: 1, consumptionDate: -1 });
consumoSchema.index({ consumptionDate: -1 });
consumoSchema.index({ 'sapIntegration.docEntry': 1 }, { sparse: true });
consumoSchema.index({ 'sapIntegration.docNum': 1 }, { sparse: true });
consumoSchema.index({ 'sapIntegration.pushed': 1 });
consumoSchema.index({ status: 1 });
consumoSchema.index({ origin: 1 });

// Pre-save middleware to calculate totals
consumoSchema.pre('save', function(next) {
  if (this.items && this.items.length > 0) {
    this.totalItems = this.items.length;
    this.totalQuantity = this.items.reduce((sum, item) => sum + item.quantity, 0);
    this.totalValue = this.items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
  }
  next();
});

module.exports = consumoSchema;
