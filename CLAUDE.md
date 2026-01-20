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
│   │   ├── userProfileModel.js       # User roles + SAP credentials
│   │   ├── externalSapDocumentModel.js  # External SAP docs (reconciliation)
│   │   └── reconciliationRunModel.js    # Reconciliation run history
│   ├── controllers/            # Business logic
│   │   ├── userProfiles.js     # User/role management API
│   │   └── reconciliation.js   # Reconciliation API
│   ├── middleware/             # Express middleware
│   │   └── permissions.js      # Role-based access control
│   ├── services/               # SAP integration
│   │   ├── sapService.js       # Core SAP API calls + per-user sessions
│   │   ├── sapSyncService.js   # Inventory sync from SAP
│   │   ├── encryptionService.js # AES-256-GCM for SAP credentials
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
        │   ├── Settings.jsx    # User SAP credentials config
        │   ├── UserManagement.jsx # Admin user/role management
        │   └── Reconciliation.jsx # Admin reconciliation dashboard
        ├── components/         # UI components
        ├── context/AuthContext.jsx # Auth + profile + permissions
        └── lib/api.js          # API client (includes userProfilesApi)
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
| `pedidos` | Supplier order tracking | orderDate, status, items (internal only, not SAP) |
| `userprofiles` | User roles + SAP credentials | userId, role, sapCredentials (encrypted) |
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
- `testUserCredentials()` - Verify user's SAP credentials
- `loginAsUser()` - Create per-user SAP session
- `ensureUserSession()` - Get or create cached user session

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

## Recent Completed Work (2026-01-12 to 2026-01-16)

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

8. **External Document Import** (2026-01-14)
   - Import external SAP documents into local database
   - Validation before import (products, locations, batches)
   - Dependency detection (import prerequisites first)
   - Preview of changes before confirming
   - Support for: PurchaseDeliveryNote, StockTransfer, DeliveryNote
   - See `server/docs/external-document-import.md`

9. **Supplier Order Tracking (Pedidos)** (2026-01-15)
   - Track orders placed to supplier before GoodsReceipt arrives
   - Fixed suggestedOrder formula (centro stock not fungible)
   - GoodsReceipt → Pedido linking with auto-suggest
   - New `/pedidos` page for order management
   - Planning page integration with "Ordenar" button
   - See `server/docs/pedidos-design.md`

10. **Per-User SAP Authentication & Roles** (2026-01-16)
    - Users must configure their own SAP credentials (no service account fallback)
    - AES-256-GCM encrypted credential storage
    - Per-user SAP session management with caching
    - Role-based access control:
      | Role | Permissions | Requires SAP |
      |------|-------------|--------------|
      | admin | All operations + user management | Yes |
      | almacen | Recepciones, consignaciones, consumos | Yes |
      | sales | View inventory, edit target stock | No |
      | viewer | Read-only inventory access | No |
    - `/settings` page for SAP credential management
    - `/users` page for admin user/role management
    - Permission-based navigation visibility

## Environment Variables

```env
# Required
MONGODB_URI=mongodb+srv://.../<DATABASE_NAME>
COMPANY_ID=613a3e44b934a2e264187048              # Multi-tenant company ID
SAP_CREDENTIALS_KEY=<64-hex-chars>               # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# SAP Connection (service account - used for queries, not document creation)
SAP_B1_SERVICE_URL=https://94.74.64.47:50000/b1s/v1
SAP_B1_COMPANY_DB=HOSPAL_ENERO
SAP_B1_USERNAME=manager
SAP_B1_PASSWORD=...

# Optional
DEBUG_SAP=false
RECONCILIATION_CRON=0 2 * * *                    # Default: 2 AM daily
ENABLE_CRON_JOBS=true                            # Set to false to disable nightly job
```

**Note:** Document creation (GoodsReceipts, Consignments, Consumptions) uses per-user SAP credentials configured in `/settings`. The service account is only used for read queries.

## Documentation

- `server/ONBOARDING.md` - Complete setup guide
- `server/TODO.md` - Known issues and recent work
- `server/ISSUES.md` - SAP bug tracking (18 issues resolved)
- `server/docs/sap-sqlqueries-setup.md` - SAP SQLQueries configuration for inventory sync
- `server/docs/sap-sqltable-allowlist.md` - **SAP tables needed in b1s_sqltable.conf (for production setup)**
- `server/docs/sap-reconciliation-design.md` - SAP reconciliation system design (IMPLEMENTED)
- `server/docs/external-document-import.md` - External SAP document import feature (IMPLEMENTED)
- `server/docs/pedidos-design.md` - Supplier order tracking design (IMPLEMENTED)
- `server/docs/exportar-inventario-sap.md` - Manual CSV export from SAP (fallback)
- `server/docs/PLAN.md` - Active planning document (feature tracking, backlog)

## Running the App

```bash
# Backend (from server/)
npm run dev          # Starts on port 5000

# Frontend (from client/)
npm run dev          # Starts on port 5173 (Vite)

# Build frontend
npm run build        # Output in client/dist/
```

## Heroku Deployment

**App URL:** https://vasculares-app-b24f028bcdfd.herokuapp.com/

**Deploy:**
```bash
git push heroku main
```

**View logs:**
```bash
heroku logs --tail --app vasculares-app
```

**Heroku Config Notes:**
- `NPM_CONFIG_PRODUCTION=false` - Required so devDependencies (vite, tailwind) are installed during build
  - Heroku prunes devDependencies AFTER build, so final slug stays lean
  - Without this, `vite build` fails because vite is a devDependency
- Static files served from `path.join(__dirname, '..', 'client', 'dist')` - absolute path required on Heroku
- **CORS fix:** Static files served BEFORE CORS middleware in app.js, so CSS/JS assets bypass CORS checks
- All env vars configured via `heroku config:set`

## Frontend Pages

| Route | Page | Permission |
|-------|------|------------|
| `/` | Dashboard | All |
| `/goods-receipt` | Nueva Recepción | goodsReceipts |
| `/goods-receipt-history` | Historial Recepciones | goodsReceipts |
| `/pedidos` | Pedidos a Proveedor | pedidos |
| `/planning` | Planificación | viewInventory |
| `/consignaciones` | Envíos a Centros | consignments |
| `/consumption` | Registrar Consumo | consignments |
| `/consumption/history` | Historial Consumos | consignments |
| `/inventory` | Inventario | viewInventory |
| `/products` | Productos | viewInventory |
| `/locations` | Locaciones | viewInventory |
| `/transactions` | Transacciones | viewInventory |
| `/reconciliation` | Reconciliación SAP | admin |
| `/settings` | Configuración SAP | All |
| `/users` | Gestión Usuarios | manageUsers |

## Current State

- **Products:** 92 total
  - 84 STENTS_CORONARIOS (Orsiro Mission 419xxx + Legacy Orsiro 364xxx/391xxx)
  - 8 STENTS_RECUBIERTOS (Papyrus 369xxx/381xxx)
- **Locations:** 6 configured (1 warehouse + 5 centros)
- **SAP Integration:** Working (tested with real SAP)
- **User Management:** Implemented with role-based access
- **Admin User:** jlvasquezb@hospalmedica.com (Jose Luis Vasquez)
- **Status:** Deployed to Heroku, testing per-user SAP auth
- **Heroku App:** vasculares-app (https://vasculares-app-b24f028bcdfd.herokuapp.com/)

## Next Steps

1. Test per-user SAP authentication end-to-end
2. Configure SAP credentials in `/settings`
3. Test role-based access (create almacen/sales/viewer users)
4. Run full workflow test with real SAP
5. Clear test data and go live
