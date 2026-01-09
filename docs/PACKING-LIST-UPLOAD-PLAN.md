# Feature: Packing List Upload & Import

## Status: ✅ IMPLEMENTED (2026-01-09)

## Overview
Upload packing list images (from suppliers like BIOTRONIK/Centralmed) and automatically extract product/lot data using Claude Vision API, then create goods receipt with SAP integration.

## Implementation

### Approach
Instead of creating a separate page, the feature was integrated into the existing **Recepcion** page (`/goods-receipt`) with tabs:
- **Manual** - Original manual entry form
- **Desde Packing List** - Upload images → Extract → Review → Submit

### User Flow
```
1. User goes to "Recepcion" page
2. Sees tabs: "Manual" | "Desde Packing List"
3. If "Desde Packing List":
   a. User selects warehouse and supplier (shared with manual tab)
   b. User uploads images (drag & drop or file picker)
   c. Click "Extraer Datos" → Claude Vision extracts data
   d. Extracted items appear in editable table
   e. User reviews/edits data (fix OCR errors, adjust quantities)
   f. Click "Crear Recepcion" → same flow as manual
4. Success dialog shows SAP DocNum
```

## Files Created

### Backend
| File | Purpose |
|------|---------|
| `server/middleware/upload.js` | Multer config for file uploads |
| `server/services/extractionService.js` | Claude Vision API integration |

### Frontend
| File | Purpose |
|------|---------|
| `client/src/components/FileUploader.jsx` | Drag & drop upload component |

## Files Modified

| File | Changes |
|------|---------|
| `server/controllers/goodsReceipt.js` | Added `extractFromPackingList` endpoint |
| `server/routes/goodsReceipt.js` | Added `POST /extract` route |
| `client/src/pages/GoodsReceipt.jsx` | Added tabs, file upload UI, extraction flow |
| `client/src/lib/api.js` | Added `goodsReceiptApi.extract()` method |

## API Endpoint

**POST /api/goods-receipt/extract**
```
Content-Type: multipart/form-data

Request:
- files: File[] (images, max 10 files, max 10MB each)

Response:
{
  success: true,
  items: [
    {
      code: 419113,
      name: "Orsiro Mission 2.25/15",
      sapItemCode: "419113",
      lotNumber: "06253084",
      expiryDate: "2028-07-09",
      quantity: 1,
      productId: "..." | null,  // If product exists in DB
      existsInDb: true | false
    }
  ],
  warnings: ["Page 3: unclear lot number"],
  filesProcessed: 5
}
```

## Dependencies Installed

### Server
```bash
npm install @anthropic-ai/sdk multer
```

### Client
```bash
npm install react-dropzone
```

## Environment Variables
```
ANTHROPIC_API_KEY=sk-ant-...   # Required for Claude Vision API
```

## Technical Details

### Claude Vision Integration
- Model: `claude-sonnet-4-20250514`
- Max tokens: 8192
- Images sent as base64
- Prompt optimized for BIOTRONIK packing lists

### File Upload Limits
- Max file size: 10MB per file
- Max files: 10 per upload
- Allowed types: JPEG, PNG, GIF, WEBP (PDF planned for future)

### Extraction Prompt
```
Analyze these packing list images and extract all product items.

For each item, extract:
- code: Article/product code (number, e.g., 419113)
- name: Full product name (e.g., "Orsiro Mission 2.25/15")
- lotNumber: Lot/batch number (e.g., "06253084")
- expiryDate: Expiry date in YYYY-MM-DD format
- quantity: Number of units

Return valid JSON only:
{
  "items": [...],
  "warnings": []
}
```

## Cost Estimate
- Claude Sonnet vision: ~$0.003 per 1K input tokens for images
- Typical packing list (5-7 images): ~$0.05-0.15 per extraction
- Monthly estimate (20 imports): ~$2-3/month

## Future Enhancements
- [ ] PDF support (convert pages to images)
- [ ] Multiple supplier templates
- [ ] Confidence scores per field
- [ ] Learn from corrections
- [ ] Batch import history

## Related Documentation
- `docs/SAP-INTEGRATION-PLAN.md` - SAP integration details
- `server/scripts/packing-list-data.json` - Sample extracted data format
