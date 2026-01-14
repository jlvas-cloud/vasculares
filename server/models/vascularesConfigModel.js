/**
 * VascularesConfig Model
 * Stores per-company configuration for the Vasculares app.
 * One document per company.
 */
const mongoose = require('mongoose');

const vascularesConfigSchema = new mongoose.Schema({
  // Reconciliation settings
  reconciliation: {
    // Date after which we track external SAP documents
    // Set automatically during first inventory sync
    goLiveDate: { type: Date, default: null },

    // Who/when set the go-live date
    goLiveDateSetBy: {
      type: { type: String, enum: ['SYNC_SCRIPT', 'MANUAL'] },
      user: {
        _id: { type: mongoose.Schema.Types.ObjectId },
        firstname: String,
        lastname: String,
      },
      setAt: Date,
    },
  },

  // Company reference
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
}, { timestamps: true });

// Ensure one config per company
vascularesConfigSchema.index({ companyId: 1 }, { unique: true });

module.exports = vascularesConfigSchema;
