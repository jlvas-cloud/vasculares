/**
 * GoodsReceipt Schema
 * Records goods receipts (Entradas de Mercancía) created from the app
 * Each receipt groups multiple items/lots and tracks SAP sync status
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const goodsReceiptSchema = new Schema({
  // Receipt info
  receiptDate: {
    type: Date,
    default: Date.now,
  },
  locationId: {
    type: mongoose.Types.ObjectId,
    ref: 'locaciones',
    required: true,
  },
  locationName: {
    type: String,
    description: 'Denormalized for display',
  },
  sapWarehouseCode: {
    type: String,
    description: 'SAP warehouse code (e.g., "01")',
  },
  supplier: {
    type: String,
    description: 'Supplier name (e.g., "Centralmed")',
  },
  supplierCode: {
    type: String,
    description: 'SAP CardCode (e.g., "P00031")',
  },
  notes: {
    type: String,
  },

  // Line items
  items: [{
    productId: {
      type: mongoose.Types.ObjectId,
      ref: 'productos',
      required: true,
    },
    productName: String,
    sapItemCode: String,
    lotNumber: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    loteId: {
      type: mongoose.Types.ObjectId,
      ref: 'lotes',
      description: 'Reference to created lote',
    },
    transactionId: {
      type: mongoose.Types.ObjectId,
      ref: 'transacciones',
      description: 'Reference to transaction record',
    },
  }],

  // SAP Integration (single status for whole receipt)
  sapIntegration: {
    pushed: {
      type: Boolean,
      default: false,
    },
    retrying: {
      type: Boolean,
      default: false,
      description: 'Lock flag to prevent concurrent retries',
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
      default: 'PurchaseDeliveryNotes',
    },
    error: {
      type: String,
      description: 'Error message if SAP push failed',
    },
    syncDate: {
      type: Date,
      description: 'When SAP sync was last attempted',
    },
    retryCount: {
      type: Number,
      default: 0,
      description: 'Number of retry attempts',
    },
  },

  // Audit
  createdBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
  },
}, { timestamps: true });

// Indexes
goodsReceiptSchema.index({ receiptDate: -1 });
goodsReceiptSchema.index({ 'sapIntegration.pushed': 1 });
goodsReceiptSchema.index({ 'sapIntegration.docNum': 1 });
goodsReceiptSchema.index({ supplierCode: 1 });
goodsReceiptSchema.index({ locationId: 1 });

module.exports = goodsReceiptSchema;
