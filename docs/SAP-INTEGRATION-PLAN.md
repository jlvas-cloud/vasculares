# Feature Plan: SAP Business One Integration

## Overview
Integrate vasculares app with SAP B1 to create stock transfers directly from the app, eliminating double data entry. The app becomes the frontend for consignment planning while SAP remains the system of record.

## Business Context
- **Old products**: Orsiro (SAP codes like 364481)
- **New products**: Orsiro Mission (new codes like 419113)
- **Transition**: All future products will be Orsiro Mission
- **Requirement**: Products need reference to legacy SAP code for mapping
- **Tracked Supplier**: Centralmed (SAP CardCode: P00031)

---

## Complete Data Flow

### Master Data Flow
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPLETE SYSTEM FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   SUPPLIER (Centralmed)                                                      │
│      │                                                                       │
│      │  Delivers products with packing list                                 │
│      ▼                                                                       │
│   ┌─────────────────────────────────────────┐                               │
│   │  VASCULARES: "Recepcion" Page           │  ◄─── Phase 2a ✅ COMPLETE    │
│   │  - Select supplier (Centralmed/P00031)  │                               │
│   │  - Enter products, lots, expiry dates   │                               │
│   │  - Click "Crear Recepcion"              │                               │
│   └─────────────────────────────────────────┘                               │
│      │                                                                       │
│      │  POST /api/goods-receipt                                             │
│      │  Creates: Local lotes + SAP PurchaseDeliveryNotes                    │
│      ▼                                                                       │
│   ┌─────────────────────────────────────────┐                               │
│   │  SAP B1: "Entrada de Mercancía"         │                               │
│   │  - PurchaseDeliveryNotes created        │                               │
│   │  - Linked to supplier (CardCode)        │                               │
│   │  - Batch/Lot numbers with expiry        │                               │
│   │  - Stock added to Warehouse 01          │                               │
│   │  - Can create Supplier Invoice from it  │                               │
│   └─────────────────────────────────────────┘                               │
│      │                                                                       │
│      │  DocNum returned to app                                              │
│      ▼                                                                       │
│   ┌─────────────────────────────────────────┐                               │
│   │  VASCULARES: Warehouse Inventory        │                               │
│   │  - Products with lot numbers            │                               │
│   │  - Expiry dates                         │                               │
│   │  - Available quantities                 │                               │
│   │  - Linked to SAP DocNum                 │                               │
│   └─────────────────────────────────────────┘                               │
│      │                                                                       │
│      │  "Crear Consignación"                                                │
│      ▼                                                                       │
│   ┌─────────────────────────────────────────┐                               │
│   │  VASCULARES: Select Products & Lots     │                               │
│   │  - Choose destination Centro            │                               │
│   │  - Select specific lots to send         │                               │
│   │  - Review before confirming             │                               │
│   └─────────────────────────────────────────┘                               │
│      │                                                                       │
│      │  Creates StockTransfer via API                                       │
│      ▼                                                                       │
│   ┌─────────────────────────────────────────┐                               │
│   │  SAP B1: Stock Transfer                 │                               │
│   │  - From: Warehouse 01 (Principal)       │                               │
│   │  - To: Warehouse 10 + Bin (Centro)      │                               │
│   │  - Batch numbers specified              │                               │
│   └─────────────────────────────────────────┘                               │
│      │                                                                       │
│      │  DocNum returned                                                      │
│      ▼                                                                       │
│   ┌─────────────────────────────────────────┐                               │
│   │  VASCULARES: Consignment Record         │                               │
│   │  - Links to SAP DocNum                  │                               │
│   │  - Tracks status (EN_TRANSITO, etc)     │                               │
│   │  - Centro confirms receipt              │                               │
│   └─────────────────────────────────────────┘                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Principles
1. **SAP is the source of truth** for inventory quantities and batch numbers
2. **Vasculares is the planning UI** for selecting what to send where
3. **No double entry** - actions in vasculares create transactions in SAP
4. **Batch selection in vasculares** - user picks specific lots, SAP validates

---

## Initial Migration

### Purpose
Import current SAP inventory into vasculares to bootstrap the system. This is a **one-time setup** before going live.

### Approach: Manual Export + Script Import

