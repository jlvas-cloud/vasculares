# Known Issues & Future Improvements

## Pending Fixes

### Mongoose Duplicate Index Warnings (2026-01-14)
**Status:** LOW PRIORITY

When running sync or other scripts, Mongoose logs duplicate index warnings:

```
[MONGOOSE] Warning: Duplicate schema index on {"code":1} found.
[MONGOOSE] Warning: Duplicate schema index on {"sapItemCode":1} found.
[MONGOOSE] Warning: Duplicate schema index on {"legacyCode":1} found.
[MONGOOSE] Warning: Duplicate schema index on {"companyId":1} found.
```

**Cause:** Index defined both with `index: true` in field options AND `schema.index()` call.

**Fix:** Review `models/productoModel.js` and remove duplicate index definitions. Keep either the field-level `index: true` or the explicit `schema.index()` call, not both.

**Impact:** No functional impact - just console noise. Indexes work correctly.

---

## Recently Completed

### Lote Uniqueness Constraint (2026-01-12)
**Status:** COMPLETE

Added unique compound index to enforce one Lote record per (product, lotNumber, location).

**File:** `models/loteModel.js`
```javascript
loteSchema.index({ productId: 1, lotNumber: 1, currentLocationId: 1 }, { unique: true });
```

**Why:** Prevents duplicate records from race conditions. Multiple shipments of same lot to same location correctly UPDATE the single record's quantity.

---

### SAP Inventory Sync (2026-01-12, updated 2026-01-13)
**Status:** COMPLETE

One-step sync to pull inventory directly from SAP B1 Service Layer.

**Files Created:**
- `services/sapSyncService.js` - Core sync logic
- `scripts/sync-inventory-from-sap.js` - CLI script
- `scripts/import-inventory-csv.js` - CSV import as fallback
- `docs/solicitud-semantic-layer-sap.md` - Request for SAP partner
- `docs/exportar-inventario-sap.md` - Manual export guide

**Usage:**
```bash
node scripts/sync-inventory-from-sap.js --dry-run   # Preview
node scripts/sync-inventory-from-sap.js             # Full sync
node scripts/sync-inventory-from-sap.js --verbose   # Detailed output
node scripts/sync-inventory-from-sap.js --warehouse-only  # Skip centros
```

**Prerequisites:**
1. Products with `sapItemCode` (via `import-orsiro-codes.js`)
2. Locations with `sapIntegration.warehouseCode` (via `import-centros.js`)
3. SAP credentials in `.env`
4. **Semantic Layer enabled on SAP Service Layer** ← BLOCKING

---

### Reset Script for Testing (2026-01-12)
**Status:** COMPLETE

Script to clear inventory data for repeated testing of onboarding.

**File:** `scripts/reset-inventory-data.js`

**Usage:**
```bash
node scripts/reset-inventory-data.js --dry-run   # Preview
node scripts/reset-inventory-data.js --confirm   # Delete
```

**Keeps:** productos, locaciones (master data)
**Deletes:** lotes, inventario, consignaciones, consumos, goodsreceipts, transacciones

---

## SAP OIBT Access - RESOLVED

**Issue discovered:** 2026-01-13
**Resolved:** 2026-01-13

**Problem:**
SAP B1 Service Layer does NOT expose the OIBT/OBBQ tables by default.

**Solution Applied:**
SAP partner (Winder) added OIBT to the `b1s_sqltable.conf` AllowList file.

**Tables Now Accessible via SQLQueries:**
| Table | Purpose |
|-------|---------|
| OIBT | Batch inventory by warehouse |
| OBBQ | Batch quantities by bin location |
| OBTN | Batch master data (expiry dates) |
| OBIN | Bin location codes |

**How It Works:**
- Warehouse 01 (no bins): Query OIBT directly
- Warehouse 10 (with bins): Query OBBQ joined with OBTN for bin-specific data

**Key Learnings:**
1. Semantic Layer (`sml.svc`) is HANA-only - doesn't work on SQL Server
2. For SQL Server, use SQLQueries endpoint with AllowList configuration
3. B1SLQuery views can be auto-detected, but requires additional config
4. AllowList in `b1s_sqltable.conf` is the simplest solution
5. **CRITICAL: SQLQueries ignores `$top` and `$skip` parameters** - must follow `odata.nextLink` for pagination (default page size is 20 records)

**Updated Files:**
- `services/sapSyncService.js` - Now uses SQLQueries for OIBT/OBBQ
- `scripts/sync-inventory-from-sap.js` - Updated to use bin-specific sync

---

## SAP Batch Validation - COMPLETE

**Issue discovered:** 2026-01-12
**Resolved:** 2026-01-13

**Problem:**
When creating lots locally (via packing list OCR or manual entry), there's no validation against SAP to verify the batch-item relationship.

