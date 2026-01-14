# Vasculares - Project Context for Claude

## Overview

Medical device inventory management system for vascular products (coronary stents, guidewires). Integrates with SAP Business One Service Layer for document synchronization.

**Tech Stack:**
- Backend: Node.js + Express + MongoDB (Mongoose)
- Frontend: React + Vite + TailwindCSS + shadcn/ui
- SAP Integration: SAP B1 Service Layer REST API

## Project Structure

```
vasculares/
├── server/                     # Backend
│   ├── models/                 # Mongoose schemas
│   │   ├── externalSapDocumentModel.js  # External SAP docs (reconciliation)
│   │   └── reconciliationRunModel.js    # Reconciliation run history
│   ├── controllers/            # Business logic
│   │   └── reconciliation.js   # Reconciliation API
│   ├── services/               # SAP integration
│   │   ├── sapService.js       # Core SAP API calls
│   │   ├── sapSyncService.js   # Inventory sync from SAP
│   │   ├── reconciliationService.js # Document reconciliation logic
│   │   └── extractionService.js # Claude Vision for packing lists
│   ├── jobs/                   # Scheduled jobs
│   │   └── nightlyReconciliation.js # Nightly SAP document check
│   ├── scripts/                # CLI utilities
│   │   ├── import-orsiro-codes.js    # Import products
│   │   ├── import-centros.js         # Import locations
│   │   ├── sync-inventory-from-sap.js # Pull inventory from SAP
│   │   └── reset-inventory-data.js    # Clear test data
│   ├── ONBOARDING.md           # Step-by-step setup guide
│   ├── TODO.md                 # Known issues & completed work
│   └── ISSUES.md               # SAP bug fixes tracking
│
└── client/                     # Frontend (React)
    └── src/
        ├── pages/              # Main views
        │   └── Reconciliation.jsx # Admin reconciliation dashboard
        ├── components/         # UI components
        └── lib/api.js          # API client (includes reconciliationApi)
```

## Key Data Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `productos` | Product catalog | code, sapItemCode, name, category |
| `locaciones` | Warehouses & Centros | name, type, sapIntegration.warehouseCode |
| `lotes` | Batch/lot records | productId, lotNumber, locationId, quantity (unique constraint) |
| `inventario` | Aggregated stock | productId, locationId, quantities |
| `consignaciones` | Warehouse→Centro transfers | Creates SAP StockTransfers |
| `consumos` | Consumption at centros | Creates SAP DeliveryNotes |
| `goodsReceipts` | Incoming stock | Creates SAP PurchaseDeliveryNotes |
| `externalsapdocuments` | External SAP docs detected | sapDocEntry, sapDocType, status |
| `reconciliationruns` | Reconciliation job history | runType, status, stats |

## SAP Integration

**Warehouse Structure:**
- Warehouse `01`: Main warehouse (Almacén Principal)
- Warehouse `10`: Consignment warehouse with bin locations for each centro
  - Bin `10-CDC` (AbsEntry: 3)
  - Bin `10-CECANOR` (AbsEntry: 4)
  - etc.

**Document Types:**
- `StockTransfers`: Warehouse → Centro movements
- `DeliveryNotes`: Consumption at centro (requires cardCode)
- `PurchaseDeliveryNotes`: Goods receipt from supplier

**Key SAP Service Functions:**
- `createStockTransfer()` - Transfer with batch numbers
- `createDeliveryNote()` - Consumption with UDFs
- `getItemBatches()` - Query batch details
- `getItemInventory()` - Query stock levels
- `verifyBatchStockForTransfer()` - Pre-op guard for consignments
- `getAllBatchStockAtLocation()` - Query batch stock via SQLQueries
- `getRecentPurchaseDeliveryNotes()` - Reconciliation: query goods receipts
- `getRecentStockTransfers()` - Reconciliation: query transfers
- `getRecentDeliveryNotes()` - Reconciliation: query deliveries

## Onboarding Flow

