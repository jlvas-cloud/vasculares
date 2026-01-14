/**
 * ReconciliationRun Model
 * Tracks when reconciliation was run and its results.
 * Used to prevent duplicate runs and track history.
 */
const mongoose = require('mongoose');

const reconciliationRunSchema = new mongoose.Schema({
  runType: {
    type: String,
    enum: ['NIGHTLY', 'ON_DEMAND'],
    required: true
  },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: Date,
  status: {
    type: String,
    enum: ['RUNNING', 'COMPLETED', 'FAILED'],
    default: 'RUNNING'
  },

  // Configuration used for this run
  config: {
    // Date range checked (moving window)
    fromDate: Date,
    toDate: Date,
    // How the date range was determined
    dateSource: {
      type: String,
      enum: ['LAST_RUN', 'GO_LIVE_DATE', 'CUSTOM_RANGE', 'NONE'],
    },
    // Which document types were checked
    documentTypes: [{
      type: String,
      enum: ['PurchaseDeliveryNote', 'StockTransfer', 'DeliveryNote']
    }],
  },

  // Results
  stats: {
    purchaseDeliveryNotesChecked: { type: Number, default: 0 },
    stockTransfersChecked: { type: Number, default: 0 },
    deliveryNotesChecked: { type: Number, default: 0 },
    totalDocumentsChecked: { type: Number, default: 0 },
    externalDocsFound: { type: Number, default: 0 },
    // Breakdown by type
    externalPurchaseDeliveryNotes: { type: Number, default: 0 },
    externalStockTransfers: { type: Number, default: 0 },
    externalDeliveryNotes: { type: Number, default: 0 },
  },

  // Errors encountered during run
  errors: [{
    timestamp: { type: Date, default: Date.now },
    phase: String, // 'PurchaseDeliveryNotes', 'StockTransfers', 'DeliveryNotes'
    message: String,
    details: mongoose.Schema.Types.Mixed,
  }],

  // Who triggered (for on-demand runs)
  triggeredBy: {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    firstname: String,
    lastname: String,
    email: String,
  },

  // Company
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// Query indexes
reconciliationRunSchema.index({ companyId: 1, startedAt: -1 });
reconciliationRunSchema.index({ status: 1, companyId: 1 });
reconciliationRunSchema.index({ runType: 1, companyId: 1, startedAt: -1 });

module.exports = reconciliationRunSchema;
