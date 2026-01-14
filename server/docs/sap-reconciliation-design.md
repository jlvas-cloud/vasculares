# SAP Reconciliation System Design

**Created:** 2026-01-13
**Status:** FULLY IMPLEMENTED (2026-01-13)
**Updated:** 2026-01-13 (Moving Date Window)

---

## Problem Statement

Our app syncs TO SAP (one-way push), but users can make movements directly in SAP that bypass our app. This creates drift between our local database and SAP's reality.

**Risk:** If someone consumes stock directly in SAP, our app doesn't know. We might try to consume the same stock again, causing errors or negative inventory.

---

## Solution Overview

Two complementary mechanisms:

| Mechanism | Purpose | When |
|-----------|---------|------|
| **Pre-Operation Guard** | Prevent bad transactions | Real-time, before each movement |
| **Document Reconciliation** | Audit/visibility | Nightly + on-demand |

---

## 1. Pre-Operation Guard (Real-Time Protection)

### Concept

Before any stock movement, verify with SAP that the batch/quantity exists at the source location.

```
User clicks "Crear Consignación"
       ↓
App queries SAP: "Does batch X exist at warehouse with qty >= requested?"
       ↓
   ┌───┴───┐
   │       │
  YES      NO
   │       │
   ↓       ↓
Proceed   Block + Show Warning
```

### Operations to Guard

#### Consignment (Stock Transfer: Warehouse → Centro)

**Check:** Query SAP OIBT/OBBQ for batch stock at source warehouse

```javascript
// Pseudo-code
async function verifyStockForConsignment(items, sourceWarehouse) {
  for (const item of items) {
    const sapStock = await getSapBatchStock(item.lotNumber, sourceWarehouse);
    if (sapStock < item.quantity) {
      return {
        valid: false,
        error: `Lote ${item.lotNumber}: SAP muestra ${sapStock} unidades, pero intentas transferir ${item.quantity}`
      };
    }
  }
  return { valid: true };
}
```

**On failure:**
- Block the consignment creation
- Show message: "SAP muestra stock insuficiente para este lote"
- User must investigate before proceeding

#### Consumption (Delivery: Centro → Patient)

**Check:** Query SAP OIBT/OBBQ for batch stock at centro location

```javascript
// Pseudo-code
async function verifyStockForConsumption(items, centroLocation) {
  for (const item of items) {
    const sapStock = await getSapBatchStock(item.lotNumber, centroLocation);
    if (sapStock < item.quantity) {
      return {
        valid: false,
        error: `Lote ${item.lotNumber}: SAP muestra ${sapStock} unidades en este centro`
      };
    }
  }
  return { valid: true };
}
```

**On failure:**
- Block the consumption creation
- Show message with SAP's actual quantity
- User must investigate

#### Goods Receipt (Purchase Delivery)

**Already covered** by batch validation (validates batch-product relationship).

No additional stock check needed since we're ADDING stock, not removing.

---

## 2. Document Reconciliation (Audit/Visibility)

### Concept

Periodically check SAP for documents that involve our products but weren't created by our app.

### Frequency

| Trigger | When |
|---------|------|
| **Nightly job** | Once per night (2:00 AM, configurable via `RECONCILIATION_CRON`) |
| **On-demand** | Admin clicks "Verificar Ahora" button in dashboard |

### Moving Date Window

Instead of a fixed lookback period (e.g., "last 24 hours"), reconciliation uses a smart moving window:

| Scenario | Date Range |
|----------|------------|
| **First run** | From `goLiveDate` (set automatically during initial sync) to now |
| **Subsequent runs** | From last successful run's `completedAt` to now |
| **Custom range** | User-specified `fromDate` and `toDate` via dashboard |

**Why this approach:**
- Prevents flagging old SAP documents as "external" after initial setup
- Ensures no gaps in coverage (each run starts where the last one ended)
- Allows admins to re-check specific date ranges if needed

**goLiveDate is set automatically** by `sync-inventory-from-sap.js` on first successful sync. Can also be set manually via admin dashboard.

### Documents to Check

| SAP Document | Our Equivalent | SAP Endpoint |
|--------------|----------------|--------------|
| PurchaseDeliveryNotes | GoodsReceipt | `/PurchaseDeliveryNotes` |
| StockTransfers | Consignacion | `/StockTransfers` |
| DeliveryNotes | Consumo | `/DeliveryNotes` |

### Detection Logic

