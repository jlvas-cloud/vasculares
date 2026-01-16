/**
 * Encryption Service
 * AES-256-GCM encryption for sensitive data (SAP credentials)
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;       // 16 bytes for AES
const AUTH_TAG_LENGTH = 16; // 16 bytes for GCM auth tag

/**
 * Get encryption key from environment
 * Key must be 32 bytes (64 hex characters)
 */
function getEncryptionKey() {
  const key = process.env.SAP_CREDENTIALS_KEY;

  if (!key) {
    throw new Error('SAP_CREDENTIALS_KEY environment variable is not set');
  }

  // Key should be 64 hex characters (32 bytes)
  if (key.length !== 64) {
    throw new Error('SAP_CREDENTIALS_KEY must be 64 hex characters (32 bytes)');
  }

  return Buffer.from(key, 'hex');
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string} plaintext - Text to encrypt
 * @returns {{ encrypted: string, iv: string, authTag: string }}
 */
function encrypt(plaintext) {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty value');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param {string} encrypted - Encrypted hex string
 * @param {string} iv - Initialization vector (hex)
 * @param {string} authTag - Authentication tag (hex)
 * @returns {string} Decrypted plaintext
 */
function decrypt(encrypted, iv, authTag) {
  if (!encrypted || !iv || !authTag) {
    throw new Error('Missing required decryption parameters');
  }

  const key = getEncryptionKey();
  const ivBuffer = Buffer.from(iv, 'hex');
  const authTagBuffer = Buffer.from(authTag, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);
  decipher.setAuthTag(authTagBuffer);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a new random encryption key
 * Use this once to generate the SAP_CREDENTIALS_KEY
 * @returns {string} 64 hex characters (32 bytes)
 */
function generateKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Check if encryption is properly configured
 * @returns {boolean}
 */
function isConfigured() {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  generateKey,
  isConfigured
};