We'll use a manual export from SAP UI because the Service Layer API doesn't expose batch quantities per warehouse directly (OIBT table not accessible via REST).

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   SAP B1 UI     │     │  Excel/CSV      │     │   Vasculares    │
│                 │     │                 │     │                 │
│  Export Report  │ ──▶ │  Inventory      │ ──▶ │  Import Script  │
│  - By warehouse │     │  - Products     │     │  - Products     │
│  - With batches │     │  - Lots         │     │  - Lotes        │
│  - With bins    │     │  - Quantities   │     │  - Inventario   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### SAP Export Requirements

Export an inventory report from SAP with these columns:

| Column | Example | Required | Maps to |
|--------|---------|----------|---------|
| ItemCode | 364481 | Yes | Product.sapItemCode |
| ItemName | Stent Coronario Orsiro 2.25/15 | Yes | Product.name |
| Warehouse | 01 | Yes | Location.sapIntegration.warehouseCode |
| BinCode | 10-CECANOR | If WH=10 | Location.sapIntegration.binCode |
| BatchNumber | 06253084 | Yes | Lote.lotNumber |
| Quantity | 2 | Yes | Lote.quantityAvailable |
| ExpiryDate | 2028-07-09 | Yes | Lote.expiryDate |

**Note**: Need separate exports or filtered views for:
- Warehouse 01 (Principal) - no bin codes
- Warehouse 10 (Consignacion) - with bin codes for each centro

### Migration Script

```javascript
// server/scripts/migrate-from-sap-export.js

const xlsx = require('xlsx');
const path = require('path');

async function migrateFromExport(filePath) {
  // 1. Read Excel file
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);

  console.log(`Found ${rows.length} rows to import`);

  // 2. Get or create locations (warehouse + bins)
  const locationMap = await ensureLocations(rows);

  // 3. Get or create products
  const productMap = await ensureProducts(rows);

  // 4. Create lotes at correct locations
  for (const row of rows) {
    const product = productMap[row.ItemCode];
    const location = locationMap[row.BinCode || row.Warehouse];

    // Check if lote already exists
    let lote = await Lotes.findOne({
      productId: product._id,
      lotNumber: row.BatchNumber,
      locationId: location._id
    });

    if (!lote) {
      lote = new Lotes({
        productId: product._id,
        lotNumber: row.BatchNumber,
        expiryDate: parseDate(row.ExpiryDate),
        quantityTotal: row.Quantity,
        quantityAvailable: row.Quantity,
        quantityReserved: 0,
        locationId: location._id,
        supplier: 'BIOTRONIK AG',
        status: 'AVAILABLE',
        source: 'SAP_MIGRATION'
      });
      await lote.save();
    }
  }

  // 5. Update inventory aggregations
  await updateAllInventario(productMap, locationMap);

  // 6. Summary
  console.log('Migration complete');
  console.log(`Products: ${Object.keys(productMap).length}`);
  console.log(`Locations: ${Object.keys(locationMap).length}`);
  console.log(`Lotes: ${rows.length}`);
}
```

### Pre-Migration: Location Mapping

Before running the import, map existing vasculares locations to SAP:

```javascript
// Run once to set up location mappings
db.locaciones.updateOne(
  { name: "Almacén Principal", type: "WAREHOUSE" },
  { $set: { sapIntegration: { warehouseCode: "01" } } }
);

db.locaciones.updateOne(
  { name: "CECANOR", type: "CENTRO" },
  { $set: { sapIntegration: { warehouseCode: "10", binAbsEntry: 4, binCode: "10-CECANOR" } } }
);
// ... repeat for all centers
```

### Product Code Mapping Script

**Purpose**: Create Orsiro Mission products and map them to legacy SAP codes.

**Script**: `server/scripts/import-orsiro-codes.js`
**Source Data**: `server/scripts/orsiro-codes.xlsx`

This script:
1. Reads the Excel file with new codes (419xxx) and legacy codes (364xxx)
2. Creates products with `code` = new Orsiro Mission code
3. Sets `sapItemCode` = new code (as string, for SAP API)
4. Sets `legacyCode` = old Orsiro code (for reference when old inventory exists in SAP)

**Usage**:
```bash
# Preview (no changes)
node scripts/import-orsiro-codes.js --dry-run

# Run import
node scripts/import-orsiro-codes.js
```

**For Production**: Update `COMPANY_ID` in the script to the production company ID before running.

### Centro Import Script

**Purpose**: Create Centro locations mapped to SAP bin locations.

**Script**: `server/scripts/import-centros.js`