**Solution Implemented:**
Before creating a goods receipt, the system now validates each batch against SAP:

1. **Backend** (`services/sapService.js`):
   - `validateBatchItem(batchNumber)` - Query SAP BatchNumberDetails
   - `validateBatchItems(items)` - Validate multiple batches

2. **API Endpoint** (`POST /api/goods-receipt/validate-batches`):
   - Returns mismatches with correct product info from local DB
   - Enriches response with product name and code

3. **Frontend** (`GoodsReceipt.jsx`):
   - Validates batches before submission
   - Shows clear error dialog with:
     - Which batch has mismatch
     - Selected product code (wrong)
     - Correct SAP product code
     - Product name from local DB
   - Blocks creation until user corrects selection

**Result:** Prevents "No matching records found (ODBC -2028)" SAP errors by catching mismatches early.

---

## SAP Reconciliation System - COMPLETE

**Documented:** 2026-01-13
**Status:** IMPLEMENTED (2026-01-13, updated with Moving Date Window)
**Design Doc:** `docs/sap-reconciliation-design.md`

**Problem:** Users can make movements directly in SAP that bypass our app, causing drift between local database and SAP.

**Solution:** Two complementary mechanisms + moving date window:

### 1. Pre-Operation Guard (Real-Time Protection)

Before any stock movement, verify with SAP that the batch/quantity exists.

| Operation | Check |
|-----------|-------|
| Consignment | Verify batch exists in SAP source warehouse with sufficient qty |
| Consumption | Verify batch exists in SAP centro location with sufficient qty |

**On mismatch:** Block operation, show warning with SAP's actual quantity.

### 2. Document Reconciliation (Audit/Visibility)

Check SAP for documents involving our products that weren't created by our app.

| Trigger | Frequency |
|---------|-----------|
| Nightly job | Once per night |
| On-demand | Admin clicks "Verificar SAP" button |

**Documents checked:** PurchaseDeliveryNotes, StockTransfers, DeliveryNotes

**Output:** Dashboard showing external documents for admin review with actions: Acknowledge, Import, Ignore.

### Implementation Status

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Pre-op guard for Consignment | **COMPLETE** (2026-01-13) |
| 2 | Pre-op guard for Consumption | **COMPLETE** (2026-01-13) |
| 3 | Document reconciliation service + nightly job | **COMPLETE** (2026-01-13) |
| 4 | On-demand reconciliation API + Admin dashboard UI | **COMPLETE** (2026-01-13) |

### Phase 1 & 2: Pre-Operation Guards - COMPLETE

**Backend Implementation:**
- `services/sapService.js`:
  - `verifyBatchStockAtLocation(itemCode, batchNumber, warehouseCode, binAbsEntry)` - Query OIBT/OBBQ
  - `verifyBatchStockForTransfer(items, sourceWarehouse, sourceBinAbsEntry)` - Validate multiple batches
  - `executeSQLQuery(queryCode, queryName, sqlText)` - Generic SQL execution helper
- `controllers/consignaciones.js` - Added `validateSapStock` endpoint
- `controllers/consumption.js` - Added `validateSapStock` endpoint
- `routes/consignaciones.js` - Added `POST /validate-sap-stock`
- `routes/consumption.js` - Added `POST /validate-sap-stock`

**Frontend Implementation:**
- `lib/api.js`:
  - `consignacionesApi.validateSapStock(data)`
  - `consumptionApi.validateSapStock(data)`
- `pages/Planning.jsx` - Validates before creating consignment, shows mismatch dialog
- `pages/Consumption.jsx` - Validates before creating consumption, shows mismatch dialog

**Behavior:**
- Before any stock movement (consignment or consumption), queries SAP OIBT/OBBQ
- Verifies batch exists at source location with sufficient quantity
- If mismatch: Blocks operation, shows detailed dialog with SAP's actual quantities
- If SAP unreachable: Blocks operation (strict mode)
- User must adjust quantities or investigate before proceeding

### Phase 3: Document Reconciliation Service + Nightly Job - COMPLETE

**Files Created:**
- `models/externalSapDocumentModel.js` - Tracks external SAP documents
- `models/reconciliationRunModel.js` - Tracks reconciliation runs
- `services/reconciliationService.js` - Core reconciliation logic
- `jobs/nightlyReconciliation.js` - Cron job for nightly runs

**Backend Implementation:**
- `services/sapService.js`:
  - `getRecentPurchaseDeliveryNotes(since, itemCodes)` - Query PurchaseDeliveryNotes
  - `getRecentStockTransfers(since, itemCodes)` - Query StockTransfers
  - `getRecentDeliveryNotes(since, itemCodes)` - Query DeliveryNotes
- `services/reconciliationService.js`:
  - `runReconciliation(companyId, options)` - Main reconciliation logic
  - `getPendingExternalDocuments(companyId)` - Get external docs for review
  - `updateExternalDocumentStatus(companyId, docId, status, user, notes)` - Update status

