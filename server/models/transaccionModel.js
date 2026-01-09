/**
 * Transaccion (Transaction) Schema
 * Records all inventory movements
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const transaccionSchema = new Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'WAREHOUSE_RECEIPT',  // Products arrive at warehouse
      'CONSIGNMENT_OUT',    // Send to hospital on consignment
      'CONSIGNMENT',        // Bulk consignment from warehouse to centro
      'CONSUMPTION',        // Hospital uses products
      'RETURN',             // Hospital returns products
      'ADJUSTMENT',         // Damaged, expired, or corrections
      'TRANSFER',           // Transfer between locations
    ],
  },

  // Product and lot info
  productId: {
    type: mongoose.Types.ObjectId,
    ref: 'productos',
    required: true,
  },
  lotId: {
    type: mongoose.Types.ObjectId,
    ref: 'lotes',
  },
  lotNumber: {
    type: String,
    trim: true,
  },

  // Locations
  fromLocationId: {
    type: mongoose.Types.ObjectId,
    ref: 'locaciones',
  },
  toLocationId: {
    type: mongoose.Types.ObjectId,
    ref: 'locaciones',
  },

  // Quantity
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },

  // Transaction details by type
  warehouseReceipt: {
    lotNumber: String,
    expiryDate: Date,
    supplier: String,
    purchaseOrderId: mongoose.Types.ObjectId,
    unitCost: Number,
  },

  adjustment: {
    reason: {
      type: String,
      enum: ['DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'CORRECTION'],
    },
    notes: String,
  },

  consumption: {
    patientInfo: String,
    procedureInfo: String,
    doctorName: String,
  },

  // General info
  transactionDate: {
    type: Date,
    default: Date.now,
  },
  notes: {
    type: String,
  },

  // User who performed the transaction
  performedBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
    email: String,
  },

  // Status (for transactions that need approval)
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'],
    default: 'COMPLETED',
  },

  // Related documents
  documents: [{
    name: String,
    url: String,
    uploadDate: Date,
  }],

  // SAP Integration
  sapIntegration: {
    pushed: {
      type: Boolean,
      default: false,
      description: 'Whether this transaction was pushed to SAP',
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
      description: 'SAP document type (e.g., PurchaseDeliveryNotes, StockTransfers)',
    },
    error: {
      type: String,
      description: 'Error message if SAP push failed',
    },
    syncDate: {
      type: Date,
      description: 'When SAP sync was attempted',
    },
  },
}, { timestamps: true });

// Indexes
transaccionSchema.index({ productId: 1, transactionDate: -1 });
transaccionSchema.index({ type: 1, transactionDate: -1 });
transaccionSchema.index({ fromLocationId: 1, transactionDate: -1 });
transaccionSchema.index({ toLocationId: 1, transactionDate: -1 });
transaccionSchema.index({ lotId: 1 });
transaccionSchema.index({ transactionDate: -1 });
transaccionSchema.index({ 'sapIntegration.pushed': 1 }); // Find unsynced transactions

module.exports = transaccionSchema;
