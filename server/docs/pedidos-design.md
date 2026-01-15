# Pedidos (Supplier Order Tracking) - Design Document

**Created:** 2026-01-14
**Status:** Ready for Implementation

## Overview

Track supplier orders internally (not in SAP) to provide visibility of incoming inventory before GoodsReceipts are created.

## Problem Statement

1. **No order tracking:** User places order with supplier but has no way to record it in the app
2. **No transit visibility:** "Sugerido Ordenar" doesn't account for orders already placed
3. **Formula bug:** Current calculation assumes centro stock is fungible (can move between centros)

## Solution

### New Pedido Model

Tracks orders placed to supplier. Links to GoodsReceipts when inventory arrives.

```javascript
const pedidoSchema = new mongoose.Schema({
  orderDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  expectedArrivalDate: {
    type: Date,
  },
  supplier: {
    type: String,
  },
  notes: {
    type: String,
  },
  status: {
    type: String,
    enum: ['PENDIENTE', 'PARCIAL', 'COMPLETO', 'CANCELADO'],
    default: 'PENDIENTE',
  },
  items: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'productos',
      required: true,
    },
    quantityOrdered: {
      type: Number,
      required: true,
      min: 1,
    },
    quantityReceived: {
      type: Number,
      default: 0,
      min: 0,
    },
  }],
  // Linked GoodsReceipts that fulfilled this order
  goodsReceipts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'goodsreceipts',
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
}, { timestamps: true });
```

### Transit Tracking by Location Type

| Location Type | Tránsito Entrante | Tránsito Saliente |
|---------------|-------------------|-------------------|
| Almacén Principal | Pedidos PENDIENTE/PARCIAL | Consignaciones EN_TRANSITO |
| Centros | Consignaciones EN_TRANSITO (to them) | N/A |

### Formula Fix: suggestedOrder Calculation

**Current (buggy):**
```javascript
// In analytics.js getPlanningData()
const systemTarget = warehouseTarget + totalCentroTargets;
const systemStock = stock.warehouseStock + totalCentroStock;
const suggestedOrder = Math.max(0, systemTarget - systemStock);
```

**Problem:** Assumes centro stock is fungible. If CDC has surplus and CECANOR has deficit, the calculation thinks CDC can cover CECANOR.

**Correct formula:**
```javascript
// Calculate each centro's deficit individually
let totalCentroDeficit = 0;
centroTargetsForProduct.forEach((target) => {
  const locId = target.locationId._id.toString();
  const centroStock = centroStocksMap[locId] || 0;
  const centroTarget = target.targetStock || 0;
  totalCentroDeficit += Math.max(0, centroTarget - centroStock);
});

// Get pending orders for this product
const pendingOrders = pendingOrdersByProduct[product._id.toString()] || 0;

// Suggested order = centro deficits + warehouse target - warehouse stock - pending orders
const suggestedOrder = Math.max(0,
  totalCentroDeficit + warehouseTarget - stock.warehouseStock - pendingOrders
);
```

**Why this works:**
- Centro deficits calculated individually (no cross-centro sharing)
- Warehouse stock can cover either its own target OR centro needs
- Already-ordered quantities subtracted to avoid re-ordering

## API Endpoints

### Pedido CRUD

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/pedidos` | Create new order |
| `GET` | `/api/pedidos` | List orders (filterable) |
| `GET` | `/api/pedidos/:id` | Get single order with items |
| `PUT` | `/api/pedidos/:id` | Update order |
| `DELETE` | `/api/pedidos/:id` | Cancel order (soft delete via status) |

### Planning Integration

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/pedidos/pending-by-product` | Get pending qty per product for planning |

**Response:**
```json
{
  "productId1": 5,
  "productId2": 3
}
```

### GoodsReceipt Linking

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/pedidos/suggest-for-items` | Find matching pedidos for GR items |
| `POST` | `/api/pedidos/:id/receive` | Update quantities received |

## UI Components

### Planning Page (Warehouse View)

**New columns:**

| Producto | Stock | Pedido | Consig Out | Sugerido | Acciones |
|----------|-------|--------|------------|----------|----------|
| Orsiro 3.0/15 | 8 | 5 | 3 | 2 | [Ordenar] |

- **Pedido:** Sum of `quantityOrdered - quantityReceived` for PENDIENTE/PARCIAL pedidos
- **Consig Out:** Existing `warehouseInTransit` (consignaciones EN_TRANSITO)
- **Sugerido:** New formula result

**"Ordenar" Button:**
1. Opens dialog pre-filled with Sugerido quantity
2. Optional fields: expected date, supplier, notes
3. Creates Pedido with status PENDIENTE
4. Refreshes planning data

### Pedidos Page (`/pedidos`)

**List View:**
- Filter by status, date range
- Show: order date, items count, total qty, status badge
- Click to expand/view details

**Detail View:**
- Items table with ordered/received columns
- Status badge
- Linked GoodsReceipts
- Cancel button (for PENDIENTE only)

### GoodsReceipt Integration

**After entering GR items:**
1. System queries `/api/pedidos/suggest-for-items` with product list
2. Shows dialog: "Estos items coinciden con pedidos pendientes:"
3. User can confirm linking or skip
4. On save: Update pedido `quantityReceived` and `goodsReceipts` array

**Status transitions:**
- All items received → COMPLETO
- Some items received → PARCIAL
- No items received → PENDIENTE
- User cancels → CANCELADO

## Implementation Order

1. **Phase 1.1:** Create `pedidoModel.js`
2. **Phase 1.2:** Create `pedidoController.js` with CRUD + `getPendingByProduct`
3. **Phase 1.3:** Fix `analytics.js` → `getPlanningData()` formula
4. **Phase 2.1:** Planning page: Add columns + "Ordenar" button
5. **Phase 3.1:** Create `/pedidos` page
6. **Phase 4.1:** GoodsReceipt linking UI

## Test Cases

### Formula Tests

| Scenario | WH Target | WH Stock | Centro Deficits | Pending | Expected |
|----------|-----------|----------|-----------------|---------|----------|
| Basic | 10 | 5 | 3 | 0 | 8 |
| With pending | 10 | 5 | 3 | 4 | 4 |
| WH surplus | 5 | 10 | 3 | 0 | 0 |
| Centro surplus ignored | 10 | 5 | 0 (but has surplus) | 0 | 5 |

### Status Transitions

| Action | Before | After |
|--------|--------|-------|
| Create pedido | - | PENDIENTE |
| Partial GR received | PENDIENTE | PARCIAL |
| Full GR received | PARCIAL | COMPLETO |
| User cancels | PENDIENTE | CANCELADO |

## Notes

- Pedidos are **NOT synced to SAP** - purely internal tracking
- SAP Purchase Orders are separate (could be future enhancement)
- Multiple GoodsReceipts can fulfill one Pedido (partial shipments)
- One GoodsReceipt could fulfill multiple Pedidos (rare but possible)