This script:
1. Creates/updates locations with type='CENTRO' or 'WAREHOUSE'
2. Sets `sapIntegration` with warehouseCode, binAbsEntry, binCode
3. Locations are defined in the LOCATIONS array in the script

**Current Centros** (configured in script):
| Name | BinAbsEntry | BinCode |
|------|-------------|---------|
| Almacén Principal | - | - (warehouseCode: 01) |
| CDC | 3 | 10-CDC |
| CECANOR | 4 | 10-CECANOR |
| INCAE | 37 | 10-INCAE |
| CENICARDIO | 38 | 10-CENICARDIO |
| CERECA | 40 | 10-CERECA |

**To add new centros**: Edit the LOCATIONS array in the script, or add manually via the app UI (sapIntegration fields are now in the schema).

**Usage**:
```bash
# Preview (no changes)
node scripts/import-centros.js --dry-run

# Run import
node scripts/import-centros.js
```

**For Production**: Update `COMPANY_ID` in the script to the production company ID before running.

### Migration Checklist

- [x] Run `import-orsiro-codes.js` to create products with code mappings ✅
- [x] Run `import-centros.js` to create locations with SAP bin mappings ✅
- [ ] Export inventory from SAP for Warehouse 01 (Principal)
- [ ] Export inventory from SAP for Warehouse 10 (Consignacion) with bin locations
- [ ] Run `migrate-from-sap-export.js` migration script
- [ ] Verify totals match SAP

---

## Arrival Sync Feature

### Purpose
When products arrive from suppliers (via SAP Goods Receipt), sync them to vasculares warehouse inventory.

### User Flow
```
1. Supplier delivers products
2. Warehouse staff creates Goods Receipt (Entrada) in SAP
   - Scans/enters batch numbers
   - SAP adds stock to warehouse 01
3. User clicks "Sincronizar Entradas" in vasculares
4. App queries SAP for recent goods receipts
5. New batches are added to vasculares inventory
6. User can now include them in consignments
```

### SAP Entity: PurchaseDeliveryNotes (Goods Receipt PO)

```javascript
// Query recent goods receipts
GET /b1s/v1/PurchaseDeliveryNotes
    ?$filter=DocDate ge '{lastSyncDate}' and Warehouse eq '01'
    &$orderby=DocDate desc
    &$select=DocNum,DocDate,CardName,DocumentLines

// Response structure
{
  "DocNum": 4431,
  "DocDate": "2024-07-23",
  "CardName": "BIOTRONIK AG",
  "DocumentLines": [
    {
      "ItemCode": "364481",
      "ItemDescription": "Stent Coronario Medicado Orsiro 2.25/15",
      "Quantity": 5,
      "WarehouseCode": "01",
      "BatchNumbers": [
        {
          "BatchNumber": "06253084",
          "Quantity": 3,
          "ExpiryDate": "2028-07-09"
        },
        {
          "BatchNumber": "06253085",
          "Quantity": 2,
          "ExpiryDate": "2028-07-15"
        }
      ]
    }
  ]
}
```

### Implementation

#### New API Endpoint
```javascript
// server/controllers/sap.js

// GET /api/sap/arrivals?since=2024-01-01
exports.getArrivals = async (req, res) => {
  const { since } = req.query;

  // Query SAP for goods receipts
  const grpos = await sapService.getPurchaseDeliveryNotes({
    fromDate: since,
    warehouse: '01'
  });

  // Filter to batch-managed items we track
  const arrivals = [];
  for (const grpo of grpos) {
    for (const line of grpo.DocumentLines) {
      if (line.BatchNumbers?.length > 0) {
        arrivals.push({
          sapDocNum: grpo.DocNum,
          docDate: grpo.DocDate,
          supplier: grpo.CardName,
          itemCode: line.ItemCode,
          itemName: line.ItemDescription,
          batches: line.BatchNumbers
        });
      }
    }
  }

  res.json({ arrivals });
};

// POST /api/sap/arrivals/sync
exports.syncArrivals = async (req, res) => {
  const { arrivals } = req.body; // Selected arrivals to import

  for (const arrival of arrivals) {
    // Find or create product
    const product = await findOrCreateProduct(arrival.itemCode);

    // Create lotes for each batch
    for (const batch of arrival.batches) {
      await createLote({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        expiryDate: batch.ExpiryDate,
        quantity: batch.Quantity,
        locationId: warehouseId,
        sapDocNum: arrival.sapDocNum
      });
    }

    // Update inventory
    await updateInventario(product._id, warehouseId);
  }

  // Update last sync date
  await updateLastSyncDate();

  res.json({ success: true, imported: arrivals.length });
};
```

