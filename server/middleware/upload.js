/**
 * Multer configuration for file uploads
 * Handles packing list images and PDFs
 */
const multer = require('multer');
const path = require('path');

// File filter - only allow images and PDFs
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, GIF, WEBP, and PDF are allowed.`), false);
  }
};

// Memory storage (files stored in buffer, not disk)
const storage = multer.memoryStorage();

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 10 // Max 10 files per request
  }
});

// Export configured multer instance
module.exports = {
  // For packing list extraction - multiple files
  packingListUpload: upload.array('files', 10),

  // Single file upload (for future use)
  singleUpload: upload.single('file'),

  // Error handler middleware
  handleUploadError: (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB per file.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files. Maximum is 10 files per upload.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  }
};
