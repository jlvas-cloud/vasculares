# Feature Plan: Packing List Upload & Import

## Overview
Allow users to upload packing list images (from suppliers like BIOTRONIK) and automatically extract product/lot data using AI vision, then import into the inventory system.

## Current State (Completed)
- ✅ Manual import script: `server/scripts/import-packing-list.js`
- ✅ JSON data structure: `server/scripts/packing-list-data.json`
- ✅ Tested with real BIOTRONIK packing list (38 products, 83 units)
- ✅ Product, Lote, Inventario models ready

## User Flow
```
1. User navigates to "Recepción de Inventario" page
2. User uploads packing list images (drag & drop or file picker)
3. System shows "Processing..." while AI extracts data
4. Extracted data appears in editable table for review
5. User corrects any errors, confirms quantities
6. User clicks "Importar"
7. System creates products/lotes, shows success summary
```

## Technical Architecture

### Frontend
```
client/src/pages/InventoryReceipt.jsx (new page)
├── ImageUploader component (drag & drop, multiple files)
├── ExtractionPreview component (editable table)
├── ImportSummary component (results modal)
└── Hooks: useExtractPackingList, useImportInventory
```

### Backend
```
server/controllers/inventoryReceipt.js (new controller)
├── POST /api/inventory-receipt/extract
│   - Receives images (multipart/form-data)
│   - Calls Claude Vision API
│   - Returns extracted JSON
│
└── POST /api/inventory-receipt/import
    - Receives reviewed JSON
    - Creates products/lotes/inventory
    - Returns import summary
```

## Data Structures

### Extraction Request
```javascript
// POST /api/inventory-receipt/extract
// Content-Type: multipart/form-data
{
  images: [File, File, ...],  // JPEG/PNG files
  supplier: "BIOTRONIK AG"    // Optional hint for AI
}
```

### Extraction Response (AI Output)
```javascript
{
  success: true,
  packingList: {
    documentNumber: "57364055",
    date: "2025-11-10",
    supplier: "BIOTRONIK AG",
    detectedPages: 7
  },
  items: [
    {
      code: 419113,
      name: "Orsiro Mission 2.25/15",
      diameter: 2.25,
      length: 15,
      lotNumber: "06253084",
      expiryDate: "2028-07-09",
      quantity: 1,
      confidence: 0.95,        // AI confidence score
      existsInDb: false        // Check if product already exists
    },
    // ... more items
  ],
  warnings: [
    "Page 3: One item had unclear lot number"
  ]
}
```

### Import Request
```javascript
// POST /api/inventory-receipt/import
{
  packingList: {
    documentNumber: "57364055",
    supplier: "BIOTRONIK AG",
    receivedDate: "2025-11-20"
  },
  items: [
    // Same structure as extraction, user may have edited values
  ],
  warehouseId: "optional - defaults to main warehouse"
}
```

### Import Response
```javascript
{
  success: true,
  summary: {
    productsCreated: 38,
    productsExisted: 0,
    lotesCreated: 38,
    totalUnits: 83
  },
  items: [
    { code: 419113, name: "...", status: "created", loteId: "..." },
    // ...
  ]
}
```

## Claude Vision API Prompt

```javascript
const extractionPrompt = `Analyze this packing list image and extract all product items.

For each item, extract:
- code: The article/product code (number)
- name: Full product name (e.g., "Orsiro Mission 2.25/15")
- diameter: Numeric diameter in mm (e.g., 2.25)
- length: Numeric length in mm (e.g., 15)
- lotNumber: The lot/batch number
- expiryDate: Expiry date in YYYY-MM-DD format (convert from UBD dd.mm.yyyy)
- quantity: Number of units (look for "X PZS")

Also extract document metadata:
- documentNumber: The document/receipt number
- date: Document date in YYYY-MM-DD format
- supplier: Supplier name

Return valid JSON only, no markdown. Use this structure:
{
  "packingList": { "documentNumber": "", "date": "", "supplier": "" },
  "items": [{ "code": 0, "name": "", "diameter": 0, "length": 0, "lotNumber": "", "expiryDate": "", "quantity": 0 }]
}`;
```

## Implementation Steps

### Phase 1: Backend API
1. Create `server/controllers/inventoryReceipt.js`
2. Add multer middleware for image uploads
3. Implement `/extract` endpoint with Claude Vision API
4. Implement `/import` endpoint (reuse logic from script)
5. Add routes to `server/routes.js`

### Phase 2: Frontend UI
1. Create `InventoryReceipt.jsx` page
2. Build `ImageUploader` component with react-dropzone
3. Build `ExtractionPreview` editable table
4. Add mutations with React Query
5. Add route to App.jsx

### Phase 3: Polish
1. Add loading states and progress indicators
2. Handle errors gracefully (retry extraction, highlight issues)
3. Add confidence indicators (highlight low-confidence extractions)
4. Add "Save as draft" for large imports
5. Add transaction logging for audit trail

## Dependencies

### Backend
```javascript
// Already installed
"@anthropic-ai/sdk": "latest"  // Or use existing setup
"multer": "^1.4.5"             // For file uploads (may need to install)
```

### Frontend
```javascript
"react-dropzone": "^14.x"      // For drag & drop (may need to install)
```

## Environment Variables
```
ANTHROPIC_API_KEY=sk-ant-...   // For Claude Vision API
```

## Cost Estimate
- Claude Vision: ~$0.01-0.02 per image
- Typical packing list (7 pages): ~$0.10-0.15 per import
- Monthly estimate (10 imports): ~$1-2/month

## Security Considerations
- Validate file types (only allow JPEG, PNG, PDF)
- Limit file size (max 10MB per image)
- Sanitize extracted data before database insert
- Rate limit extraction endpoint
- Store API key securely (not in frontend)

## Future Enhancements
- PDF support (extract pages as images)
- Multiple supplier templates (BIOTRONIK, Medtronic, etc.)
- Batch import history with undo
- Email notification on large imports
- Auto-detect supplier from document header
- Learn from corrections to improve extraction

## Files to Create
```
server/
├── controllers/inventoryReceipt.js    # New controller
├── routes/inventoryReceipt.js         # New routes
└── middleware/upload.js               # Multer config (if not exists)

client/src/
├── pages/InventoryReceipt.jsx         # Main page
├── components/inventory/
│   ├── ImageUploader.jsx              # Drag & drop component
│   ├── ExtractionPreview.jsx          # Editable table
│   └── ImportSummary.jsx              # Results modal
└── hooks/
    └── useInventoryReceipt.js         # API hooks
```

## Reference: Working Import Logic
See `server/scripts/import-packing-list.js` for tested import logic:
- Product find-or-create by code
- Lote creation with all fields
- Inventory aggregation update
- Transaction logging