#### Frontend: Arrivals Sync UI

```jsx
// client/src/pages/InventoryArrivals.jsx

function InventoryArrivals() {
  const [arrivals, setArrivals] = useState([]);
  const [selected, setSelected] = useState([]);
  const [lastSync, setLastSync] = useState(null);

  // Fetch pending arrivals from SAP
  const { data, isLoading } = useQuery({
    queryKey: ['sap-arrivals', lastSync],
    queryFn: () => sapApi.getArrivals({ since: lastSync })
  });

  // Sync selected arrivals
  const syncMutation = useMutation({
    mutationFn: (arrivals) => sapApi.syncArrivals(arrivals),
    onSuccess: () => {
      queryClient.invalidateQueries(['planning-data']);
      toast.success('Entradas sincronizadas');
    }
  });

  return (
    <div>
      <h1>Sincronizar Entradas</h1>
      <p>Últimos productos recibidos en SAP</p>

      <Button onClick={() => refetch()}>
        🔄 Buscar Nuevas Entradas
      </Button>

      <Table>
        <thead>
          <tr>
            <th>☑</th>
            <th>Fecha</th>
            <th>Proveedor</th>
            <th>Producto</th>
            <th>Lotes</th>
            <th>Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {arrivals.map(arrival => (
            <tr key={arrival.sapDocNum + arrival.itemCode}>
              <td><Checkbox /></td>
              <td>{arrival.docDate}</td>
              <td>{arrival.supplier}</td>
              <td>{arrival.itemName}</td>
              <td>{arrival.batches.map(b => b.BatchNumber).join(', ')}</td>
              <td>{arrival.batches.reduce((sum, b) => sum + b.Quantity, 0)}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Button onClick={() => syncMutation.mutate(selected)}>
        Importar Seleccionados
      </Button>
    </div>
  );
}
```

### Sync Tracking

Add to system settings or a dedicated collection:

```javascript
// Track sync state
{
  lastArrivalSync: Date,           // Last time arrivals were synced
  lastSyncedDocNum: Number,        // Last SAP DocNum processed
  syncHistory: [{
    date: Date,
    documentsProcessed: Number,
    itemsImported: Number
  }]
}
```

---

## SAP Environment
```
Server: https://94.74.64.47:50000/b1s/v1
Company: HOSPAL_ENERO (development/testing)
         HOSPAL_TESTING (legacy - outdated, items missing)
```

**Note**: Development database requires manual exchange rate updates for current dates.

### SAP Warehouses
| Code | Name | Maps to Vasculares |
|------|------|-------------------|
| 01 | Principal | Almacén Principal (WAREHOUSE) |
| 10 | Consignacion | Container for all centers |
| 07 | Cirugia | - |
| 09 | Santiago | - |

### SAP Bin Locations (Ubicaciones)
**Important**: Centers are **bin locations** within warehouse 10, not separate warehouses.

| AbsEntry | BinCode | Description |
|----------|---------|-------------|
| 2 | 10-CD | Centro Medico Dominicano |
| 4 | 10-CECANOR | Cecanor |
| 6 | 10-IDC | IDC |
| 13 | 10-HOMS | HOMS |
| 14 | 10-HTPJB | Hospital Tony Perez |
| 20 | 10-HJMCB | Hospital JM Cabral |
| ... | ... | (20+ locations) |

**Transfer Structure**:
```
Warehouse 01 (Principal)
    │
    │ Stock Transfer
    ▼
Warehouse 10 (Consignacion)
    └── Bin Location: 10-CECANOR (AbsEntry: 4)
```

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
Add SAP mapping fields to `locacionModel.js`:

**Current schema fields**: name, fullName, type, address, contact, stockLimits, settings, active, notes, createdBy, historia

**NEW fields to add** (after `settings` block, around line 65):