```bash
# 1. Import products (from spreadsheet)
node scripts/import-orsiro-codes.js

# 2. Import locations (hardcoded in script)
node scripts/import-centros.js

# 3. Link CardCode in UI (manual step)

# 4. Sync inventory from SAP
node scripts/sync-inventory-from-sap.js
```

## Testing

```bash
# Reset inventory data (keeps products & locations)
node scripts/reset-inventory-data.js --confirm

# Re-run sync
node scripts/sync-inventory-from-sap.js
```

## Recent Completed Work (2026-01-12, 2026-01-13)

1. **SAP Bug Fixes** - 18 issues fixed (see ISSUES.md)
   - Race condition fixes with optimistic locking
   - Login mutex for concurrent requests
   - OData injection prevention
   - Field standardization across all models

2. **Lote Uniqueness Constraint**
   - Added unique index: (productId, lotNumber, currentLocationId)
   - Prevents duplicate batch records per location

3. **SAP Inventory Sync with SQLQueries** (2026-01-13)
   - Discovered Semantic Layer (sml.svc) is HANA-only
   - Solution: Use SQLQueries endpoint with AllowList
   - SAP partner added OIBT to `b1s_sqltable.conf`
   - Now syncs exact batch-by-bin inventory data
   - See `docs/sap-sqlqueries-setup.md` for full details

4. **Reset Script**
   - `reset-inventory-data.js` - Clears transactional data for testing

5. **Packing List Upload** (pending testing)
   - Claude Vision API extracts data from packing list images
   - Tab UI in GoodsReceipt page

6. **SAP Batch Validation** (2026-01-13)
   - Validates batch-product relationship before goods receipt
   - Blocks creation if batch belongs to different product in SAP
   - Shows correct product code/name for user to fix

7. **SAP Reconciliation System** (2026-01-13)
   - **Pre-Operation Guards:** Validates SAP stock before consignments/consumptions
   - **Document Reconciliation:** Detects external SAP documents (nightly + on-demand)
   - **Moving Date Window:** Uses goLiveDate (set by sync) + last run's completedAt
   - Admin dashboard at `/reconciliation` with custom date range selector
   - Nightly job runs at 2 AM (configurable)
   - See `server/docs/sap-reconciliation-design.md`

## Environment Variables

```env
MONGODB_URI=mongodb+srv://...
SAP_B1_SERVICE_URL=https://94.74.64.47:50000/b1s/v1
SAP_B1_COMPANY_DB=SBO_VASCULARES
SAP_B1_USERNAME=manager
SAP_B1_PASSWORD=...
COMPANY_ID=613a3e44b934a2e264187048
DEBUG_SAP=false

# Reconciliation (optional)
RECONCILIATION_CRON=0 2 * * *        # Default: 2 AM daily
ENABLE_CRON_JOBS=true                # Set to false to disable nightly job
# Note: goLiveDate is set automatically by sync-inventory-from-sap.js
```

## Documentation

- `server/ONBOARDING.md` - Complete setup guide
- `server/TODO.md` - Known issues and recent work
- `server/ISSUES.md` - SAP bug tracking (18 issues resolved)
- `server/docs/sap-sqlqueries-setup.md` - SAP SQLQueries configuration for inventory sync
- `server/docs/sap-reconciliation-design.md` - **SAP reconciliation system design (IMPLEMENTED)**
- `server/docs/exportar-inventario-sap.md` - Manual CSV export from SAP (fallback)
- `server/docs/PLAN.md` - Active planning document (feature tracking, backlog)

## Current State

- **Products:** 92 total
  - 84 STENTS_CORONARIOS (Orsiro Mission 419xxx + Legacy Orsiro 364xxx/391xxx)
  - 8 STENTS_RECUBIERTOS (Papyrus 369xxx/381xxx)
- **Locations:** 6 configured (1 warehouse + 5 centros)
- **SAP Integration:** Working (tested with real SAP)
- **Status:** Pre-production, testing phase