**Nightly Job:**
- Schedule: 2:00 AM daily (configurable via `RECONCILIATION_CRON` env var)
- Uses **moving date window** (not fixed lookback)
- Auto-starts on server startup (disable with `ENABLE_CRON_JOBS=false`)

**Moving Date Window Logic:**
| Scenario | Date Range |
|----------|------------|
| First run | From `goLiveDate` (set by sync script) to now |
| Subsequent runs | From last successful run's `completedAt` to now |
| Custom range | User-specified `fromDate` and `toDate` via dashboard |

**Manual Run:**
```bash
node jobs/nightlyReconciliation.js --run-now
node jobs/nightlyReconciliation.js --run-now --company-id=<id>
```

### Phase 4: On-Demand API + Admin Dashboard - COMPLETE

**API Endpoints:**
- `POST /api/reconciliation/run` - Trigger on-demand reconciliation (accepts `fromDate`, `toDate`)
- `GET /api/reconciliation/status` - Get latest run + pending count
- `GET /api/reconciliation/runs` - Get run history
- `GET /api/reconciliation/external-documents` - Get external docs (filtered by status)
- `PUT /api/reconciliation/external-documents/:id/status` - Update doc status
- `GET /api/reconciliation/config` - Get goLiveDate configuration
- `PUT /api/reconciliation/config/go-live-date` - Manually set goLiveDate

**Files Created:**
- `controllers/reconciliation.js` - API controller
- `routes/reconciliation.js` - API routes
- `models/vascularesConfigModel.js` - Per-company config (goLiveDate)

**Frontend:**
- `lib/api.js` - Added `reconciliationApi` with all endpoints
- `pages/Reconciliation.jsx` - Admin dashboard with:
  - Status cards (last run, pending count, docs checked, config status)
  - "Verificar Ahora" button for on-demand reconciliation
  - **"Rango Personalizado" button** for custom date range
  - Warning banner when goLiveDate not configured
  - External documents list with filtering by status
  - Actions: Acknowledge, Ignore (with notes)
  - Run history table with date range info
- `components/Layout.jsx` - Added navigation link under Admin section

**Document Statuses:**
| Status | Description |
|--------|-------------|
| PENDING_REVIEW | Newly detected, needs review |
| ACKNOWLEDGED | Reviewed, not imported |
| IMPORTED | Imported into local system |
| IGNORED | Marked as not relevant |

**Dependency Added:**
- `node-cron@^3.0.3` - For scheduling nightly jobs

### External Document Import Feature (2026-01-14)
**Status:** COMPLETE

Allows importing external SAP documents (created directly in SAP, bypassing our app) into the local database.

**Files Created/Modified:**
- `services/externalImportService.js` - Core validation and import logic
- `services/sapService.js` - Added `getStockTransferByDocEntry()` for bin allocation fetch
- Updated `controllers/reconciliation.js` - Added validate/import endpoints
- Updated `routes/reconciliation.js` - Added routes
- Updated `client/src/lib/api.js` - Added API methods
- Updated `client/src/pages/Reconciliation.jsx` - Added import UI

