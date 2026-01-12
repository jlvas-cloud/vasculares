/**
 * Consumo (Consumption) Schema
 * Records consumption events at Centros with SAP DeliveryNote integration
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const consumoItemSchema = new Schema({
  productId: {
    type: mongoose.Types.ObjectId,
    ref: 'Producto',
    required: true,
  },
  sapItemCode: {
    type: String,
    required: true,
  },
  productName: String,
  loteId: {
    type: mongoose.Types.ObjectId,
    ref: 'Lote',
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
    ref: 'Locacion',
    required: true,
  },
  centroName: String,
  sapCardCode: String,  // SAP customer code for the Centro

  // Consumption details
  items: [consumoItemSchema],

  // Optional patient/procedure info
  patientName: String,
  doctorName: String,
  procedureDate: Date,
  procedureType: String,

  // SAP Integration
  sapSync: {
    pushed: {
      type: Boolean,
      default: false,
    },
    sapDocEntry: Number,
    sapDocNum: Number,
    sapDocType: {
      type: String,
      default: 'DeliveryNotes',
    },
    pushedAt: Date,
    error: String,
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
    enum: ['PENDING', 'SYNCED', 'FAILED'],
    default: 'PENDING',
  },

  createdBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
    email: String,
  },
}, { timestamps: true });

// Indexes
consumoSchema.index({ centroId: 1, createdAt: -1 });
consumoSchema.index({ 'sapSync.sapDocNum': 1 }, { sparse: true });
consumoSchema.index({ status: 1 });
consumoSchema.index({ createdAt: -1 });

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
