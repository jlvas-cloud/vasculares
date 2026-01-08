# Feature Plan: SAP Business One Integration

## Overview
Integrate vasculares app with SAP B1 to create stock transfers directly from the app, eliminating double data entry. The app becomes the frontend for consignment planning while SAP remains the system of record.

## Business Context
- **Old products**: Orsiro (SAP codes like 364481)
- **New products**: Orsiro Mission (new codes like 419113)
- **Transition**: All future products will be Orsiro Mission
- **Requirement**: Products need reference to legacy SAP code for mapping

## SAP Environment
```
Server: https://94.74.64.47:50000/b1s/v1
Company: HOSPAL_TESTING
```

### SAP Warehouses
| Code | Name | Maps to Vasculares |
|------|------|-------------------|
| 01 | Principal | Almacén Principal (WAREHOUSE) |
| 10 | Consignacion | Centros (CENTRO) |
| 07 | Cirugia | - |
| 09 | Santiago | - |

## Data Model Changes

### Product Model Update
Add SAP code reference to `productoModel.js`:

```javascript
{
  // Existing fields...
  code: Number,           // New code (419113) - primary

  // NEW: SAP/Legacy code mapping
  sapItemCode: {
    type: String,
    sparse: true,
    description: 'SAP B1 ItemCode for API integration (e.g., 364481)'
  },
  legacyCode: {
    type: Number,
    sparse: true,
    description: 'Old Orsiro code for reference during transition'
  },
}
```

### Location Model Update
Add SAP warehouse mapping to `locacionModel.js`:

```javascript
{
  // Existing fields...

  // NEW: SAP warehouse mapping
  sapWarehouseCode: {
    type: String,
    sparse: true,
    description: 'SAP B1 WarehouseCode (e.g., "01", "10")'
  },
}
```

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      VASCULARES APP                              │
├──────────────────────┬──────────────────────────────────────────┤
│     Frontend         │              Backend                      │
│                      │                                           │
│  Planning.jsx        │   sapService.js                          │
│  - Select products   │   - login()                              │
│  - Select lots       │   - getItems()                           │
│  - Create consign    │   - getBatchStock()                      │
│                      │   - createStockTransfer()                │
│                      │   - logout()                             │
│                      │                                           │
│  LotSelector.jsx     │   consignaciones.js (updated)            │
│  - Show SAP batches  │   - Call SAP on create                   │
│  - Pick specific lot │   - Store SAP DocNum                     │
└──────────────────────┴──────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   SAP B1 API    │
                    │  Service Layer  │
                    └─────────────────┘
```

## Implementation Phases

### Phase 1: SAP Service & Authentication
Create backend service for SAP communication.

**Files to create:**
- `server/services/sapService.js`

**Features:**
- Session management (login/logout)
- Session caching (30min timeout)
- Error handling
- Retry logic

```javascript
// sapService.js structure
class SAPService {
  constructor(config) { }

  async login() { }
  async logout() { }
  async ensureSession() { }

  // Read operations
  async getWarehouses() { }
  async getItems(filter) { }
  async getItemStock(itemCode) { }
  async getBatchStock(itemCode, warehouseCode) { }

