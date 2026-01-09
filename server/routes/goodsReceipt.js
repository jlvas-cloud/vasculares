const express = require('express');
const router = express.Router();
const goodsReceiptController = require('../controllers/goodsReceipt');
const { verifyUser, getCompanyId } = require('../util/authenticate');
const { body } = require('express-validator');
const { packingListUpload, handleUploadError } = require('../middleware/upload');

// All routes require authentication
router.use(verifyUser, getCompanyId);

// Validation rules for goods receipt
const validateGoodsReceipt = [
  body('locationId').notEmpty().withMessage('Warehouse location is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').notEmpty().withMessage('Product ID is required for each item'),
  body('items.*.lotNumber').trim().notEmpty().withMessage('Lot number is required for each item'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('items.*.expiryDate').isISO8601().withMessage('Valid expiry date is required for each item'),
];

// Routes
router.get('/products', goodsReceiptController.getProductsForReceipt);
router.get('/warehouses', goodsReceiptController.getWarehouses);
router.post('/', validateGoodsReceipt, goodsReceiptController.createGoodsReceipt);

// Packing list extraction (Claude Vision)
router.post('/extract', packingListUpload, handleUploadError, goodsReceiptController.extractFromPackingList);

// History and management
router.get('/history', goodsReceiptController.listGoodsReceipts);
router.get('/:id', goodsReceiptController.getGoodsReceipt);
router.post('/:id/retry-sap', goodsReceiptController.retrySapPush);

module.exports = router;
