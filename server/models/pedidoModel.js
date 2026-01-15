/**
 * Pedido Schema
 * Tracks supplier orders (internal tracking only, not synced to SAP)
 * Links to GoodsReceipts when inventory arrives
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const pedidoSchema = new Schema({
  // Order date
  orderDate: {
    type: Date,
    required: true,
    default: Date.now,
  },

  // Expected arrival (optional)
  expectedArrivalDate: {
    type: Date,
  },

  // Supplier reference (optional)
  supplier: {
    type: String,
  },

  // Order status
  status: {
    type: String,
    required: true,
    enum: ['PENDIENTE', 'PARCIAL', 'COMPLETO', 'CANCELADO'],
    default: 'PENDIENTE',
  },

  // Items ordered
  items: [{
    productId: {
      type: mongoose.Types.ObjectId,
      ref: 'productos',
      required: true,
    },
    quantityOrdered: {
      type: Number,
      required: true,
      min: 1,
    },
    quantityReceived: {
      type: Number,
      default: 0,
      min: 0,
    },
  }],

  // Linked GoodsReceipts that fulfilled this order
  goodsReceipts: [{
    type: mongoose.Types.ObjectId,
    ref: 'goodsreceipts',
  }],

  // General notes
  notes: {
    type: String,
  },

  // Creation tracking
  createdBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
    email: String,
  },

  // Company (multi-tenant)
  companyId: {
    type: mongoose.Types.ObjectId,
    required: true,
    index: true,
  },
}, { timestamps: true });

// Indexes
pedidoSchema.index({ status: 1, createdAt: -1 });
pedidoSchema.index({ orderDate: -1 });
pedidoSchema.index({ companyId: 1, status: 1 });
pedidoSchema.index({ 'items.productId': 1 });

// Virtual to calculate total ordered quantity
pedidoSchema.virtual('totalOrdered').get(function() {
  return this.items.reduce((sum, item) => sum + item.quantityOrdered, 0);
});

// Virtual to calculate total received quantity
pedidoSchema.virtual('totalReceived').get(function() {
  return this.items.reduce((sum, item) => sum + item.quantityReceived, 0);
});

// Virtual to calculate pending quantity
pedidoSchema.virtual('totalPending').get(function() {
  return this.items.reduce((sum, item) =>
    sum + Math.max(0, item.quantityOrdered - item.quantityReceived), 0
  );
});

// Method to update status based on received quantities
pedidoSchema.methods.updateStatus = function() {
  const totalOrdered = this.items.reduce((sum, item) => sum + item.quantityOrdered, 0);
  const totalReceived = this.items.reduce((sum, item) => sum + item.quantityReceived, 0);

  if (this.status === 'CANCELADO') {
    // Don't change cancelled orders
    return this.status;
  }

  if (totalReceived === 0) {
    this.status = 'PENDIENTE';
  } else if (totalReceived >= totalOrdered) {
    this.status = 'COMPLETO';
  } else {
    this.status = 'PARCIAL';
  }

  return this.status;
};

// Include virtuals in JSON
pedidoSchema.set('toJSON', { virtuals: true });
pedidoSchema.set('toObject', { virtuals: true });

module.exports = pedidoSchema;
