# External SAP Document Import Feature

**Created:** 2026-01-14
**Status:** IMPLEMENTED

## Overview

When users make inventory movements directly in SAP (bypassing our app), the reconciliation system detects these as "external documents". This feature allows importing those movements into our local database to maintain sync.

---

## How to Use

### Step 1: Access the Reconciliation Dashboard

Navigate to `/reconciliation` in the app (under Admin menu).

### Step 2: Run a Reconciliation Check

Click **"Verificar Ahora"** to scan SAP for external documents. You can also use **"Rango Personalizado"** to check a specific date range.

### Step 3: Review External Documents

Documents created directly in SAP will appear in the "Documentos Externos" list with status **"Pendiente"**.

### Step 4: Import a Document

1. Click the **"Importar"** button on any pending document
2. The system validates the document:
   - **Green banner**: Ready to import - all products and locations exist
   - **Red banner**: Cannot import - shows what's missing
   - **Yellow banner**: Dependencies found - import other documents first
3. Review the preview showing:
   - Lotes to create (new batches)
   - Lotes to update (quantity changes)
4. Click **"Importar"** to confirm

### Step 5: Handle Dependencies

If you see a dependency warning:
- The document needs another document imported first (e.g., a transfer needs the goods receipt that created the batch)
- Click **"Importar primero"** on the dependency to import it
- Then return to import the original document

### Alternative Actions

