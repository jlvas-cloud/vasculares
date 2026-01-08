const { expressjwt: jwt } = require('express-jwt');
const jwtDecode = require('jsonwebtoken');

/**
 * Verify JWT token
 * Uses express-jwt middleware to validate the token
 */
exports.verifyUser = jwt({
  secret: process.env.JWT_SECRET,
  algorithms: ['HS256']
});

/**
 * Extract user ID from token
 * Used for routes that need the user's ID
 */
exports.getId = (req, res, next) => {
  try {
    const authString = req.headers.authorization;
    if (!authString) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const [bearer, token] = authString.split(' ');
    const { _id } = jwtDecode.decode(token);

    req.userId = _id;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * Extract company ID and user info from token
 * This is the main middleware for multi-tenant routes
 */
exports.getCompanyId = (req, res, next) => {
  try {
    const authString = req.headers.authorization;
    if (!authString) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const [bearer, token] = authString.split(' ');
    const decoded = jwtDecode.decode(token);
    const { _id, email, firstname, lastname, profilePicture, companyId } = decoded;

    // Add user details to request
    req.user = {
      _id,
      email,
      firstname,
      lastname,
      profilePicture
    };

    // Add company ID for multi-tenant database access
    if (companyId) {
      req.companyId = companyId;
    } else {
      return res.status(401).json({ error: 'No company associated with user' });
    }

    next();
  } catch (error) {
    console.error('Error processing token:', error);
    return res.status(401).json({
      error: 'Authentication failed',
      details: error.message
    });
  }
};

/**
 * Verify user has admin permissions
 * To be implemented based on permission system
 */
exports.verifyAdmin = (req, res, next) => {
  // For now, allow all authenticated users
  // TODO: Implement permission checking
  next();
};
