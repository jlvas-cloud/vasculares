/**
 * ExternalSapDocument Model
 * Tracks SAP documents that involve our products but weren't created by our app.
 * Used by the reconciliation system to detect drift between SAP and our database.
 */
const mongoose = require('mongoose');

const externalSapDocumentSchema = new mongoose.Schema({
  // SAP reference
  sapDocEntry: { type: Number, required: true },
  sapDocNum: { type: Number }, // Display number
  sapDocType: {
    type: String,
    enum: ['PurchaseDeliveryNote', 'StockTransfer', 'DeliveryNote'],
    required: true
  },
  sapDocDate: { type: Date, required: true },

  // Business partner (for StockTransfer destination matching)
  sapCardCode: String,
  sapCardName: String,

  // What was affected
  items: [{
    sapItemCode: { type: String, required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
    productName: String,
    batchNumber: String,
    quantity: { type: Number, required: true },
    // For PurchaseDeliveryNote and DeliveryNote (single location)
    warehouseCode: String,
    binAbsEntry: Number,
    // For StockTransfer (source and destination)
    fromWarehouseCode: String,
    toWarehouseCode: String,
    fromBinAbsEntry: Number,
    toBinAbsEntry: Number,
  }],

  // Detection info
  detectedAt: { type: Date, default: Date.now },
  detectedBy: {
    type: String,
    enum: ['NIGHTLY_JOB', 'ON_DEMAND'],
    required: true
  },
  reconciliationRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReconciliationRun' },

  // Resolution
  status: {
    type: String,
    enum: ['PENDING_REVIEW', 'ACKNOWLEDGED', 'IMPORTED', 'IGNORED'],
    default: 'PENDING_REVIEW'
  },
  reviewedBy: {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    firstname: String,
    lastname: String,
    email: String,
  },
  reviewedAt: Date,
  notes: String,

  // If imported, reference to local document
  importedAs: {
    documentType: { type: String, enum: ['Consignacion', 'Consumo', 'GoodsReceipt'] },
    documentId: { type: mongoose.Schema.Types.ObjectId },
  },

  // Company
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// Unique constraint: one record per SAP document
externalSapDocumentSchema.index({ sapDocEntry: 1, sapDocType: 1, companyId: 1 }, { unique: true });

// Query indexes
externalSapDocumentSchema.index({ status: 1, companyId: 1 });
externalSapDocumentSchema.index({ detectedAt: -1 });
externalSapDocumentSchema.index({ sapDocDate: -1, companyId: 1 });

module.exports = externalSapDocumentSchema;
