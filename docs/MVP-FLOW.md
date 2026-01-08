# MVP Flow - Lot-Based Inventory Tracking

**Focus:** Core consignment workflow with lot/batch tracking

---

## Data Model Summary

### Collections

1. **productos** - Product catalog (Guías, Stents)
2. **locaciones** - Hospitals and warehouse
3. **lotes** - Individual batches with quantities
4. **inventario** - Aggregated stock per product per location
5. **transacciones** - All movement history

---

## Complete MVP Workflow

### 1. Setup: Create Product Catalog

**Action:** Admin creates product codes

**Input:**
```json
{
  "name": "Orsiro 2.25/13",
  "code": 364475,
  "missionCode": 419107,
  "category": "STENTS_CORONARIOS",
  "specifications": {
    "size": "2.25/13",
    "type": "Regular"
  }
}
```

**Result:**
- Product created in `productos` collection
- Can now receive this product type

**UI:** Products page → Add Product button

---

### 2. Setup: Create Locations

**Action:** Admin creates warehouse and hospitals

**Warehouse:**
```json
{
  "name": "Almacen Central",
  "fullName": "Almacén Central Centralmed",
  "type": "WAREHOUSE"
}
```

**Hospitals:**
```json
{
  "name": "CDC",
  "fullName": "Corazones del Cibao",
  "type": "HOSPITAL",
  "contact": {
    "name": "Contact Person",
    "phone": "809-XXX-XXXX",
    "email": "cdc@hospital.com"
  }
}
```

**Result:**
- Locations created in `locaciones` collection
- Ready to receive/send inventory

**UI:** Locations page → Add Location button

---

### 3. Receive Products at Warehouse

**Action:** Products arrive from supplier

**Scenario:** 50 units of Orsiro 2.25/13 arrive in Batch BATCH-2024-001

**Input:**
```json
{
  "productId": "67xxx", // Orsiro 2.25/13
  "lotNumber": "BATCH-2024-001",
  "quantity": 50,
  "expiryDate": "2026-12-31",
  "supplier": "Boston Scientific",
  "receivedDate": "2025-01-07"
}
```

**What Happens:**

**Step 1:** Create Lote record
```javascript
// lotes collection
{
  productId: "67xxx",
  lotNumber: "BATCH-2024-001",
  expiryDate: "2026-12-31",
  quantityTotal: 50,
  quantityAvailable: 50,
  quantityConsigned: 0,
  quantityConsumed: 0,
  currentLocationId: "warehouseId", // Almacen Central
  status: "ACTIVE",
  receivedDate: "2025-01-07",
  supplier: "Boston Scientific"
}
```

**Step 2:** Create Transaction record
```javascript
// transacciones collection
{
  type: "WAREHOUSE_RECEIPT",
  productId: "67xxx",
  lotId: "loteId",
  lotNumber: "BATCH-2024-001",
  toLocationId: "warehouseId",
  quantity: 50,
  warehouseReceipt: {
    lotNumber: "BATCH-2024-001",
    expiryDate: "2026-12-31",
    supplier: "Boston Scientific"
  },
  transactionDate: "2025-01-07"
}
```

**Step 3:** Update/Create Inventario record
```javascript
// inventario collection
{
  productId: "67xxx",
  locationId: "warehouseId",
  quantityTotal: 50,
  quantityAvailable: 50,
  quantityConsigned: 0,
  quantityConsumed: 0,
  lastReceivedDate: "2025-01-07"
}
```

**UI:**
```
┌─────────────────────────────────────┐
│ Receive Products at Warehouse       │
├─────────────────────────────────────┤
│ Product: [Orsiro 2.25/13      ▼]   │
│ Lot Number: [BATCH-2024-001]        │
│ Quantity: [50]                      │
│ Expiry Date: [2026-12-31]           │
│ Supplier: [Boston Scientific]       │
│                                     │
│ [Cancel]              [Receive]     │
└─────────────────────────────────────┘
```

---

### 4. Send Products on Consignment to Hospital

**Action:** Send 10 units from warehouse to CDC hospital

**Scenario:** CDC needs 10 units of Orsiro 2.25/13 from Batch BATCH-2024-001

**Input:**
```json
{
  "productId": "67xxx",
  "lotId": "loteId",
  "fromLocationId": "warehouseId",
  "toLocationId": "cdcId",
  "quantity": 10
}
```

**What Happens:**

**Step 1:** Update Lote at Warehouse
```javascript
// lotes collection - warehouse lot
{
  lotId: "loteId",
  quantityAvailable: 40,      // 50 - 10
  quantityConsigned: 10,       // 0 + 10
  currentLocationId: "warehouseId" // stays at warehouse
}
```

