/**
 * Company Schema - Shared with Xirugias and Nomina apps
 * This schema matches the tenant app's company schema for compatibility
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const companySchema = new Schema({
  name: String,
  country: String,
  historia: Array,
  domain: String,
  createdBy: {
    _id: mongoose.Types.ObjectId,
    firstname: String,
    lastname: String,
  },
  owner: [
    {
      _id: mongoose.Types.ObjectId,
      firstname: String,
      lastname: String,
      date: Date
    }
  ],
  invitationRequests: [
    {
      firstname: String,
      lastname: String,
      email: String,
      mdUserId: mongoose.Types.ObjectId,
      date: Date,
      centros: Array,
      notInLocalDatabase: {
        type: Boolean,
        default: true
      }
    }
  ],
  subscription: {
    created: String,
    subscriptionToken: String,
    customerId: String,
    expires: String,
    token: String,
    plan: String,
    product: String,
    users: Number,
    permissions: Array,
    cirugiasCreated: {
      type: Number,
      default: 0
    }
  },
  configuration: {
    country: String,
    currency: String,
    timezone: String,
    dateFormat: String,
    timeFormat: String,
  },
  whatsapp: {
    enabled: {
      type: Boolean,
      default: false
    },
    phoneNumberId: {
      type: String,
      index: true,
      sparse: true
    },
    displayNumber: String,
    wabaId: String,
    setupDate: Date,
    setupBy: {
      _id: mongoose.Types.ObjectId,
      firstname: String,
      lastname: String
    }
  }
}, { id: false, timestamps: true });

module.exports = companySchema;