```javascript
// SAP Business One Integration
sapIntegration: {
  warehouseCode: {
    type: String,
    sparse: true,
    description: 'SAP B1 WarehouseCode - "01" for Principal, "10" for Consignacion warehouse'
  },
  binAbsEntry: {
    type: Number,
    sparse: true,
    description: 'SAP B1 Bin Location AbsEntry - Required for CENTROs (e.g., 4 for CECANOR)'
  },
  binCode: {
    type: String,
    sparse: true,
    description: 'SAP B1 Bin Location Code (e.g., "10-CECANOR") - for display/reference'
  },
},
```

**Example mappings:**

| Vasculares Location | Type | sapIntegration |
|---------------------|------|----------------|
| Almacén Principal | WAREHOUSE | `{ warehouseCode: "01" }` |
| CECANOR | CENTRO | `{ warehouseCode: "10", binAbsEntry: 4, binCode: "10-CECANOR" }` |
| Centro Medico Dom. | CENTRO | `{ warehouseCode: "10", binAbsEntry: 2, binCode: "10-CD" }` |
| IDC | CENTRO | `{ warehouseCode: "10", binAbsEntry: 6, binCode: "10-IDC" }` |
| HOMS | CENTRO | `{ warehouseCode: "10", binAbsEntry: 13, binCode: "10-HOMS" }` |

**Note**: All CENTROs use warehouse "10" (Consignacion) but with different bin locations.

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

### Phase 1: SAP Service & Authentication ✅ DONE
Create backend service for SAP communication.

**Files created:**
- `server/services/sapService.js` ✅

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
  async getBinLocations(warehouse) { }
  async getItems(filter) { }
  async getBatchManagedItems() { }
  async getBatchStock(itemCode, warehouseCode) { }
  async getPurchaseDeliveryNotes(options) { }

  // Write operations
  async createStockTransfer(transfer) { }
}
```

### Phase 2: Data Model Updates ✅ DONE
Update models to support SAP integration.

**Files modified:**
- `server/models/productoModel.js` - Added sapItemCode, legacyCode fields ✅
- `server/models/locacionModel.js` - Added sapIntegration object (warehouseCode, binAbsEntry, binCode) ✅
- `server/models/consignacionModel.js` - Added sapDocNum, sapTransferStatus, sapError fields + lot tracking (loteId, lotNumber per item) ✅
- `client/src/pages/Locations.jsx` - Added SAP fields in edit form ✅
- `server/controllers/productos.js` - Add mapping endpoint (pending)
- `client/src/pages/Products.jsx` - Add SAP code field in edit form (pending)

### Phase 3: Initial Migration (Manual Export) 🔄 IN PROGRESS
Import current SAP inventory to bootstrap the system using Excel export.

**Steps:**
1. ✅ Map existing Locations to SAP warehouses and bin locations (done via import-centros.js)
2. ⬜ Export inventory from SAP UI (Warehouse 01 and 10 with batch details)
3. ⬜ Place CSV file in `server/scripts/` folder
4. ⬜ Run migration script to create Products, Lotes, and Inventario
5. ⬜ Verify totals match SAP

**Files created:**
- `server/scripts/migrate-from-sap-export.js` - Migration script (reads CSV) ✅

**Note:** Script expects CSV format. For Excel files, save as CSV first or add xlsx package.

### Phase 4: Arrival Sync (Sincronizar Entradas) ❌ REMOVED
~~Sync new product arrivals from SAP to vasculares.~~

**Decision**: Instead of pulling arrivals FROM SAP, we now push goods receipts TO SAP from the app (Phase 2a). This eliminates double data entry and ensures the app is the source of truth for incoming inventory.

**Removed files:**
- ~~`client/src/pages/SapArrivals.jsx`~~ - Deleted
- `server/controllers/sap.js` - Removed `getArrivals` endpoint
- `server/routes/sap.js` - Removed `/arrivals` route
- `client/src/lib/api.js` - Removed `sapApi.getArrivals`

**Replacement**: Use "Recepcion" page (`/goods-receipt`) which creates local inventory AND pushes to SAP PurchaseDeliveryNotes in one step.

### Phase 5: Batch/Lot Visibility
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

**Files to modify:**
- `client/src/pages/Planning.jsx` - Show batch selector in consignment modal

### Phase 6: Stock Transfer Creation
Create SAP transfers when consignment is confirmed.

**Flow:**
1. User selects products and specific batches in vasculares
2. User clicks "Crear Consignación"
3. Backend creates StockTransfer in SAP
4. SAP returns DocNum
5. Backend stores SAP DocNum in consignacion record
6. Local inventory updated

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
      ],
      "StockTransferLinesBinAllocations": [
        {
          "BinAbsEntry": 4,           // 10-CECANOR
          "Quantity": 2,
          "BinActionType": "batToWarehouse"
        }
      ]
    }
  ]
}
```

