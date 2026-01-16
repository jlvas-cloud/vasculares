# Vasculares Project - Active Planning Document

**Last Updated:** 2026-01-16 (Per-User SAP Authentication & Roles)

---

## COMPLETED FEATURES

### 1. Packing List Upload Feature - COMPLETE

**Status:** Implementation complete, pending real-world testing

Allows uploading packing list images to extract product data using Claude Vision API.

**Files Created/Modified:**
- `server/services/extractionService.js` - Claude Vision API integration
- `server/middleware/upload.js` - Multer config for file uploads
- `client/src/components/FileUploader.jsx` - Drag & drop component
- `server/controllers/goodsReceipt.js` - Added `extractFromPackingList` endpoint
- `server/routes/goodsReceipt.js` - Added `POST /extract` route
- `client/src/pages/GoodsReceipt.jsx` - Tab UI (Manual | Desde Packing List)
- `client/src/lib/api.js` - Added `goodsReceiptApi.extract()` method

**Remaining:** Test with real packing list images

---

### 2. SAP Integration Bug Fixes - COMPLETE

**Status:** All 18 issues resolved (16 fixed, 2 won't fix)

See `server/ISSUES.md` for full details.

**Key Fixes:**
- Retry race conditions using optimistic locking
- Login mutex to prevent concurrent authentication
- OData injection prevention with sanitizeODataValue()
- Request timeouts (30 seconds)
- MAX_RETRIES=5 limit on all retry functions
- Field standardization: all models now use `sapIntegration` object
- Status enum standardization: PENDING, SYNCED, FAILED, RETRYING

**Won't Fix (documented):**
- #13 TLS Certificate Validation - SAP on internal network
- #17 Connection Pooling - Low volume app

---

### 3. Lote Uniqueness Constraint - COMPLETE

**Status:** Implemented 2026-01-12

**Change:** Added unique compound index to enforce one Lote record per (product, lotNumber, location).

**File Modified:** `server/models/loteModel.js`

```javascript
// Before: { productId: 1, lotNumber: 1 }
// After:  { productId: 1, lotNumber: 1, currentLocationId: 1 }, { unique: true }
```

**Why:**
- System already creates separate lote records per location (warehouse vs centro)
- Unique index enforces this at database level, preventing duplicate records from race conditions
- Multiple shipments of same lot to same location correctly UPDATE the single record's quantity

**Impact:** No code changes needed - all queries already filter by location.

---

## COMPLETED FEATURES (continued)

### 4. One-Step SAP Inventory Sync for Onboarding - COMPLETE

**Status:** IMPLEMENTED - Ready for testing

**Goal:** Pull ALL existing inventory from SAP into the local app during onboarding.

#### Files Created

| File | Purpose |
|------|---------|
| `server/services/sapSyncService.js` | Core sync logic - queries SAP, creates Lotes |
| `server/scripts/sync-inventory-from-sap.js` | CLI script for one-time sync |

#### Usage

```bash
# Dry run (see what would be synced without saving)
node scripts/sync-inventory-from-sap.js --dry-run

# Full sync
node scripts/sync-inventory-from-sap.js

# Sync specific location only
node scripts/sync-inventory-from-sap.js --location "CDC"

# Sync specific product only
node scripts/sync-inventory-from-sap.js --product "419113"

# Verbose output
node scripts/sync-inventory-from-sap.js --verbose
```

#### Prerequisites

1. Products exist with `sapItemCode` (run `import-orsiro-codes.js`)
2. Locations exist with `sapIntegration.warehouseCode` (run `import-centros.js`)
3. SAP credentials in `.env` (SAP_B1_SERVICE_URL, SAP_B1_USERNAME, etc.)

#### How It Works

```
For each Location (warehouse/centro):
  For each Product (with sapItemCode):
    1. Query SAP BatchNumberDetails for batch stock
    2. Filter batches for this location (by warehouseCode/binAbsEntry)
    3. Create/Update Lote records (uses unique constraint)
    4. Update Inventario aggregation
```

#### Onboarding Flow (Complete)

| Step | Script | Status |
|------|--------|--------|
| 1. Import products | `import-orsiro-codes.js` | Ready |
| 2. Import locations | `import-centros.js` | Ready |
| 3. Link cardCode in UI | Manual (select Socio de Negocio) | Ready |
| 4. Sync inventory | `sync-inventory-from-sap.js` | **NEW** |

#### Notes

- The sync queries SAP's BatchNumberDetails endpoint
- Falls back to basic batch query if advanced queries unavailable
- Uses the new unique Lote constraint (productId + lotNumber + locationId)
- Creates historia entries for audit trail
- Updates Inventario aggregation after each product

---

### 5. Reset Script for Testing - COMPLETE

**Status:** Implemented 2026-01-12

Script to clear inventory data while preserving master data (products, locations).

**File:** `server/scripts/reset-inventory-data.js`

```bash
node scripts/reset-inventory-data.js --dry-run   # Preview
node scripts/reset-inventory-data.js --confirm   # Delete
```

**Deletes:** lotes, inventario, consignaciones, consumos, goodsreceipts, transacciones
**Keeps:** productos, locaciones

---

### 6. SAP Batch Validation - COMPLETE

**Status:** Implemented 2026-01-13

Validates batch-product relationship against SAP before creating goods receipts.

**Files Modified:**
- `server/services/sapService.js` - Added `validateBatchItem()`, `validateBatchItems()`
- `server/controllers/goodsReceipt.js` - Added validation endpoint
- `client/src/pages/GoodsReceipt.jsx` - Added mismatch dialog

**Behavior:** Blocks creation if batch belongs to different product in SAP.

---

### 7. SAP Reconciliation System - COMPLETE

**Status:** Implemented 2026-01-13 (with Moving Date Window)

Detects SAP drift (when users make movements directly in SAP that bypass our app).

#### Two-Mechanism Approach

| Mechanism | Purpose | When |
|-----------|---------|------|
| **Pre-Operation Guards** | Prevent bad transactions | Real-time, before each movement |
| **Document Reconciliation** | Audit/visibility | Nightly (2 AM) + on-demand |

#### Pre-Operation Guards

Before any stock movement (consignment or consumption):
1. Queries SAP OIBT/OBBQ for batch stock at source location
2. Verifies quantity is sufficient
3. Blocks operation if mismatch, shows warning dialog

**Files:**
- `server/services/sapService.js` - `verifyBatchStockForTransfer()`, `getAllBatchStockAtLocation()`
- `server/controllers/consignaciones.js` - `validateSapStock`, `previewFifo`
- `server/controllers/consumption.js` - `validateSapStock`
- `client/src/pages/Planning.jsx` - Validation + mismatch dialog
- `client/src/pages/Consumption.jsx` - Validation + mismatch dialog

#### Document Reconciliation

Checks SAP for documents involving our products that weren't created by our app.

**Documents Checked:**
- PurchaseDeliveryNotes (Goods Receipts)
- StockTransfers (Consignments)
- DeliveryNotes (Consumptions)

**Moving Date Window (2026-01-13):**

Instead of a fixed lookback period, reconciliation uses a smart moving window:

| Scenario | Date Range |
|----------|------------|
| First run | From `goLiveDate` (set during sync) to now |
| Subsequent runs | From last successful run's `completedAt` to now |
| Custom range | User-specified `fromDate` and `toDate` |

This prevents flagging old documents as "external" after initial setup.

**Files Created/Modified:**
- `server/models/externalSapDocumentModel.js` - Tracks external documents
- `server/models/reconciliationRunModel.js` - Tracks run history
- `server/models/vascularesConfigModel.js` - **NEW** Stores `goLiveDate` config
- `server/services/reconciliationService.js` - Core logic + `calculateDateWindow()`, `getReconciliationConfig()`, `setGoLiveDate()`
- `server/services/sapService.js` - `getRecentPurchaseDeliveryNotes()`, `getRecentStockTransfers()`, `getRecentDeliveryNotes()`, `fetchAllPages()`
- `server/controllers/reconciliation.js` - API controller
- `server/routes/reconciliation.js` - API routes
- `server/jobs/nightlyReconciliation.js` - Cron job (2 AM daily)
- `server/scripts/sync-inventory-from-sap.js` - **UPDATED** Sets `goLiveDate` on first sync
- `server/getModel.js` - Added `getVascularesConfigModel()`
- `client/src/pages/Reconciliation.jsx` - Admin dashboard with date range selector
- `client/src/lib/api.js` - `reconciliationApi`

**API Endpoints:**
- `POST /api/reconciliation/run` - Trigger on-demand (accepts `fromDate`, `toDate`)
- `GET /api/reconciliation/status` - Latest run + pending count
- `GET /api/reconciliation/runs` - Run history
- `GET /api/reconciliation/external-documents` - External docs list
- `PUT /api/reconciliation/external-documents/:id/status` - Update status
- `GET /api/reconciliation/config` - **NEW** Get goLiveDate config
- `PUT /api/reconciliation/config/go-live-date` - **NEW** Set goLiveDate manually

**Dashboard Features:**
- Status cards (last run, pending count, docs checked, config status)
- "Verificar Ahora" button for on-demand runs
- **"Rango Personalizado" button** for custom date range
- Warning banner when goLiveDate not configured
- External documents list with filtering
- Actions: Acknowledge, Ignore (with notes)
- Run history table with date range info

**Configuration:**
```env
RECONCILIATION_CRON=0 2 * * *          # Schedule (default: 2 AM)
ENABLE_CRON_JOBS=true                  # Set to false to disable
```

**Bug Fixes (2026-01-13):**
1. Fixed SAP response parsing (was accessing `.value` on raw Response)
2. Added pagination support (`fetchAllPages()` follows `odata.nextLink`)
3. Added stale run detection (runs >1 hour auto-marked as FAILED)

---

### 8. External Document Import - COMPLETE

**Status:** Implemented 2026-01-14 (with bin allocation and origin tracking)

Allows importing external SAP documents (detected by reconciliation) into the local database.

**Files Created/Modified:**
- `server/services/externalImportService.js` - Core validation and import logic
- `server/services/sapService.js` - Added `getStockTransferByDocEntry()` for fetching bin allocations
- `server/controllers/reconciliation.js` - Added `validateDocument`, `importDocument` endpoints
- `server/routes/reconciliation.js` - Added validate/import routes
- `server/models/consignacionModel.js` - Added `origin`, `importedFromId` fields
- `server/models/consumoModel.js` - Added `origin`, `importedFromId` fields
- `server/models/goodsReceiptModel.js` - Added `origin`, `importedFromId` fields
- `client/src/lib/api.js` - Added `validateDocument()`, `importDocument()` methods
- `client/src/pages/Reconciliation.jsx` - Added import dialog with validation preview

**API Endpoints:**
- `POST /api/reconciliation/external-documents/:id/validate` - Validate document
- `POST /api/reconciliation/external-documents/:id/import` - Import document

**Features:**
- **Validation before import**: Checks products exist, locations exist, batches exist (for transfers/consumptions)
- **Preview of changes**: Shows lotes to create/update before confirming
- **Dependency detection**: If batch missing, suggests importing the goods receipt first
- **Bin allocation fetching**: Individual document fetch to get `StockTransferLinesBinAllocations` (list queries return empty)
- **Origin tracking**: Imported documents marked with `origin: 'SAP_IMPORT'` and linked via `importedFromId`
- **Location matching priority**: bin → cardCode → warehouse
- **Support for all document types**:
  - PurchaseDeliveryNote → Creates Lotes + GoodsReceipt
  - StockTransfer → Updates Lotes + Creates Consignacion
  - DeliveryNote → Reduces Lotes + Creates Consumo

**Usage:**
1. Go to `/reconciliation` dashboard
2. Run a reconciliation check to detect external documents
3. Click **"Importar"** on any pending document
4. Review validation result (green=ready, red=errors, yellow=dependencies)
5. Click **"Importar"** to confirm

**SAP OData Limitation Discovered:**
- List query (`StockTransfers?$filter=...`) returns `StockTransferLinesBinAllocations: []` (empty)
- Individual fetch (`StockTransfers(56977)`) returns full bin allocation data
- Solution: Fetch individual document during import to get accurate bin locations

**Documentation:** `docs/external-document-import.md`

---

## COMPLETED: Supplier Order Tracking (Pedidos)

**Status:** ✅ All phases complete (2026-01-15)

**Goal:** Track orders placed to supplier before they arrive as GoodsReceipts.

### Problem Statement

Currently, the "Sugerido Ordenar" column in Planning shows what to order, but:
1. No way to record that an order was placed
2. No visibility of "in transit" from supplier
3. Formula bug: assumes centro stock is fungible (can transfer between centros)

### Solution

**New Pedido (Order) model** to track supplier orders internally (not SAP).

**Transit tracking per location:**
| Location | Tránsito Entrante | Tránsito Saliente |
|----------|-------------------|-------------------|
| Almacén Principal | Pedidos (from supplier) | Consignaciones EN_TRANSITO |
| Centros | Consignaciones EN_TRANSITO | N/A |

### Formula Fix (Bug)

**Current (wrong):**
```javascript
suggestedOrder = (warehouseTarget + totalCentroTargets) - (warehouseStock + totalCentroStock)
// Assumes centro stock can move between centros
```

**Correct:**
```javascript
totalCentroDeficit = sum of max(0, centroTarget - centroStock) per centro
suggestedOrder = max(0, totalCentroDeficit + warehouseTarget - warehouseStock - pendingOrders)
```

**Why:** Centro stock is not fungible. CDC surplus cannot help CECANOR deficit.

### Data Model

```javascript
Pedido {
  orderDate: Date,
  expectedArrivalDate: Date,          // Optional
  supplier: String,                   // Optional
  notes: String,
  status: 'PENDIENTE' | 'PARCIAL' | 'COMPLETO' | 'CANCELADO',
  items: [{
    productId: ObjectId,
    quantityOrdered: Number,
    quantityReceived: Number,         // Updated on GoodsReceipt
  }],
  createdBy: ObjectId,
  companyId: ObjectId,
}
```

### Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1.1 | Pedido model + API (CRUD + getPendingByProduct) | ✅ DONE |
| 1.2 | Fix suggestedOrder formula in analytics.js | ✅ DONE (already implemented) |
| 1.3 | GoodsReceipt → Pedido linking (hybrid: auto-suggest, user confirms) | ✅ DONE |
| 2.1 | Planning page: Pedido column + "Ordenar" button | ✅ DONE |
| 3.1 | `/pedidos` page: Order history + management | ✅ DONE |
| 4.1 | GoodsReceipt UI: Pedido linking dialog | ✅ DONE |

### Design Decisions

1. **GoodsReceipt linking:** Hybrid (auto-suggest matches, user confirms)
2. **Partial receipts:** Keep Pedido as PARCIAL until fully received
3. **UI:** Both Planning integration AND separate `/pedidos` page

**Design Doc:** `docs/pedidos-design.md`

---

### 9. Per-User SAP Authentication & Role Management - COMPLETE

**Status:** ✅ Implemented 2026-01-16

**Goal:** Each user must use their own SAP credentials for operations (no service account fallback). Role-based access control for different user types.

#### Problem Statement

1. All SAP operations use a single service account - no audit trail of who made changes
2. No role-based access control - all users have full access
3. SAP licenses require individual user tracking

#### Solution

**Per-user SAP credentials** stored encrypted (AES-256-GCM) with **role-based access control**.

#### Roles & Permissions

| Role | Permissions | Requires SAP |
|------|-------------|--------------|
| admin | pedidos, goodsReceipts, consignments, viewInventory, editTargetStock, manageUsers | Yes |
| almacen | pedidos, goodsReceipts, consignments, viewInventory | Yes |
| sales | viewInventory, editTargetStock | No |
| viewer | viewInventory | No |

#### Implementation

**Backend:**

| File | Purpose |
|------|---------|
| `server/models/userProfileModel.js` | User roles + encrypted SAP credentials schema |
| `server/services/encryptionService.js` | AES-256-GCM encryption for credentials |
| `server/middleware/permissions.js` | Role-based access control middleware |
| `server/controllers/userProfiles.js` | User profile + SAP credential management API |
| `server/routes/userProfiles.js` | API routes with permission checks |
| `server/services/sapService.js` | Per-user SAP session management (loginAsUser, ensureUserSession) |

**Frontend:**

| File | Purpose |
|------|---------|
| `client/src/pages/Settings.jsx` | SAP credential management (save, test, delete) |
| `client/src/pages/UserManagement.jsx` | Admin page for user/role management |
| `client/src/context/AuthContext.jsx` | Extended with profile + permission helpers |
| `client/src/components/Layout.jsx` | Permission-based navigation visibility |
| `client/src/lib/api.js` | Added userProfilesApi |

**API Endpoints:**

```
# Current user
GET    /api/user-profiles/me              # Get my profile
PUT    /api/user-profiles/sap-credentials # Save SAP credentials
POST   /api/user-profiles/sap-credentials/test # Test SAP connection
DELETE /api/user-profiles/sap-credentials # Remove credentials

# Admin only
GET    /api/user-profiles                 # List all profiles
GET    /api/user-profiles/available-users # Users without profiles
POST   /api/user-profiles                 # Create profile
PUT    /api/user-profiles/:id/role        # Change role
PUT    /api/user-profiles/:id/status      # Activate/deactivate
GET    /api/user-profiles/roles           # Get role definitions
```

**UI Pages:**

- `/settings` - User configures their SAP credentials, sees their role
- `/users` - Admin manages users (visible only to admin role)

**Security:**

- SAP passwords encrypted with AES-256-GCM (random IV per encryption)
- Encryption key stored in `SAP_CREDENTIALS_KEY` env var (64 hex chars)
- Credentials never sent to frontend (only `hasPassword: true/false`)
- Per-user SAP sessions cached with 25-min expiry

**Usage:**

1. Admin assigns roles to users via `/users` page
2. Users with admin/almacen role must configure SAP credentials in `/settings`
3. Warning banner shown if role requires SAP but not configured
4. SAP operations use user's credentials, not service account

---

## NEXT STEPS

### Testing Phase
1. ✅ Reset script created and tested
2. ✅ SAP Reconciliation System implemented
3. ✅ Moving date window implemented (goLiveDate + incremental checks)
4. ✅ External document import implemented
5. ✅ Pedidos (supplier order tracking) implemented
6. ✅ Per-user SAP authentication & roles implemented
7. Test end-to-end workflows with per-user SAP credentials
8. Test role-based access control (admin, almacen, sales, viewer)

### Before Production
1. Clear test data with `reset-inventory-data.js --confirm`
2. Run final onboarding steps (see `server/ONBOARDING.md`)
3. Configure first admin user with SAP credentials
4. Test with real SAP data using individual user credentials
5. Verify SAP documents are created correctly (and show correct user in SAP)
6. Run a reconciliation to verify no external documents missed

---

## REFERENCE: Data Model Summary

### Core Models

| Model | Purpose | SAP Integration |
|-------|---------|-----------------|
| `Producto` | Product catalog | `sapItemCode` links to SAP |
| `Locacion` | Warehouses/Centros | `sapIntegration.warehouseCode`, `binAbsEntry` |
| `Lote` | Batch/lot tracking | Created locally, used in SAP documents |
| `Inventario` | Aggregated stock view | Denormalized from Lotes |
| `Consignacion` | Warehouse→Centro transfers | Creates StockTransfers in SAP |
| `Consumo` | Consumption records | Creates DeliveryNotes in SAP |
| `GoodsReceipt` | Incoming stock | Creates PurchaseDeliveryNotes in SAP |
| `Pedido` | Supplier order tracking | **Not synced** - internal tracking only |
| `UserProfile` | User roles + SAP credentials | Per-user SAP sessions |
| `Transaccion` | Movement audit log | Not synced to SAP |

### Reconciliation Models

| Model | Purpose |
|-------|---------|
| `VascularesConfig` | Per-company config (goLiveDate for reconciliation) |
| `ExternalSapDocument` | SAP documents not created by our app |
| `ReconciliationRun` | History of reconciliation job runs |

### SAP Service Capabilities

**Queries:**
- `getItemInventory(itemCode, warehouseCode)` - Stock levels
- `getItemBatches(itemCode)` - Batch details
- `getCustomers(search, limit)` - Business partners

**Document Creation:**
- `createStockTransfer()` - Warehouse→Centro movements
- `createDeliveryNote()` - Consumption/sales

**Per-User Session Management:**
- `testUserCredentials(username, password)` - Verify SAP credentials
- `loginAsUser(userId, username, password)` - Create user session
- `ensureUserSession(userId, username, password)` - Get/create cached session
- `clearUserSession(userId)` - Remove cached session

---

## BACKLOG (Future Considerations)

From ISSUES.md Architectural Improvements:
- A. SAP Document Lookup Before Creation (duplicate prevention)
- ~~B. Reconciliation Process (background job)~~ ✅ DONE (2026-01-13)
- C. Centralized Error Handling
- D. Exponential Backoff for Retries
- E. Error Analytics/Tracking

### Additional Reconciliation Enhancements (Low Priority)
- Email alerts for external documents detected
- ~~Auto-import option for certain document types~~ ✅ Manual import implemented (2026-01-14)
- Quantity reconciliation (compare totals, not just documents)
- Webhook from SAP (if SAP partner can implement)
