# Plan: Consumption Module Enhancement

## Overview
Enhance the existing Consumption page to match the Recepcion page pattern:
- **Manual tab**: Multi-item manual entry
- **Desde Documento tab**: Upload consumption documents (stickers, handwritten, PDFs) and extract data using Claude Vision

After recording consumption locally, create SAP **DeliveryNotes (Entrega)** which can later be invoiced.

## SAP Integration

### Document Type: DeliveryNotes (Entrega)

Based on SAP analysis, consumption creates a **DeliveryNotes** document:
- This is a **sales delivery** to the Centro (which is a Customer in SAP)
- Removes inventory from warehouse 10 (Consignacion)
- Includes prices for billing
- Can be converted to Invoice later

**Example from SAP (DocNum 50610):**
```json
{
  "CardCode": "C00013",           // Centro's customer code
  "CardName": "Cecanor",
  "DocDate": "2025-12-31",
  "Comments": "Px: Teolinda M. Hernández\nDr. Ulerio\nFecha cirg. 31.12.2025\nConsignación: CECANOR",
  "DocumentLines": [{
    "ItemCode": "419145",
    "ItemDescription": "Stent Coronario Medicado Orsiro Mission 2.75/35",
    "Quantity": 1,
    "WarehouseCode": "10",        // Consignacion warehouse
    "Price": 1675.00,             // USD price
    "Currency": "USD",
    "BatchNumbers": [{            // If batch tracking
      "BatchNumber": "06253084",
      "Quantity": 1
    }]
  }]
}
```

**What this does in SAP:**
1. Creates a sales delivery (Entrega) to the Centro
2. Removes inventory from warehouse 10
3. Records batch numbers consumed
4. Creates accounting entries for cost of goods sold
5. Delivery remains "Open" until invoiced

### Requirements for DeliveryNotes
Each Centro needs in our database:
- `sapCardCode` - The customer code in SAP (e.g., "C00013" for CECANOR)
- Products need prices (from SAP price list or stored locally)

## User Flow

```
1. User goes to "Consumo" page
2. Selects Centro (header - applies to all items)
3. Sees tabs: "Manual" | "Desde Documento"

TAB: Manual
   a. Search/select product
   b. System shows available lots at this Centro
   c. Select lot and quantity
   d. Optional: patient name, doctor, procedure date
   e. Click "+" to add item to list
   f. Repeat for multiple items
   g. Review items table (shows prices)
   h. Click "Registrar Consumo" → creates local record + SAP Entrega

TAB: Desde Documento
   a. Upload images/PDFs (stickers, handwritten notes, reports)
   b. Click "Extraer Datos" → Claude Vision extracts what it can
   c. Extracted items appear in editable table
   d. For items WITHOUT lot numbers:
      - System shows dropdown with available lots at Centro
      - User manually selects the correct lot
   e. User reviews/edits all data
   f. Click "Registrar Consumo" → creates local record + SAP Entrega

4. Success dialog shows SAP DocNum (Entrega number)
```

## Smart Lot Matching

When extraction doesn't find a lot number:
1. System looks up available lots for that product at the Centro
2. If only 1 lot available → auto-select it
3. If multiple lots → show dropdown sorted by expiry (FEFO suggestion)
4. User must confirm/select before submitting

## Document Types Supported

The extraction should handle various formats:
- Product stickers (from packaging)
- Handwritten consumption notes
- Typed consumption reports
- Mixed formats in same upload

The LLM prompt will be flexible to extract whatever information is visible.

## Architecture

### Data Model Changes

**Locaciones model** - Add SAP customer info:
```javascript
{
  // existing fields...
  sapCardCode: String,     // SAP customer code (e.g., "C00013")
  sapCardName: String,     // SAP customer name
}
```

**Productos model** - Need price info (may already exist or pull from SAP)

### UI for SAP Customer Mapping

The **Locaciones** edit form already exists. We'll add SAP customer fields for Centros:

```
Locaciones Edit Form (for type=CENTRO)
├── Existing fields (name, fullName, type, etc.)
├── SAP Bin Location (already exists: sapBinAbsEntry)
└── SAP Customer (NEW)
    ├── sapCardCode input (e.g., "C00013")
    └── "Buscar en SAP" button → search SAP customers
        └── Shows dropdown with matching customers
        └── Auto-fills sapCardCode and sapCardName
```