**Step 2:** Create New Lote at Hospital (or update if exists)
```javascript
// lotes collection - hospital lot
{
  productId: "67xxx",
  lotNumber: "BATCH-2024-001",
  expiryDate: "2026-12-31",
  quantityTotal: 10,
  quantityAvailable: 10,
  quantityConsigned: 10,       // All 10 are on consignment
  quantityConsumed: 0,
  currentLocationId: "cdcId",  // CDC hospital
  status: "ACTIVE"
}
```

**Step 3:** Create Transaction
```javascript
// transacciones collection
{
  type: "CONSIGNMENT_OUT",
  productId: "67xxx",
  lotId: "loteId",
  lotNumber: "BATCH-2024-001",
  fromLocationId: "warehouseId",
  toLocationId: "cdcId",
  quantity: 10,
  transactionDate: "2025-01-07"
}
```

**Step 4:** Update Inventario for both locations
```javascript
// Warehouse inventory
{
  productId: "67xxx",
  locationId: "warehouseId",
  quantityAvailable: 40,       // 50 - 10
  quantityConsigned: 10        // 0 + 10
}

// Hospital inventory (create if doesn't exist)
{
  productId: "67xxx",
  locationId: "cdcId",
  quantityAvailable: 10,
  quantityConsigned: 10,
  quantityConsumed: 0
}
```

**UI:**
```
┌─────────────────────────────────────┐
│ Send on Consignment                 │
├─────────────────────────────────────┤
│ From: [Almacen Central      ▼]     │
│ To: [CDC                    ▼]     │
│ Product: [Orsiro 2.25/13    ▼]     │
│                                     │
│ Available Lots:                     │
│ ┌─────────────────────────────┐   │
│ │ ○ BATCH-2024-001            │   │
│ │   Qty: 50 | Exp: 2026-12-31 │   │
│ └─────────────────────────────┘   │
│                                     │
│ Quantity to Send: [10]              │
│                                     │
│ [Cancel]              [Send]        │
└─────────────────────────────────────┘
```

---

### 5. Hospital Records Consumption

**Action:** CDC hospital uses 2 units of Orsiro 2.25/13

**Scenario:** 2 stents from Batch BATCH-2024-001 were used in procedures

**Input:**
```json
{
  "locationId": "cdcId",
  "productId": "67xxx",
  "lotId": "hospitalLoteId",
  "quantity": 2,
  "consumption": {
    "procedureInfo": "PCI procedure",
    "doctorName": "Dr. Rodriguez"
  }
}
```

**What Happens:**

**Step 1:** Update Lote at Hospital
```javascript
// lotes collection - hospital lot
{
  lotId: "hospitalLoteId",
  quantityAvailable: 8,        // 10 - 2
  quantityConsigned: 8,        // 10 - 2 (still on consignment)
  quantityConsumed: 2          // 0 + 2
}
```

**Step 2:** Create Transaction
```javascript
// transacciones collection
{
  type: "CONSUMPTION",
  productId: "67xxx",
  lotId: "hospitalLoteId",
  lotNumber: "BATCH-2024-001",
  toLocationId: "cdcId",       // Where it was consumed
  quantity: 2,
  consumption: {
    procedureInfo: "PCI procedure",
    doctorName: "Dr. Rodriguez"
  },
  transactionDate: "2025-01-08"
}
```

**Step 3:** Update Inventario at Hospital
```javascript
// inventario collection
{
  productId: "67xxx",
  locationId: "cdcId",
  quantityAvailable: 8,        // 10 - 2
  quantityConsigned: 8,        // 10 - 2
  quantityConsumed: 2,         // 0 + 2
  lastConsumedDate: "2025-01-08"
}
```

**UI (Hospital View):**
```
┌─────────────────────────────────────┐
│ Record Consumption - CDC            │
├─────────────────────────────────────┤
│ Product: [Orsiro 2.25/13    ▼]     │
│                                     │
│ Available Lots at this Location:    │
│ ┌─────────────────────────────┐   │
│ │ ○ BATCH-2024-001            │   │
│ │   Qty: 10 | Exp: 2026-12-31 │   │
│ └─────────────────────────────┘   │
│                                     │
│ Quantity Consumed: [2]              │
│ Doctor: [Dr. Rodriguez]             │
│ Procedure: [PCI procedure]          │
│ Notes: [Optional notes]             │
│                                     │
│ [Cancel]              [Record]      │
└─────────────────────────────────────┘
```

---

## Complete Example Flow

### Starting State: Empty System

**1. Create Products:**
- Orsiro 2.25/13 (code: 364475)
- Galeo Hydro F 014 (code: 127450)

**2. Create Locations:**
- Almacen Central (WAREHOUSE)
- CDC (HOSPITAL)
- CECANOR (HOSPITAL)

### Day 1: Receive Shipment

**Warehouse receives:**
- 50x Orsiro 2.25/13, Batch BATCH-001, Exp: 2026-12-31
- 30x Galeo Hydro F 014, Batch BATCH-002, Exp: 2027-03-15

