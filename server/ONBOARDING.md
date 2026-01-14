# Vasculares - System Onboarding Guide

**Last Updated:** 2026-01-13

This guide walks through setting up the Vasculares inventory system with SAP B1 integration.

---

## Prerequisites

Before starting, ensure you have:

1. **MongoDB** - Connection URI in `.env`
2. **SAP B1 Service Layer** - Access credentials
3. **Node.js 18+** - For running scripts

---

## Environment Setup

Create/verify `.env` file in the server directory:

```bash
# MongoDB
MONGODB_URI=mongodb+srv://...

# SAP B1 Service Layer
SAP_B1_SERVICE_URL=https://94.74.64.47:50000/b1s/v1
SAP_B1_COMPANY_DB=SBO_VASCULARES
SAP_B1_USERNAME=manager
SAP_B1_PASSWORD=your_password

# Optional
COMPANY_ID=613a3e44b934a2e264187048
DEBUG_SAP=false
```

---

## Onboarding Steps

### Step 1: Import Products

Import products from the Orsiro codes spreadsheet:

```bash
cd /Users/jlvas/Documents/vasculares/server

# Preview what will be imported
node scripts/import-orsiro-codes.js --dry-run

# Import products
node scripts/import-orsiro-codes.js
```

**What it does:**
- Reads `scripts/orsiro-codes.xlsx`
- Creates products with `code`, `sapItemCode`, `name`, `specifications`
- Sets category to `STENTS_CORONARIOS`

**Verify:**
```bash
# Check MongoDB for products
mongosh "your-uri" --eval "db.getSiblingDB('613a3e44b934a2e264187048_vasculares').productos.find().limit(5)"
```

---

### Step 2: Import Locations (Centros)

Import warehouse and centro locations:

```bash
# Preview
node scripts/import-centros.js --dry-run

# Import locations
node scripts/import-centros.js
```

**What it does:**
- Creates main warehouse (Almacén Principal) → SAP warehouse "01"
- Creates centros (CDC, CECANOR, INCAE, etc.) → SAP warehouse "10" with bin locations

**Current Locations Configured:**

| Name | Type | SAP Warehouse | SAP Bin |
|------|------|---------------|---------|
| Almacén Principal | WAREHOUSE | 01 | - |
| CDC | CENTRO | 10 | 10-CDC (AbsEntry: 3) |
| CECANOR | CENTRO | 10 | 10-CECANOR (AbsEntry: 4) |
| INCAE | CENTRO | 10 | 10-INCAE (AbsEntry: 37) |
| CENICARDIO | CENTRO | 10 | 10-CENICARDIO (AbsEntry: 38) |
| CERECA | CENTRO | 10 | 10-CERECA (AbsEntry: 40) |

**To add more centros:** Edit `scripts/import-centros.js` and add to the `LOCATIONS` array.

---

### Step 3: Link CardCode (Socio de Negocio)

This step is done **in the app UI**:

1. Start the app: `npm run dev`
2. Go to **Locations** section
3. For each centro, select the **Socio de Negocio** (SAP Customer)
   - Example: CECANOR → C00013
   - Example: CDC → C00017

**Why:** The CardCode is needed when creating DeliveryNotes (consumption records) in SAP.

---

### Step 4: Sync Inventory from SAP

Pull current inventory from SAP B1:

```bash
# Preview what will be synced (recommended first)
node scripts/sync-inventory-from-sap.js --dry-run

# Full sync with details
node scripts/sync-inventory-from-sap.js --verbose

# Or just run the sync
node scripts/sync-inventory-from-sap.js
```

**What it does:**
- Connects to SAP B1 Service Layer
- For each product with `sapItemCode`:
  - Queries `BatchNumberDetails` from SAP
  - Filters by warehouse/bin for each location
  - Creates `Lote` records with quantities and expiry dates
  - Updates `Inventario` aggregation
- **Sets `goLiveDate`** for reconciliation (first sync only)

**Important:** The sync script automatically sets the `goLiveDate` for the reconciliation system. This marks the point from which the system will check for external SAP documents. Documents created before this date are considered "pre-existing" and won't be flagged as external.

