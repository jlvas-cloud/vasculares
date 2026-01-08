/**
 * Users Schema - Shared with Xirugias and Nomina apps
 * This schema matches the tenant app's users schema for compatibility
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const crypto = require('crypto');

const userSchema = new Schema({
  firstname: {
    type: String,
    trim: true,
    max: 32
  },
  secondname: {
    type: String,
  },
  lastname: {
    type: String,
  },
  secondLastname: {
    type: String
  },
  email: {
    type: String,
    trim: true,
    unique: true,
    lowercase: true
  },
  telefono: {
    type: String,
    trim: true,
    max: 15
  },
  hashed_password: {
    type: String,
  },
  salt: String,
  userId: mongoose.Types.ObjectId,
  role: {
    isAdmin: Boolean,
    isOperaciones: Boolean,
    isVentas: Boolean,
    isServicio: Boolean,
    isEC: Boolean,
    isObservador: Boolean,
    isLider: Boolean,
    isCronograma: Boolean,
    isDocumentos: Boolean,
  },
  permissions: {
    type: Array,
    default: []
  },
  resetPasswordLink: {
    type: String,
    default: ''
  },
  emailLinkLoginToken: {
    type: String,
    default: ''
  },
  profilePicture: String,
  signature: String,
  lastLogin: String,
  color: String,
  deactivated: {
    type: Boolean,
    default: false
  },
  notifications: {
    type: Array,
    default: []
  },
  company: {
    name: String,
    _id: mongoose.Types.ObjectId
  },
  historia: [{
    fecha: Date,
    user: {
      _id: mongoose.Types.ObjectId,
      firstname: String,
      lastname: String
    },
    accion: String
  }],
}, { id: false, timestamps: true, toJSON: { virtuals: true } });

userSchema.virtual('fullname').get(function () {
  return `${this.firstname} ${this.lastname}`;
});

userSchema.virtual('password')
  .set(function (password) {
    this._password = password;
    this.salt = this.makeSalt();
    this.hashed_password = this.encryptPassword(password);
  })
  .get(function () {
    return this._password;
  });

userSchema.methods = {
  authenticate: function (plainText) {
    return this.encryptPassword(plainText) === this.hashed_password;
  },
  encryptPassword: function (password) {
    if (!password) return '';
    try {
      return crypto.createHmac('sha256', this.salt)
        .update(password)
        .digest('hex');
    } catch (err) {
      return '';
    }
  },
  makeSalt: function () {
    return Math.round(new Date().valueOf() * Math.random()) + '';
  }
};

module.exports = userSchema;