**SAP Customer Search:**
- New endpoint: `GET /api/sap/customers?search=cecanor`
- Returns matching customers from SAP BusinessPartners
- User selects one → fills sapCardCode and sapCardName

### Frontend Changes

```
Consumption.jsx (rewrite)
├── Centro selector (header, shared across tabs)
├── Tab navigation: "Manual" | "Desde Documento"
├── Tab: Manual
│   ├── Product search autocomplete
│   ├── Available lots dropdown (filtered by Centro)
│   ├── Quantity input
│   ├── Optional: patient, doctor, procedure date fields
│   ├── "Agregar" button
│   └── Items table (with prices, editable, removable)
├── Tab: Desde Documento
│   ├── FileUploader component
│   ├── "Extraer Datos" button
│   ├── Extracted items table
│   │   ├── Product (matched or needs selection)
│   │   ├── Lot (matched, suggested, or dropdown)
│   │   ├── Quantity (editable)
│   │   └── Status badge (OK / Needs Review)
│   └── Edit capabilities for each row
└── Submit button: "Registrar Consumo"

ConsumptionHistory.jsx (NEW)
├── Filters: Centro, date range, product
├── Consumption records table
│   ├── Date, Centro, SAP DocNum (Entrega)
│   ├── Items count, total value
│   └── Status (synced/pending invoice)
└── Detail dialog showing full consumption info
```

### Backend Changes

```
server/
├── services/
│   ├── extractionService.js (MODIFY)
│   │   └── extractConsumptionDocument() - flexible extraction
│   └── sapService.js (MODIFY)
│       └── createDeliveryNote() - Entrega document
├── controllers/
│   └── consumption.js (NEW)
│       ├── getAvailableInventory() - Centro's lots with prices
│       ├── extractFromDocument() - Claude extraction
│       ├── create() - Create consumption + SAP Entrega
│       └── getHistory() - Consumption history
├── routes/
│   └── consumption.js (NEW)
└── models/
    └── consumoModel.js (NEW) - Track consumption batches
```

## API Endpoints

### GET /api/consumption/inventory/:centroId
Get available products and lots at a Centro.

```javascript
Response:
{
  centro: {
    _id: "...",
    name: "CECANOR",
    sapCardCode: "C00013"
  },
  items: [
    {
      productId: "...",
      productCode: "419113",
      productName: "Orsiro Mission 2.25/15",
      sapItemCode: "419113",
      price: 1675.00,
      currency: "USD",
      lots: [
        {
          loteId: "...",
          lotNumber: "06253084",
          quantityAvailable: 2,
          expiryDate: "2028-07-09"
        }
      ]
    }
  ]
}
```

### POST /api/consumption/extract
Extract data from consumption documents.

```javascript
Request: multipart/form-data
- files: File[]
- centroId: string

Response:
{
  success: true,
  items: [
    {
      // Extracted data
      code: "419113",
      name: "Orsiro Mission 2.25/15",
      lotNumber: "06253084" | null,
      quantity: 1,
      patientName: "Juan Perez" | null,
      doctorName: "Dr. Rodriguez" | null,
      procedureDate: "2026-01-08" | null,

      // Matching results
      matchedProductId: "..." | null,
      matchedLoteId: "..." | null,
      availableLots: [...],
      needsLotSelection: true | false,
      price: 1675.00,
      currency: "USD"
    }
  ],
  warnings: []
}
```

### POST /api/consumption
Create consumption with SAP Entrega.

```javascript
Request:
{
  centroId: "...",
  items: [
    {
      productId: "...",
      loteId: "...",
      quantity: 1
    }
  ],
  patientName: "optional",
  doctorName: "optional",
  procedureDate: "optional",
  notes: "optional"
}

Response:
{
  success: true,
  consumo: { _id, items, ... },
  sapResult: {
    success: true,
    sapDocEntry: 47795,
    sapDocNum: 50610,
    sapDocType: "DeliveryNotes"
  }
}
```

### GET /api/consumption/history
Get consumption history.

