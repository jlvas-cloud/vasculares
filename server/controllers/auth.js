/**
 * Auth Controller - Login and user management
 * Uses shared auth database with Xirugias and Nomina apps
 */
const jwt = require('jsonwebtoken');
const { getUserModel, getCompanyModel, getLocalUsersModel } = require('../getModel');
const usersSchema = require('../models/usersModel');

/**
 * POST /api/auth/login - Login with email and password
 */
exports.login = async (req, res, next) => {
  try {
    const Users = await getUserModel();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // Find user in central auth database
    const user = await Users.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(400).json({ error: 'Usuario con ese email no existe' });
    }

    if (user.deactivated) {
      return res.status(400).json({ error: 'Usuario desactivado' });
    }

    // Verify password
    if (!user.authenticate(password)) {
      return res.status(400).json({ error: 'Email y contraseña no coinciden' });
    }

    // Get company info
    const Company = await getCompanyModel();
    const company = await Company.findOne({ _id: user.company._id });

    if (!company) {
      return res.status(400).json({ error: 'Empresa no encontrada' });
    }

    // Get local user from company database
    const mongoose = require('mongoose');
    const { mongoDb } = require('../connection');
    await mongoDb;

    const companyDb = mongoose.connection.useDb(user.company._id.toString(), { useCache: true });
    if (!companyDb.models['users']) {
      companyDb.model('users', usersSchema);
    }
    const LocalUsers = companyDb.model('users');

    const localUser = await LocalUsers.findOneAndUpdate(
      { _id: user.userId },
      { $set: { lastLogin: new Date() } },
      { new: true }
    );

    if (!localUser) {
      return res.status(400).json({ error: 'Usuario local no encontrado' });
    }

    // Create JWT token (same format as Xirugias/Nomina)
    const token = jwt.sign({
      _id: user.userId,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      profilePicture: localUser.profilePicture,
      companyId: user.company._id
    }, process.env.JWT_SECRET, { expiresIn: '2d' });

    // Remove sensitive data
    localUser.hashed_password = undefined;
    localUser.salt = undefined;

    res.json({
      token,
      user: localUser,
      company: {
        _id: company._id,
        name: company.name,
        configuration: company.configuration
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    next(error);
  }
};

/**
 * GET /api/auth/me - Get current user info
 */
exports.getMe = async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const { mongoDb } = require('../connection');
    await mongoDb;

    // Get local user from company database
    const companyDb = mongoose.connection.useDb(req.companyId.toString(), { useCache: true });
    if (!companyDb.models['users']) {
      companyDb.model('users', usersSchema);
    }
    const LocalUsers = companyDb.model('users');

    const user = await LocalUsers.findById(req.user._id)
      .select('-hashed_password -salt -emailLinkLoginToken -resetPasswordLink')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Get company info
    const Company = await getCompanyModel();
    const company = await Company.findById(req.companyId)
      .select('name configuration')
      .lean();

    res.json({
      user,
      company
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    next(error);
  }
};

/**
 * GET /api/auth/verify - Verify token is valid
 */
exports.verify = (req, res) => {
  res.json({ valid: true, user: req.user });
};