**Note**: `BinAbsEntry` specifies which center (bin location) receives the stock within warehouse 10.

**Files to modify:**
- `server/controllers/consignaciones.js` - Call SAP on create

### Phase 7: Continuous Sync (Optional)
Keep vasculares inventory in sync with SAP on an ongoing basis.

**Options:**
1. **Read-only from SAP**: Always fetch stock from SAP for display
2. **Periodic sync**: Cron job to reconcile inventory
3. **Event-driven**: SAP webhook on changes (if available)

**Recommended**: Rely on Arrival Sync for incoming stock and Transfer Creation for outgoing. Full sync as backup reconciliation.

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

### Step 0: Map locations to SAP
```javascript
// Warehouse (no bin location needed)
db.locaciones.updateOne(
  { name: "Almacén Principal", type: "WAREHOUSE" },
  { $set: { sapIntegration: { warehouseCode: "01" } } }
);

// Centers map to bin locations in warehouse 10
db.locaciones.updateOne(
  { name: "CECANOR", type: "CENTRO" },
  { $set: { sapIntegration: {
    warehouseCode: "10",
    binAbsEntry: 4,
    binCode: "10-CECANOR"
  } } }
);

db.locaciones.updateOne(
  { name: "Centro Medico Dominicano", type: "CENTRO" },
  { $set: { sapIntegration: {
    warehouseCode: "10",
    binAbsEntry: 2,
    binCode: "10-CD"
  } } }
);

// Full list of SAP bin locations for reference:
// AbsEntry | BinCode      | Description
// 2        | 10-CD        | Centro Medico Dominicano
// 4        | 10-CECANOR   | Cecanor
// 6        | 10-IDC       | IDC
// 13       | 10-HOMS      | HOMS
// 14       | 10-HTPJB     | Hospital Tony Perez
// 20       | 10-HJMCB     | Hospital JM Cabral
// (see SAP BinLocations for complete list)
```

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
├── services/sapService.js              # SAP API client with session management ✅ DONE
├── controllers/sap.js                  # SAP endpoints (batch-stock, stock-transfer) ✅ DONE
├── controllers/goodsReceipt.js         # Goods receipt with SAP push ✅ DONE
├── routes/sap.js                       # SAP API routes ✅ DONE
├── routes/goodsReceipt.js              # Goods receipt routes ✅ DONE
├── scripts/import-orsiro-codes.js      # Product code mapping script ✅ DONE
├── scripts/orsiro-codes.xlsx           # Source: new codes → legacy codes ✅ DONE
├── scripts/import-centros.js           # Centro/location import script ✅ DONE
└── scripts/migrate-from-sap-export.js  # Inventory migration script (reads CSV) ✅ DONE

client/src/
├── pages/GoodsReceipt.jsx              # Goods receipt page (App → SAP) ✅ DONE
├── lib/api.js                          # Added sapApi, goodsReceiptApi clients ✅ DONE
└── components/consignment/
    └── BatchSelector.jsx               # Lot selection component for consignments (pending)
```

### Modified Files
```
server/
├── models/productoModel.js          # Add sapItemCode, legacyCode fields ✅ DONE
├── models/locacionModel.js          # Add sapIntegration object ✅ DONE
├── models/consignacionModel.js      # Add sapDocNum, sapTransferStatus, loteId/lotNumber ✅ DONE
├── models/transaccionModel.js       # Add sapIntegration for sync tracking ✅ DONE
├── controllers/consignaciones.js    # Call SAP StockTransfer on create (pending)
├── controllers/transacciones.js     # Add sapSync filter support ✅ DONE
└── routes.js                        # Add SAP routes ✅ DONE