If you don't want to import a document:
- **Reconocer**: Mark as reviewed but don't import (for documents you acknowledge but don't need locally)
- **Ignorar**: Mark as not relevant (for test documents or documents that don't affect your inventory)

---

## Files Implemented

| File | Purpose |
|------|---------|
| `server/services/externalImportService.js` | Core validation and import logic |
| `server/controllers/reconciliation.js` | API endpoints (validate, import) |
| `server/routes/reconciliation.js` | Route definitions |
| `client/src/lib/api.js` | Frontend API client methods |
| `client/src/pages/Reconciliation.jsx` | UI with import dialog |

---

## Document Types

| SAP Document | Local Record Created | Description |
|--------------|---------------------|-------------|
| PurchaseDeliveryNote | Lotes + Inventario + GoodsReceipt | Goods receipt from supplier |
| StockTransfer | Update Lote locations + Consignacion | Warehouse to centro transfer |
| DeliveryNote | Reduce inventory + Consumo | Consumption at centro |

## Import Flow

```
User clicks "Importar" on external document
                ↓
┌─────────────────────────────────────────┐
│         VALIDATION PHASE                │
├─────────────────────────────────────────┤
│ 1. Product Validation                   │
│    - All ItemCodes exist in productos?  │
│    - Products have required fields?     │
│                                         │
│ 2. Location Validation                  │
│    - WarehouseCode maps to locacion?    │
│    - BinAbsEntry maps (if applicable)?  │
│                                         │
│ 3. Batch/Inventory Validation           │
│    - For StockTransfer/DeliveryNote:    │
│      * Batch exists in source location? │
│      * Sufficient quantity available?   │
└─────────────────────────────────────────┘
                ↓
           ALL PASS?
          /        \
        YES         NO
         ↓           ↓
    Show Preview   Show Errors
         ↓         (block import)
    User Confirms
         ↓
    Create Records
         ↓
    Mark as IMPORTED
```

## Validation Rules by Document Type

### PurchaseDeliveryNote (Entrada de Mercancía)

**Creates:** New batches - no inventory dependency

| Check | Required | Error Message |
|-------|----------|---------------|
| ItemCode exists in productos | Yes | "Producto {code} no existe en el sistema" |
| Product has sapItemCode | Yes | "Producto no tiene código SAP configurado" |
| WarehouseCode maps to locacion | Yes | "Almacén {code} no está configurado" |
| Locacion is type WAREHOUSE | Yes | "Ubicación {name} no es un almacén" |

### StockTransfer (Traslado de Inventario)

**Requires:** Batch must exist in source location

| Check | Required | Error Message |
|-------|----------|---------------|
| ItemCode exists in productos | Yes | "Producto {code} no existe en el sistema" |
| FromWarehouse maps to locacion | Yes | "Almacén origen {code} no configurado" |
| ToWarehouse maps to locacion | Yes | "Almacén destino {code} no configurado" |
| **Batch exists in FROM location** | Yes | "Lote {batch} no existe en {location}" |
| **Batch has sufficient qty** | Yes | "Lote {batch} solo tiene {n} unidades, se requieren {m}" |

### DeliveryNote (Nota de Entrega / Consumo)

**Requires:** Batch must exist in location with sufficient qty

| Check | Required | Error Message |
|-------|----------|---------------|
| ItemCode exists in productos | Yes | "Producto {code} no existe en el sistema" |
| WarehouseCode maps to locacion | Yes | "Ubicación {code} no está configurada" |
| **Batch exists in location** | Yes | "Lote {batch} no existe en {location}" |
| **Batch has sufficient qty** | Yes | "Lote {batch} solo tiene {n} unidades" |

## Dependency Chain Handling

When a document can't be imported due to missing batch:

1. **Scan pending external documents** for one that would create the missing batch
2. **Show suggestion:** "Este lote podría ser creado por: Doc {X} - Entrada de Mercancía"
3. **Link to related document** so user can import in correct order

### Example Scenario

```
Pending External Documents:
- Doc 5604: PurchaseDeliveryNote - Creates Batch "ABC123" in Warehouse 01
- Doc 5610: StockTransfer - Moves Batch "ABC123" from 01 to 10-CDC

User tries to import Doc 5610 first:
→ Error: "Lote ABC123 no existe en Almacén 01"
→ Suggestion: "Importar primero: Doc 5604 (Entrada de Mercancía)"
→ Button: [Importar Doc 5604]
```

## UI States

| State | Color | Condition | Actions Available |
|-------|-------|-----------|-------------------|
| Puede Importar | Green | All validations pass | [Importar] [Ignorar] |
| No Puede Importar | Red | Missing products/locations/batches | [Ver Errores] [Ignorar] |
| Dependencia | Yellow | Missing batch but found source doc | [Importar Dependencia] [Ignorar] |

## API Endpoints

### POST /api/reconciliation/external-documents/:id/validate

Validates if document can be imported.

**Response:**
```json
{
  "canImport": false,
  "errors": [
    {
      "type": "MISSING_BATCH",
      "message": "Lote ABC123 no existe en Almacén 01",
      "details": { "batch": "ABC123", "location": "01" }
    }
  ],
  "dependencies": [
    {
      "docId": "...",
      "sapDocNum": 5604,
      "sapDocType": "PurchaseDeliveryNote",
      "message": "Este documento crearía el lote faltante"
    }
  ],
  "preview": {
    "lotesToCreate": [...],
    "lotesToUpdate": [...],
    "inventoryChanges": [...]
  }
}
```

### POST /api/reconciliation/external-documents/:id/import

Imports the document after validation passes.

**Response:**
```json
{
  "success": true,
  "created": {
    "lotes": 2,
    "inventario": 2,
    "goodsReceipt": 1
  },
  "message": "Documento importado exitosamente"
}
```

## Data Mapping

### SAP to Local Location Mapping

```javascript
// Query locaciones collection
const location = await Locaciones.findOne({
  $or: [
    { 'sapIntegration.warehouseCode': sapWarehouseCode },
    { 'sapIntegration.binAbsEntry': sapBinAbsEntry }
  ]
});
```

### SAP to Local Product Mapping

```javascript
// Query productos collection
const product = await Productos.findOne({
  sapItemCode: sapItemCode,
  active: true
});
```

## Implementation Order

1. **Phase 1: Validation Endpoint**
   - Create `/validate` endpoint
   - Implement all validation checks
   - Return detailed errors and preview

2. **Phase 2: Import for PurchaseDeliveryNote**
   - Easiest - creates new batches, no dependencies
   - Create lotes, update inventario, create goodsReceipt record

3. **Phase 3: Import for StockTransfer**
   - Update lote locations
   - Create consignacion record
   - Requires batch existence validation

4. **Phase 4: Import for DeliveryNote**
   - Reduce batch quantities
   - Create consumo record
   - Requires batch existence and quantity validation

5. **Phase 5: Dependency Detection**
   - Scan pending documents for related batches
   - Show suggestions in UI

## Edge Cases

1. **Batch already exists locally** (from previous import or sync)
   - For PurchaseDeliveryNote: Add to existing batch quantity
   - Show warning: "Este lote ya existe, se sumará la cantidad"

2. **Partial product match** (some items exist, some don't)
   - Block entire import
   - Show all missing products
   - Don't allow partial imports

3. **Location mapping ambiguity** (multiple matches)
   - Should not happen with proper setup
   - If it does, require manual selection

4. **Document already imported**
   - Check status before allowing import
   - Show error if IMPORTED status

## Document Origin Tracking

**Problem:** Once imported, Consignacion/GoodsReceipt/Consumo records look identical to documents created in the app. Users need to distinguish:
- Documents created in app → pushed to SAP
- Documents created in SAP → imported to app

**Solution:** Add origin tracking fields to document schemas:

| Field | Type | Description |
|-------|------|-------------|
| `origin` | `'APP' \| 'SAP_IMPORT'` | Where the document was created |
| `importedFromId` | `ObjectId` | Reference to ExternalSapDocument (if imported) |

### Schema Changes

```javascript
// Add to Consignacion, GoodsReceipt, Consumo schemas:
origin: {
  type: String,
  enum: ['APP', 'SAP_IMPORT'],
  default: 'APP'
},
importedFromId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'ExternalSapDocument'
}
```

### UI Display

- Documents with `origin: 'SAP_IMPORT'` show a badge: **"Importado SAP"**
- Can filter by origin in list views
- Click badge to see import details (detected date, imported by, etc.)

### Files to Update

| File | Change |
|------|--------|
| `models/consignacionModel.js` | Add origin + importedFromId fields |
| `models/goodsReceiptModel.js` | Add origin + importedFromId fields |
| `models/consumoModel.js` | Add origin + importedFromId fields |
| `services/externalImportService.js` | Set origin='SAP_IMPORT' and importedFromId when importing |

---

## Testing Checklist

- [ ] Import PurchaseDeliveryNote with new batch
- [ ] Import PurchaseDeliveryNote with existing batch (adds qty)
- [ ] Import StockTransfer with existing batch
- [ ] Import StockTransfer with missing batch (should fail)
- [ ] Import DeliveryNote with existing batch
- [ ] Import DeliveryNote with insufficient qty (should fail)
- [ ] Dependency detection works
- [ ] Cannot import same document twice
- [ ] Imported documents show origin='SAP_IMPORT'
- [ ] importedFromId links back to ExternalSapDocument