```javascript
// Pseudo-code
async function findExternalDocuments(since) {
  const externalDocs = [];

  // Get our tracked item codes
  const ourItemCodes = await Product.distinct('sapItemCode', { sapItemCode: { $exists: true } });

  // Query SAP for recent documents
  const sapDocs = await querySapDocumentsSince(since);

  for (const sapDoc of sapDocs) {
    // Check if document involves our products
    const involvesOurProducts = sapDoc.items.some(item =>
      ourItemCodes.includes(item.ItemCode)
    );

    if (!involvesOurProducts) continue;

    // Check if we created this document
    const weCreatedIt = await localDocumentExists(sapDoc.DocEntry, sapDoc.type);

    if (!weCreatedIt) {
      externalDocs.push({
        sapDocEntry: sapDoc.DocEntry,
        sapDocType: sapDoc.type,
        createdAt: sapDoc.DocDate,
        items: sapDoc.items.filter(i => ourItemCodes.includes(i.ItemCode))
      });
    }
  }

  return externalDocs;
}
```

### Data Model: ExternalSapDocument

```javascript
const externalSapDocumentSchema = new mongoose.Schema({
  // SAP reference
  sapDocEntry: { type: Number, required: true },
  sapDocType: {
    type: String,
    enum: ['PurchaseDeliveryNote', 'StockTransfer', 'DeliveryNote'],
    required: true
  },
  sapDocDate: { type: Date, required: true },

  // What was affected
  items: [{
    sapItemCode: String,
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
    productName: String,
    batchNumber: String,
    quantity: Number,
    warehouseCode: String
  }],

  // Detection info
  detectedAt: { type: Date, default: Date.now },
  detectedBy: { type: String, enum: ['NIGHTLY_JOB', 'ON_DEMAND'], required: true },

  // Resolution
  status: {
    type: String,
    enum: ['PENDING_REVIEW', 'ACKNOWLEDGED', 'IMPORTED', 'IGNORED'],
    default: 'PENDING_REVIEW'
  },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  reviewedAt: Date,
  notes: String,

  // Company
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// Index for efficient queries
externalSapDocumentSchema.index({ sapDocEntry: 1, sapDocType: 1 }, { unique: true });
externalSapDocumentSchema.index({ status: 1, companyId: 1 });
externalSapDocumentSchema.index({ detectedAt: -1 });
```

### Data Model: ReconciliationRun

Track when reconciliation was last run:

```javascript
const reconciliationRunSchema = new mongoose.Schema({
  runType: { type: String, enum: ['NIGHTLY', 'ON_DEMAND'], required: true },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'RUNNING' },

  // Configuration used for this run (Moving Date Window)
  config: {
    fromDate: Date,                    // Start of date range checked
    toDate: Date,                      // End of date range checked
    dateSource: {                      // How fromDate was determined
      type: String,
      enum: ['LAST_RUN', 'GO_LIVE_DATE', 'CUSTOM_RANGE', 'NONE']
    },
    documentTypes: [String]            // Which document types were checked
  },

  // Results
  stats: {
    purchaseDeliveryNotesChecked: Number,
    stockTransfersChecked: Number,
    deliveryNotesChecked: Number,
    totalDocumentsChecked: Number,
    externalDocsFound: Number
  },
  errors: [{ timestamp: Date, phase: String, message: String, details: Mixed }],

  // Who triggered (for on-demand)
  triggeredBy: { _id: ObjectId, firstname: String, lastname: String, email: String },

  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });
```

### Data Model: VascularesConfig

Per-company configuration for reconciliation (goLiveDate):

```javascript
const vascularesConfigSchema = new mongoose.Schema({
  reconciliation: {
    goLiveDate: { type: Date, default: null },
    goLiveDateSetBy: {
      type: { type: String, enum: ['SYNC_SCRIPT', 'MANUAL'] },
      user: { _id: ObjectId, firstname: String, lastname: String },
      setAt: Date
    }
  },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true }
}, { timestamps: true });
```

---

## 3. User Interface

### Pre-Operation Guard UI