**Options:**
```bash
# Sync only specific location
node scripts/sync-inventory-from-sap.js --location "CDC"

# Sync only specific product
node scripts/sync-inventory-from-sap.js --product "419113"
```

---

## Verification

After completing all steps, verify the data:

### Check Products
```javascript
// In MongoDB shell
db.productos.countDocuments({ sapItemCode: { $exists: true } })
// Should return number of imported products
```

### Check Locations
```javascript
db.locaciones.find({}, { name: 1, type: 1, 'sapIntegration.warehouseCode': 1 })
```

### Check Lotes
```javascript
db.lotes.find({}, { lotNumber: 1, quantityAvailable: 1 }).limit(10)
```

### Check Inventario
```javascript
db.inventario.aggregate([
  { $lookup: { from: 'locaciones', localField: 'locationId', foreignField: '_id', as: 'loc' } },
  { $unwind: '$loc' },
  { $group: { _id: '$loc.name', totalQty: { $sum: '$quantityAvailable' } } }
])
```

---

## Troubleshooting

### SAP Connection Failed
```
Error: SAP Login failed: 401
```
- Verify `SAP_B1_USERNAME` and `SAP_B1_PASSWORD` in `.env`
- Check if SAP server is accessible: `curl -k https://94.74.64.47:50000/b1s/v1/`

### No Batches Found
```
Found 0 batches at CDC
```
- The SAP BatchNumberDetails query might need adjustment for your SAP version
- Try with `--verbose` to see detailed output
- Check if products have correct `sapItemCode`

### Duplicate Key Error
```
MongoError: E11000 duplicate key error
```
- The unique index on Lotes prevents duplicates
- This is expected if re-running sync - existing lotes are updated instead

### Products Not Found
```
No products to sync
```
- Run `import-orsiro-codes.js` first
- Verify products have `sapItemCode` field set

---

## Data Model Summary

| Collection | Purpose |
|------------|---------|
| `productos` | Product catalog with SAP item codes |
| `locaciones` | Warehouses and centros with SAP mapping |
| `lotes` | Batch/lot records per product per location |
| `inventario` | Aggregated stock per product per location |
| `transacciones` | Movement audit log |
| `consignaciones` | Warehouse→Centro transfers |
| `consumos` | Consumption records at centros |
| `goodsReceipts` | Incoming stock from suppliers |
| `vascularesconfig` | Per-company config (reconciliation goLiveDate) |
| `externalsapdocuments` | SAP documents not created by our app |
| `reconciliationruns` | History of reconciliation job runs |

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `import-orsiro-codes.js` | Import products from spreadsheet |
| `import-centros.js` | Create locations with SAP mapping |
| `sync-inventory-from-sap.js` | Pull inventory from SAP |
| `reset-inventory-data.js` | Clear inventory data for testing |
| `import-packing-list.js` | Import from packing list JSON |
| `migrate-from-sap-export.js` | Import from SAP CSV export (legacy) |

---

## Testing & Reset

To test the onboarding process multiple times, use the reset script:

```bash
# Preview what will be deleted
node scripts/reset-inventory-data.js --dry-run

# Actually delete the data
node scripts/reset-inventory-data.js --confirm
```

**What gets DELETED:**
- `lotes` - Batch/lot records
- `inventario` - Aggregated stock
- `consignaciones` - Warehouse→Centro transfers
- `consumos` - Consumption records
- `goodsreceipts` - Incoming stock
- `transacciones` - Movement audit log

**What gets KEPT:**
- `productos` - Product catalog (master data)
- `locaciones` - Warehouses and centros (master data)

After reset, run the sync again:
```bash
node scripts/sync-inventory-from-sap.js
```

---

## Next Steps After Onboarding

1. **Start the app:**
   ```bash
   npm run dev
   ```

2. **Verify in UI:**
   - Check Inventory page shows stock
   - Check each centro has correct quantities

3. **Test workflows:**
   - Create a test consignment (warehouse → centro)
   - Record a test consumption at a centro
   - Verify SAP documents are created

4. **Go live:**
   - Clear test data if needed
   - Run final sync from SAP
   - Begin normal operations
