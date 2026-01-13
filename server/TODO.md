# Known Issues & Future Improvements

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

## SAP Batch Validation (High Priority)

**Issue discovered:** 2026-01-12

**Problem:**
When creating lots locally (via packing list OCR or manual entry), there's no validation against SAP to verify the batch-item relationship. This can cause:
- Local lot linked to wrong product (e.g., batch `06251742` linked to item `419102` locally, but SAP has it as `419123`)
- Stock transfers fail with "No matching records found (ODBC -2028)"
- Data divergence between our system and SAP

**Root cause:**
Lots can be created without a formal goods receipt that syncs to SAP. The batch number exists in SAP with one ItemCode, but our system links it to a different product.

**Proposed solution:**
Before creating a lot with a batch number, query SAP:
```
GET /BatchNumberDetails?$filter=Batch eq '{batchNumber}'
```
If SAP returns an ItemCode, validate it matches our product's `sapItemCode`. If not, either:
1. Reject the creation with an error
2. Auto-correct to the SAP-linked product
3. Warn the user about the mismatch

**Affected flows:**
- Goods Receipt (packing list extraction)
- Manual lot creation
- Any flow that creates lots without SAP sync