When stock verification fails:

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  Stock Insuficiente en SAP                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  El stock en SAP no coincide con nuestros registros:    │
│                                                         │
│  Lote: ABC123                                           │
│  Producto: Stent Coronario 3.0/18                       │
│  Ubicación: Centro Médico ABC                           │
│                                                         │
│  Stock en nuestra app:  5 unidades                      │
│  Stock en SAP:          0 unidades                      │
│                                                         │
│  Esto puede indicar que alguien movió este stock        │
│  directamente en SAP.                                   │
│                                                         │
│  [Cancelar]                        [Verificar SAP]      │
└─────────────────────────────────────────────────────────┘
```

### Reconciliation Dashboard

Admin section showing:

1. **Last reconciliation run** - timestamp, results
2. **Pending external documents** - list to review
3. **On-demand button** - "Verificar Documentos SAP"

```
┌─────────────────────────────────────────────────────────┐
│  Reconciliación SAP                                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Última verificación: 2026-01-13 02:00 AM               │
│  Documentos externos encontrados: 2                     │
│                                                         │
│  [Verificar Ahora]                                      │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Documentos Externos Pendientes                         │
├─────────────────────────────────────────────────────────┤
│  📄 StockTransfer #1234 - 2026-01-12                    │
│     → Stent 3.0/18 (2 uds) Almacén → Centro ABC         │
│     [Ver Detalles] [Reconocer] [Importar]               │
│                                                         │
│  📄 DeliveryNote #5678 - 2026-01-12                     │
│     → Stent 2.5/15 (1 ud) Centro XYZ → Paciente         │
│     [Ver Detalles] [Reconocer] [Importar]               │
└─────────────────────────────────────────────────────────┘
```

### Actions on External Documents

| Action | Effect |
|--------|--------|
| **Reconocer** | Mark as acknowledged, don't import. Updates status only. |
| **Importar** | Create local record (Consignacion/Consumo) to match SAP. Adjusts local inventory. |
| **Ignorar** | Mark as ignored (e.g., test data, doesn't affect our products) |

---

## 4. Implementation Status

**All phases completed 2026-01-13.**

| Phase | Feature | Status | Files |
|-------|---------|--------|-------|
| **1** | Pre-op guard for Consignment | ✅ COMPLETE | `sapService.js`, `controllers/consignaciones.js`, `Planning.jsx` |
| **2** | Pre-op guard for Consumption | ✅ COMPLETE | `sapService.js`, `controllers/consumption.js`, `Consumption.jsx` |
| **3** | Document reconciliation service | ✅ COMPLETE | `services/reconciliationService.js` |
| **4** | ExternalSapDocument model | ✅ COMPLETE | `models/externalSapDocumentModel.js` |
| **5** | ReconciliationRun model | ✅ COMPLETE | `models/reconciliationRunModel.js` |
| **6** | VascularesConfig model | ✅ COMPLETE | `models/vascularesConfigModel.js` |
| **7** | Nightly job (cron) | ✅ COMPLETE | `jobs/nightlyReconciliation.js` |
| **8** | API endpoints | ✅ COMPLETE | `controllers/reconciliation.js`, `routes/reconciliation.js` |
| **9** | Admin dashboard UI | ✅ COMPLETE | `pages/Reconciliation.jsx` |
| **10** | Moving date window | ✅ COMPLETE | `reconciliationService.js`, `sync-inventory-from-sap.js` |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/reconciliation/run` | Trigger on-demand reconciliation (accepts `fromDate`, `toDate`) |
| GET | `/api/reconciliation/status` | Get latest run + pending document count |
| GET | `/api/reconciliation/runs` | Get run history |
| GET | `/api/reconciliation/external-documents` | Get external documents (filterable by `status`) |
| PUT | `/api/reconciliation/external-documents/:id/status` | Update document status (acknowledge, ignore) |
| GET | `/api/reconciliation/config` | Get goLiveDate configuration |
| PUT | `/api/reconciliation/config/go-live-date` | Manually set goLiveDate |

---

## 5. SAP Queries Reference

### Check Batch Stock at Location

For warehouses without bins (e.g., Warehouse 01):
```
SQLQueries: SELECT * FROM OIBT WHERE ItemCode = '{itemCode}' AND WhsCode = '{whsCode}' AND BatchNum = '{batchNum}'
```

For warehouses with bins (e.g., Warehouse 10):
```
SQLQueries: SELECT * FROM OBBQ WHERE ItemCode = '{itemCode}' AND BinAbs = {binAbs} AND SnBMDAbs IN (SELECT AbsEntry FROM OBTN WHERE DistNumber = '{batchNum}')
```

### Query Documents by Date Range

The system uses the moving date window (see above) to determine the date range.

PurchaseDeliveryNotes:
```
/PurchaseDeliveryNotes?$filter=DocDate ge datetime'{fromDate}' and DocDate le datetime'{toDate}'
```

StockTransfers:
```
/StockTransfers?$filter=DocDate ge datetime'{fromDate}' and DocDate le datetime'{toDate}'
```

DeliveryNotes:
```
/DeliveryNotes?$filter=DocDate ge datetime'{fromDate}' and DocDate le datetime'{toDate}'
```

**Pagination:** SAP returns paginated results. The `fetchAllPages()` helper follows `odata.nextLink` to get all documents (default page size: 20).

---

## 6. Error Handling

### Pre-Op Guard Failures

If SAP is unreachable during pre-op check:
- **Option A (Strict):** Block operation, show "Cannot verify with SAP"
- **Option B (Lenient):** Warn user, allow to proceed with confirmation

**Recommendation:** Start with Option A (strict). Can relax later if needed.

### Reconciliation Job Failures

- Log error
- Mark run as FAILED
- Alert admin (dashboard notification)
- Don't block app operations

---

## 7. Future Considerations

- **Email alerts** for external documents
- **Auto-import** option for certain document types
- **Quantity reconciliation** (compare totals, not just documents)
- **Webhook from SAP** (if SAP partner can implement)