  // Write operations
  async createStockTransfer(transfer) { }
}
```

### Phase 2: Product Sync
Sync products from SAP or map existing products.

**Option A: Manual mapping**
- Admin UI to link vasculares products to SAP ItemCodes
- Good for transition period with mixed old/new codes

**Option B: Auto-sync from SAP**
- Import items from SAP with batch management
- Create products in vasculares with SAP codes

**Recommended: Option A** during transition, then Option B for new products.

**Files to modify:**
- `server/models/productoModel.js` - Add sapItemCode field
- `server/controllers/productos.js` - Add mapping endpoint
- `client/src/pages/Products.jsx` - Add SAP code field in edit form

### Phase 3: Batch/Lot Visibility
Show SAP batch stock in consignment UI.

**New API endpoint:**
```
GET /api/sap/batch-stock?itemCode=364481&warehouse=01
```

**Response:**
```javascript
{
  itemCode: "364481",
  itemName: "Stent Coronario Medicado Orsiro 2.25/15",
  warehouse: "01",
  batches: [
    {
      batchNumber: "06253084",
      quantity: 2,
      expiryDate: "2028-07-09",
      admissionDate: "2025-11-20"
    },
    {
      batchNumber: "06253781",
      quantity: 1,
      expiryDate: "2028-07-12",
      admissionDate: "2025-11-20"
    }
  ]
}
```

**Files to create:**
- `server/controllers/sap.js` - SAP API endpoints
- `server/routes/sap.js` - Routes

**Files to modify:**
- `client/src/pages/Planning.jsx` - Show batch selector in consignment modal

### Phase 4: Stock Transfer Creation
Create SAP transfers when consignment is confirmed.

**Flow:**
1. User selects products and specific batches in vasculares
2. User clicks "Crear Consignación"
3. Backend creates StockTransfer in SAP
4. SAP returns DocNum
5. Backend stores SAP DocNum in consignacion record
6. Local inventory updated (or synced from SAP)

**SAP API Call:**
```javascript
POST /b1s/v1/StockTransfers
{
  "FromWarehouse": "01",
  "ToWarehouse": "10",
  "Comments": "Consignación #123 - Vasculares App",
  "StockTransferLines": [
    {
      "ItemCode": "364481",
      "Quantity": 2,
      "FromWarehouseCode": "01",
      "WarehouseCode": "10",
      "BatchNumbers": [
        {
          "BatchNumber": "06253084",
          "Quantity": 2
        }
      ]
    }
  ]
}
```

**Files to modify:**
- `server/models/consignacionModel.js` - Add sapDocNum field
- `server/controllers/consignaciones.js` - Call SAP on create

### Phase 5: Inventory Sync (Optional)
Keep vasculares inventory in sync with SAP.

**Options:**
1. **Read-only from SAP**: Always fetch stock from SAP
2. **Periodic sync**: Cron job to sync inventory
3. **Event-driven**: SAP webhook on changes (if available)

**Recommended**: Start with read-only for batch selection, keep local inventory for planning calculations.

## UI Changes

### Consignment Modal (Updated)
```
┌─────────────────────────────────────────────────────────────┐
│ Crear Consignación                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ☑ Orsiro Mission 2.25/15 (419113)                          │
│   SAP: 364481                                               │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ Lote        │ Vence      │ Disp. │ A Enviar        │  │
│   ├─────────────┼────────────┼───────┼─────────────────┤  │
│   │ 06253084    │ 09/07/2028 │   2   │ [2]             │  │
│   │ 06253781    │ 12/07/2028 │   1   │ [0]             │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│ ☑ Orsiro Mission 2.25/18 (419119)                          │
│   SAP: 364487                                               │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ Lote        │ Vence      │ Disp. │ A Enviar        │  │
│   ├─────────────┼────────────┼───────┼─────────────────┤  │
│   │ 06250176    │ 29/06/2028 │   3   │ [1]             │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Total productos: 2                                          │
│ Total unidades: 3                                           │
├─────────────────────────────────────────────────────────────┤
│                              [Cancelar] [Crear en SAP]      │
└─────────────────────────────────────────────────────────────┘
```

## Environment Variables
Add to `.env`:
```
SAP_B1_SERVER=https://94.74.64.47:50000/b1s/v1
SAP_B1_COMPANY_DB=HOSPAL_TESTING
SAP_B1_USERNAME=Profes02
SAP_B1_PASSWORD=hospal786
```

## Security Considerations
- Store SAP credentials in environment variables (not in code)
- Use HTTPS for all SAP communication
- Session tokens should not be exposed to frontend
- All SAP calls go through backend (never from browser)

## Error Handling
- SAP session expired → Auto re-login
- SAP validation error → Show user-friendly message
- Network error → Retry with exponential backoff
- Insufficient stock in SAP → Block transfer, show available

## Migration Steps

### Step 1: Map existing products
```javascript
// Run once to map Orsiro → Orsiro Mission
db.productos.updateOne(
  { code: 419113 },  // Orsiro Mission 2.25/15
  { $set: { sapItemCode: "364481", legacyCode: 364481 } }
);
```

### Step 2: Map locations
```javascript
db.locaciones.updateOne(
  { name: "Almacén Principal" },
  { $set: { sapWarehouseCode: "01" } }
);
```

## Files Summary

### New Files
```
server/
├── services/sapService.js      # SAP API client
├── controllers/sap.js          # SAP endpoints
└── routes/sap.js               # SAP routes

client/src/
└── components/consignment/
    └── BatchSelector.jsx       # Lot selection component
```

### Modified Files
```
server/
├── models/productoModel.js     # Add sapItemCode, legacyCode
├── models/locacionModel.js     # Add sapWarehouseCode
├── models/consignacionModel.js # Add sapDocNum
├── controllers/consignaciones.js # SAP integration on create
└── routes.js                   # Add SAP routes

client/src/
└── pages/Planning.jsx          # Batch selector in modal
```

## Timeline Estimate
| Phase | Effort |
|-------|--------|
| Phase 1: SAP Service | 1-2 days |
| Phase 2: Product Mapping | 1 day |
| Phase 3: Batch Visibility | 1-2 days |
| Phase 4: Transfer Creation | 2-3 days |
| Phase 5: Inventory Sync | Optional, 2-3 days |

## Next Steps
1. Add SAP credentials to `.env`
2. Update product model with sapItemCode field
3. Update location model with sapWarehouseCode field
4. Create SAP service
5. Test connection and basic operations
6. Build batch selector UI
7. Integrate transfer creation
