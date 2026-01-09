/**
 * Consignacion Schema
 * Tracks bulk consignments from warehouse to centros
 * Supports EN_TRANSITO state before final confirmation
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const consignacionSchema = new Schema({
  // Source and destination
  fromLocationId: {
    type: mongoose.Types.ObjectId,
    ref: 'locaciones',
    required: true,
  },
  toLocationId: {
    type: mongoose.Types.ObjectId,
    ref: 'locaciones',
    required: true,
  },

  // Status tracking
  status: {
    type: String,
    required: true,
    enum: ['EN_TRANSITO', 'RECIBIDO'],
    default: 'EN_TRANSITO',
  },

  // Items being consigned (each item = one lot of one product)
  items: [{
    productId: {
      type: mongoose.Types.ObjectId,
      ref: 'productos',
      required: true,
    },
    loteId: {
      type: mongoose.Types.ObjectId,
      ref: 'lotes',
      required: true,
    },
    lotNumber: {
      type: String,
      required: true,
      description: 'Batch number for SAP integration',
    },
    quantitySent: {
      type: Number,
      required: true,
      min: 1,
    },
    quantityReceived: {
      type: Number,
      min: 0,
      default: null, // null until confirmed
    },
    notes: {
      type: String,
    },
  }],

  // SAP Business One Integration
  sapDocNum: {
    type: Number,
    sparse: true,
    description: 'SAP Stock Transfer document number',
  },
  sapTransferStatus: {
    type: String,
    enum: ['PENDING', 'CREATED', 'FAILED'],
    default: null,
    description: 'Status of SAP stock transfer creation',
  },
  sapError: {
    type: String,
    description: 'Error message if SAP transfer failed',
  },

  // Creation tracking
  createdBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
    email: String,
  },

  // Confirmation tracking
  confirmedAt: {
    type: Date,
    default: null,
  },
  confirmedBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
    email: String,
  },

  // General notes
  notes: {
    type: String,
  },
}, { timestamps: true });

// Indexes
consignacionSchema.index({ status: 1, createdAt: -1 });
consignacionSchema.index({ fromLocationId: 1, createdAt: -1 });
consignacionSchema.index({ toLocationId: 1, createdAt: -1 });
consignacionSchema.index({ createdAt: -1 });
consignacionSchema.index({ sapDocNum: 1 }, { sparse: true });

// Virtual to check if consignment is old (> 3 days in transit)
consignacionSchema.virtual('isOld').get(function() {
  if (this.status !== 'EN_TRANSITO') return false;
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  return this.createdAt < threeDaysAgo;
});

// Include virtuals in JSON
consignacionSchema.set('toJSON', { virtuals: true });
consignacionSchema.set('toObject', { virtuals: true });

module.exports = consignacionSchema;