**Database State:**
```javascript
// lotes
[
  { product: Orsiro, lot: BATCH-001, qty: 50, location: Warehouse },
  { product: Galeo, lot: BATCH-002, qty: 30, location: Warehouse }
]

// inventario
[
  { product: Orsiro, location: Warehouse, available: 50 },
  { product: Galeo, location: Warehouse, available: 30 }
]
```

### Day 2: Send on Consignment

**Send to CDC:**
- 10x Orsiro from BATCH-001
- 5x Galeo from BATCH-002

**Database State:**
```javascript
// lotes
[
  { product: Orsiro, lot: BATCH-001, qty: 50, available: 40, consigned: 10, location: Warehouse },
  { product: Orsiro, lot: BATCH-001, qty: 10, available: 10, consigned: 10, location: CDC },
  { product: Galeo, lot: BATCH-002, qty: 30, available: 25, consigned: 5, location: Warehouse },
  { product: Galeo, lot: BATCH-002, qty: 5, available: 5, consigned: 5, location: CDC }
]

// inventario
[
  { product: Orsiro, location: Warehouse, available: 40, consigned: 10 },
  { product: Orsiro, location: CDC, available: 10, consigned: 10 },
  { product: Galeo, location: Warehouse, available: 25, consigned: 5 },
  { product: Galeo, location: CDC, available: 5, consigned: 5 }
]
```

### Day 3: CDC Uses Products

**CDC consumes:**
- 2x Orsiro from BATCH-001
- 1x Galeo from BATCH-002

**Database State:**
```javascript
// lotes at CDC
[
  { product: Orsiro, lot: BATCH-001, available: 8, consigned: 8, consumed: 2, location: CDC },
  { product: Galeo, lot: BATCH-002, available: 4, consigned: 4, consumed: 1, location: CDC }
]

// inventario at CDC
[
  { product: Orsiro, location: CDC, available: 8, consigned: 8, consumed: 2 },
  { product: Galeo, location: CDC, available: 4, consigned: 4, consumed: 1 }
]
```

---

## Key Business Rules

### Lot Tracking Rules

1. **Same lot at multiple locations:**
   - One physical lot can be split across locations
   - Each location has its own `lotes` record for that lot number
   - Track quantities independently per location

2. **FIFO (First In, First Out):**
   - When sending on consignment, prefer lots expiring soonest
   - UI should sort lots by expiry date
   - Can override if needed

3. **Quantity Validation:**
   - Cannot send more than `quantityAvailable` at a location
   - Cannot consume more than `quantityAvailable` at a location
   - System validates before transaction

4. **Expiry Alerts:**
   - Flag lots expiring within 90 days
   - Prevent sending expired lots on consignment
   - Alert hospitals about expiring inventory

### Transaction Rules

1. **Immutable Transactions:**
   - Once created, transactions cannot be edited
   - Only way to "undo" is create reverse transaction
   - Full audit trail maintained

2. **User Attribution:**
   - Every transaction records who performed it
   - Timestamp automatically captured
   - History tracked in `historia` array

3. **Status Flow:**
   - Most transactions are auto-approved (COMPLETED)
   - Future: Add approval workflow for high-value items

---

## API Endpoints for MVP

### Products
- `POST /api/productos` - Create product
- `GET /api/productos` - List products
- `GET /api/productos/:id` - Get product details

### Locations
- `POST /api/locaciones` - Create location
- `GET /api/locaciones` - List locations
- `GET /api/locaciones/:id` - Get location details

### Warehouse Receipt
- `POST /api/transacciones/warehouse-receipt` - Receive products
  - Creates: Lote, Transaction, updates Inventario

### Consignment
- `POST /api/transacciones/consignment-out` - Send on consignment
  - Updates: Lote (warehouse), creates/updates Lote (hospital), Transaction, Inventario (both)

### Consumption
- `POST /api/transacciones/consumption` - Record consumption
  - Updates: Lote (hospital), Transaction, Inventario (hospital)

### Inventory Views
- `GET /api/inventario` - Get all inventory summary
- `GET /api/inventario/location/:locationId` - Inventory at location
- `GET /api/inventario/product/:productId` - Product across all locations
- `GET /api/lotes/location/:locationId` - Lots at location
- `GET /api/lotes/expiring` - Lots expiring soon

### Dashboard
- `GET /api/dashboard/stats` - Overall stats
- `GET /api/dashboard/alerts` - Low stock & expiry alerts

---

## Next Steps for Implementation

1. ✅ Models created (productos, locaciones, lotes, inventario, transacciones)
2. ⏭️ Create auth controller (copy from nomina)
3. ⏭️ Create productos controller + routes
4. ⏭️ Create locaciones controller + routes
5. ⏭️ Create transacciones controller (3 main endpoints)
6. ⏭️ Create inventario controller (views only)
7. ⏭️ Setup React frontend
8. ⏭️ Build UI pages

---

**This MVP covers your complete core workflow with lot tracking!**