```javascript
Query params: centroId, startDate, endDate, productId, limit

Response:
{
  consumos: [
    {
      _id: "...",
      centro: { _id, name, sapCardCode },
      date: "2026-01-09",
      items: [...],
      totalValue: 5025.00,
      currency: "USD",
      sapDocNum: 50610,
      sapSynced: true,
      createdBy: { firstname, lastname }
    }
  ]
}
```

## Claude Vision Extraction Prompt

```
Analyze these consumption documents and extract all consumed medical products.

The documents may be:
- Product stickers/labels from packaging
- Handwritten notes listing consumed items
- Typed consumption reports
- Any combination of formats

For each consumed item, extract what you can see:
- code: Product/article code (number, if visible)
- name: Product name or description
- lotNumber: Lot/batch number (if visible, may be labeled "Lote", "Batch", "LOT")
- quantity: Number consumed (default to 1 if not specified)
- patientName: Patient name (if visible)
- doctorName: Doctor name (if visible)
- procedureDate: Date (YYYY-MM-DD format, if visible)

IMPORTANT:
- Extract ALL items you can identify
- If lot number is not visible, set lotNumber to null
- If quantity is unclear, set to 1
- Product codes are typically 6 digits for Orsiro products (e.g., 419113)

Return valid JSON only:
{
  "items": [...],
  "warnings": ["any issues or unclear items"]
}
```

## New Files

| File | Purpose |
|------|---------|
| `server/controllers/consumption.js` | Consumption controller with SAP |
| `server/routes/consumption.js` | Consumption API routes |
| `server/models/consumoModel.js` | Consumption batch tracking |
| `client/src/pages/ConsumptionHistory.jsx` | History page |

## Modified Files

| File | Changes |
|------|---------|
| `server/services/sapService.js` | Add `createDeliveryNote()`, `getCustomers()` |
| `server/services/extractionService.js` | Add `extractConsumptionDocument()` |
| `server/controllers/sap.js` | Add `getCustomers()` endpoint |
| `server/routes/sap.js` | Add `GET /customers` route |
| `server/app.js` | Add consumption routes |
| `server/models/locacionModel.js` | Add `sapCardCode`, `sapCardName` |
| `client/src/pages/Locations.jsx` | Add SAP customer fields for Centros |
| `client/src/pages/Consumption.jsx` | Major rewrite with tabs |
| `client/src/lib/api.js` | Add consumptionApi, `sapApi.getCustomers()` |
| `client/src/components/Layout.jsx` | Add "Hist. Consumos" nav item |
| `client/src/App.jsx` | Add history route |

## Implementation Steps

### Step 1: Data Model & SAP Customer Mapping
1. Add `sapCardCode`, `sapCardName` to Locaciones model
2. Add `getCustomers()` to sapService.js (search SAP BusinessPartners)
3. Add `GET /api/sap/customers` endpoint
4. Update Locations.jsx form to show SAP customer fields for Centros
5. Add SAP customer search/select UI
6. Create Consumo model for tracking

### Step 2: Backend - SAP DeliveryNote Integration
1. Add `createDeliveryNote()` to sapService.js
2. Test with manual curl call to verify

### Step 3: Backend - Core Controller
1. Create consumption controller and routes
2. Implement `getAvailableInventory()` with prices
3. Implement `create()` with local + SAP Entrega

### Step 4: Backend - Extraction
1. Add `extractConsumptionDocument()` to extractionService
2. Implement smart lot matching logic

### Step 5: Backend - History
1. Implement `getHistory()` endpoint

### Step 6: Frontend - API & Pages
1. Add consumptionApi to api.js
2. Rewrite Consumption.jsx with tabs
3. Create ConsumptionHistory.jsx
4. Update navigation

### Step 7: Testing
1. Test manual flow end-to-end
2. Test extraction with sample documents
3. Verify SAP Entrega is created correctly

## Summary: SAP Document Flow

```
CONSUMPTION FLOW:
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Centro    │    │    App       │    │    SAP      │
│  reports    │───>│  Consumo     │───>│  Entrega    │───> Invoice
│  consumed   │    │  (local)     │    │  (50610)    │    (later)
└─────────────┘    └──────────────┘    └─────────────┘

SAP DeliveryNote includes:
- Customer: Centro (e.g., C00013 = Cecanor)
- Warehouse: 10 (Consignacion)
- Items with prices
- Batch numbers
- Patient/Doctor in Comments
```