client/src/
├── pages/Locations.jsx              # SAP integration fields in form ✅ DONE
├── pages/Planning.jsx               # Batch selector in consignment modal (partially done)
├── pages/TransactionHistory.jsx     # SAP sync status badges + filter ✅ DONE
├── components/Layout.jsx            # Added "Llegadas SAP" menu item ✅ DONE
└── App.jsx                          # Add route for SapArrivals ✅ DONE
```

## Implementation Order

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| Phase 1 | SAP Service & Authentication | None |
| Phase 2 | Data Model Updates | Phase 1 |
| Phase 3 | Initial Migration | Phase 1, 2 |
| Phase 4 | Arrival Sync | Phase 1, 2, 3 |
| Phase 5 | Batch Visibility | Phase 1, 2, 3 |
| Phase 6 | Transfer Creation | Phase 1, 2, 5 |
| Phase 7 | Continuous Sync (Optional) | All above |

## Next Steps

### Immediate (Setup) ✅ DONE
1. ✅ Add SAP credentials to `.env` file
2. ✅ Create `server/services/sapService.js` with login/session management
3. ✅ Test SAP connection and basic API calls

### Data Model Updates ✅ DONE
4. ✅ Update `productoModel.js` with sapItemCode, legacyCode fields
5. ✅ Update `locacionModel.js` with sapIntegration object
6. ✅ Update `consignacionModel.js` with sapDocNum, sapTransferStatus, lot tracking fields

### Initial Migration (Manual Export) 🔄 IN PROGRESS
7. ✅ Map existing locations to SAP warehouses and bin locations (via import-centros.js)
8. ⬜ Export inventory from SAP UI (Warehouse 01 + Warehouse 10 with bins)
9. ⬜ Run `migrate-from-sap-export.js` script with CSV file
10. ⬜ Verify inventory totals match SAP

### Goods Receipt Feature ✅ COMPLETE
11. ✅ Build Goods Receipt page (`GoodsReceipt.jsx`)
12. ✅ Add goodsReceiptApi client in api.js
13. ✅ Push to SAP PurchaseDeliveryNotes (Entrada de Mercancía)
14. ✅ SAP sync status tracking on transactions
15. ✅ Transaction History shows SAP status badges + filter

### Feature Development (Remaining)
16. ⬜ Build BatchSelector component for consignment modal
17. ⬜ Integrate SAP StockTransfer creation on consignment confirm
18. ⬜ Planning page lot selection (partially implemented)

### Validation
19. ✅ Test Goods Receipt flow: App → Local DB + SAP PurchaseDeliveryNotes ✅ WORKING
20. ⬜ Test full workflow: Arrival → Consignment → SAP Transfer
21. ⬜ Verify inventory matches SAP after each operation
22. ⬜ Switch to production SAP database for real testing

### Known Issues to Address
- ✅ ~~SAP test database (HOSPAL_TESTING) only has data up to July 2024~~ - RESOLVED: Switched to HOSPAL_ENERO
- ✅ ~~PurchaseDeliveryNotes don't embed BatchNumbers~~ - SOLVED: Query BatchNumberDetails by ItemCode + AdmissionDate (see `docs/SAP-BATCH-TRACKING.md`)
- ⚠️ Development SAP database requires manual exchange rate updates for current dates

### Documentation
- `docs/SAP-BATCH-TRACKING.md` - Technical reference for accessing batch/lot info from SAP

---

## Phase 2: Goods Receipt (App → SAP) ✅ PHASE 2a COMPLETE

### Overview
Instead of syncing FROM SAP, allow users to enter goods receipts IN the app and push TO SAP. This eliminates double data entry.

### Flow
```
Supplier delivers → Staff enters in App → Push to SAP (PurchaseDeliveryNotes)
                    (manual or packing list)    ↓
                                          Entrada de Mercancía created
                                                ↓
                                          Can create Supplier Invoice from this