**Features:**
- **Validation before import**: Checks products, locations, batch existence
- **Preview of changes**: Shows lotes to create/update before confirming
- **Dependency detection**: Suggests importing prerequisite documents first
- **Bin allocation fetching**: Fetches fresh SAP data during import to get bin allocations (OData list queries don't return them)
- **Origin tracking**: Imported documents marked with `origin: 'SAP_IMPORT'` and linked via `importedFromId`
- **Support for all document types**:
  - PurchaseDeliveryNote → Creates Lotes + GoodsReceipt
  - StockTransfer → Updates Lotes + Creates Consignacion
  - DeliveryNote → Reduces Lotes + Creates Consumo

**API Endpoints:**
- `POST /api/reconciliation/external-documents/:id/validate` - Validate document
- `POST /api/reconciliation/external-documents/:id/import` - Import document

**Usage:**
1. Go to `/reconciliation` dashboard
2. Click "Importar" on any pending external document
3. Review validation results and preview
4. Click "Importar" to confirm

**Documentation:** `docs/external-document-import.md`

---

### Origin Tracking for Imported Documents (2026-01-14)
**Status:** COMPLETE

Added fields to distinguish app-created documents from SAP-imported documents.

**Schema Changes:**
- Added `origin` field (`'APP'` | `'SAP_IMPORT'`) to Consignacion, Consumo, GoodsReceipt
- Added `importedFromId` reference to ExternalSapDocument for traceability

**Files Modified:**
- `models/consignacionModel.js`
- `models/consumoModel.js`
- `models/goodsReceiptModel.js`
- `services/externalImportService.js`

**UI Consideration:** Existing documents will have `origin: undefined`. UI should treat `undefined` as equivalent to `'APP'`.

---

### StockTransfer Bin Allocation Fetching (2026-01-14)
**Status:** COMPLETE

SAP OData list queries don't return nested `StockTransferLinesBinAllocations` data. Fixed by fetching individual documents during import.

**Problem:**
- List query: `StockTransfers?$filter=...` → Returns `StockTransferLinesBinAllocations: []` (empty)
- Individual fetch: `StockTransfers(56977)` → Returns full bin allocation data

**Solution:**
- Added `getStockTransferByDocEntry(docEntry)` in sapService.js
- Validation and Import now fetch fresh SAP data before processing
- Location matching priority: bin → cardCode → warehouse

**Files Modified:**
- `services/sapService.js` - Added `getStockTransferByDocEntry()`
- `services/externalImportService.js` - Fetch fresh data in validation/import

---

### Reconciliation SQLQueries Optimization (2026-01-14)
**Status:** COMPLETE

Optimized reconciliation queries to use SQLQueries endpoint instead of OData with client-side filtering.

**Before:** OData endpoint fetched ALL documents from SAP, then filtered client-side by itemCodes
**After:** SQL query filters server-side, only returning documents with our products

**SAP Tables Required in `b1s_sqltable.conf`:**
| Table | Purpose | Document Type |
|-------|---------|---------------|
| OPDN | Purchase Delivery Note header | Goods Receipts |
| PDN1 | Purchase Delivery Note lines | Goods Receipts |
| OWTR | Stock Transfer header | Transfers |
| WTR1 | Stock Transfer lines | Transfers |
| ODLN | Delivery Note header | Consumptions |
| DLN1 | Delivery Note lines | Consumptions |
| IBT1 | Batch allocation details | All (batch info) |

**Note:** If SQL queries fail (tables not in AllowList), functions automatically fall back to OData approach.

**SQL Query Pattern:**
```sql
SELECT DISTINCT
  T0.DocEntry, T0.DocNum, T0.DocDate, T0.CardCode, T0.CardName, T0.Comments,
  T1.LineNum, T1.ItemCode, T1.Quantity, T1.WhsCode,
  T2.BatchNum as BatchNumber
FROM {HEADER_TABLE} T0
INNER JOIN {LINES_TABLE} T1 ON T0.DocEntry = T1.DocEntry
LEFT JOIN IBT1 T2 ON T1.DocEntry = T2.BaseEntry AND T1.LineNum = T2.BaseLinNum AND T2.BaseType = {DOC_TYPE}
WHERE T0.DocDate >= '{formattedDate}'
  AND T1.ItemCode IN ({ourItemCodes})
ORDER BY T0.DocDate DESC, T0.DocEntry, T1.LineNum
```

---

### Consumption OCR Extraction with Gemini (2026-01-28)
**Status:** COMPLETE

Google Gemini 2.5 Pro extracts patient/procedure/product data from consumption documents.

**Files Modified:**
- `services/extractionService.js` - Added `extractConsumptionDocument()` using Gemini
- `controllers/consumption.js` - Added `extractFromDocument` endpoint
- `routes/consumption.js` - Added `POST /extract` route

**Key Design:** Constrained matching - only matches against products/lots at the selected Centro.

---

### Movimientos Page (2026-01-28)
**Status:** COMPLETE

Monthly consumption per product per centro (trailing 12 months) with Centro/Category filters.

**Files Created:**
- `client/src/pages/Movimientos.jsx`

**Backend:** `GET /api/analytics/monthly-movements` in `controllers/analytics.js`

---

### Dashboard Consumption Analytics (2026-01-29)
**Status:** COMPLETE

Bar chart visualization on Dashboard using `recharts` library.

**Files Created:**
- `client/src/components/DashboardConsumptionCharts.jsx`

**Backend:** `GET /api/analytics/dashboard-consumption` in `controllers/analytics.js`

**Features:** 3 summary cards + total bar chart + individual bar chart per centro (2-column grid).

---

### Analytics Consistency Fix (2026-01-30)
**Status:** COMPLETE

All consumption analytics endpoints switched from `Transacciones` to `Consumos` collection.

**Endpoints Fixed:** `getMonthlyConsumption`, `getConsumptionByLocation`, `getConsumptionTrends`, `getConsumptionBySize`, `getPlanningData` (consumption portion).

**Pattern:** `{ $unwind: '$items' }` then group by `items.productId` / `items.quantity`.

**Rationale:** `Consumos` has all historical data. `Transacciones` only for CONSIGNMENT outflow and audit log.

---

### Consumption Transaction Records (2026-01-28)
**Status:** COMPLETE

Consumption controller now writes CONSUMPTION entries to `transacciones` audit log, completing the pattern (goods receipts and consignments already wrote to it).

**File Modified:** `controllers/consumption.js`

---