```

### SAP Document Types

| Document Type | SAP Entity | Use Case |
|--------------|------------|----------|
| ~~InventoryGenEntries~~ | Internal adjustment | ❌ Can't create invoices from this |
| **PurchaseDeliveryNotes** | Goods Receipt PO | ✅ **USE THIS** - Creates "Entrada de Mercancía" that links to supplier for invoicing |

### SAP API - PurchaseDeliveryNotes ✅ TESTED

**Endpoint**: `POST /b1s/v1/PurchaseDeliveryNotes`

```javascript
{
  "DocDate": "2024-07-01",
  "CardCode": "P00031",           // Required: Supplier (e.g., Centralmed)
  "Comments": "Entrada desde Vasculares App",
  "DocumentLines": [{
    "ItemCode": "002-01",
    "Quantity": 1,
    "WarehouseCode": "01",
    "TaxCode": "EXE",             // Required: Tax code
    "BatchNumbers": [{
      "BatchNumber": "TEST-EM-001",
      "Quantity": 1,
      "ExpiryDate": "2028-06-30"
    }]
  }]
}
```

**Test Results** (2026-01-09):
- ✅ Created DocEntry 4434, DocNum 4432
- ✅ CardCode links to supplier (CentralMed, S.A.)
- ✅ Creates proper "Goods Receipt PO" / "Entrada de Mercancía"
- ✅ This document can be used to create supplier invoices (Facturas de Proveedor)
- ✅ No Purchase Order required
- ✅ Batch numbers created with expiry dates
- ⚠️ Test DB has outdated exchange rates (use 2024 dates for testing)

### Implementation Status

#### Phase 2a: Manual Entry ✅ COMPLETE

**Backend Files Created:**
- `server/controllers/goodsReceipt.js` ✅
  - `createGoodsReceipt` - Creates local lotes + pushes PurchaseDeliveryNotes to SAP
  - `getProductsForReceipt` - Lists products with SAP codes
  - `getWarehouses` - Lists warehouse locations
- `server/routes/goodsReceipt.js` ✅
- `server/app.js` - Added goodsReceipt routes ✅

**Frontend Files Created:**
- `client/src/pages/GoodsReceipt.jsx` ✅
  - Warehouse selector
  - Supplier selector (Centralmed with SAP code P00031)
  - Multi-item form (product search, lot number, quantity, expiry)
  - Submit creates local records + pushes to SAP
  - Shows "Entrada de Mercancía" result with DocNum
- `client/src/lib/api.js` - Added goodsReceiptApi ✅
- `client/src/App.jsx` - Added /goods-receipt route ✅
- `client/src/components/Layout.jsx` - Added "Recepcion" menu item ✅

**API Endpoints:**
```
GET  /api/goods-receipt/warehouses     - List warehouse locations
GET  /api/goods-receipt/products       - Search products with SAP codes
POST /api/goods-receipt                - Create goods receipt (local + SAP)
```

**Request Body:**
```javascript
{
  "locationId": "...",           // Warehouse ObjectId
  "supplier": "Centralmed",      // Supplier name (for display)
  "supplierCode": "P00031",      // SAP CardCode - REQUIRED for SAP
  "notes": "...",
  "pushToSap": true,
  "items": [{
    "productId": "...",
    "lotNumber": "BATCH-001",
    "quantity": 5,
    "expiryDate": "2028-06-30"
  }]
}
```

**Response:**
```javascript
{
  "success": true,
  "lotes": [...],
  "transactions": [...],
  "sapResult": {
    "success": true,
    "sapDocEntry": 4434,
    "sapDocNum": 4432,
    "sapDocType": "PurchaseDeliveryNotes"  // Entrada de Mercancía
  }
}
```

**Key Requirements:**
1. Supplier with SAP CardCode is **required** to create Entrada de Mercancía
2. Products must have `sapItemCode` configured
3. TaxCode defaults to 'EXE' (exempt) - configurable in code

#### SAP Sync Tracking ✅ COMPLETE

Transactions now track SAP sync status for visibility:

**Model Update** (`transaccionModel.js`):
```javascript
sapIntegration: {
  pushed: Boolean,        // true if synced, false if failed
  docEntry: Number,       // SAP Document Entry
  docNum: Number,         // SAP Document Number
  docType: String,        // e.g., 'PurchaseDeliveryNotes'
  error: String,          // Error message if failed
  syncDate: Date          // When sync was attempted
}
```

**Transaction History UI** (`TransactionHistory.jsx`):
- Green badge `SAP: 4435` for synced receipts
- Red badge `SAP: Error` with full error message for failed syncs
- Filter by "Estado SAP" to show only synced or failed transactions

**Controller Update** (`goodsReceipt.js`):
- After SAP push attempt, updates all transactions with sync status
- Local inventory is always saved (even if SAP fails) - data safety pattern

#### Phase 2b: Packing List Upload (Pending)
- [ ] Upload PDF/image of packing list
- [ ] Extract data (Centralmed/Biotronik format - always same)
- [ ] Review/edit extracted data
- [ ] Confirm → Save local + Push to SAP

### Configured Suppliers

| Supplier | SAP CardCode | Notes |
|----------|--------------|-------|
| Centralmed | P00031 | Primary supplier for Orsiro Mission |

To add more suppliers, update the `suppliers` array in `GoodsReceipt.jsx`.
