# API Endpoints - Vasculares

Base URL: `http://localhost:3003/api`

---

## Authentication

### POST `/auth/login`
Login with email and password

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "jwt_token_here",
  "user": { ... },
  "company": { ... }
}
```

### GET `/auth/verify`
Verify token is valid
- Requires: Bearer token
- Returns: `{ valid: true, user: {...} }`

### GET `/auth/me`
Get current user info
- Requires: Bearer token
- Returns: User and company data

---

## Products

### GET `/productos`
List all products

**Query params:**
- `category` - Filter by category (GUIAS | STENTS_CORONARIOS)
- `active` - Filter by status (true | false)
- `search` - Search by name or code

**Response:**
```json
[
  {
    "_id": "...",
    "name": "Orsiro 2.25/13",
    "code": 364475,
    "category": "STENTS_CORONARIOS",
    "active": true
  }
]
```

### GET `/productos/:id`
Get single product by ID

### POST `/productos`
Create new product

**Body:**
```json
{
  "name": "Orsiro 2.25/13",
  "code": 364475,
  "missionCode": 419107,
  "category": "STENTS_CORONARIOS",
  "subcategory": "Orsiro",
  "specifications": {
    "size": "2.25/13",
    "type": "Regular"
  }
}
```

### PUT `/productos/:id`
Update product

### DELETE `/productos/:id`
Deactivate product (soft delete)

### GET `/productos/categorias`
Get list of product categories

**Response:**
```json
[
  { "value": "GUIAS", "label": "Guías" },
  { "value": "STENTS_CORONARIOS", "label": "Stents Coronarios" }
]
```

---

## Locations

### GET `/locaciones`
List all locations

**Query params:**
- `type` - Filter by type (HOSPITAL | WAREHOUSE | CLINIC)
- `active` - Filter by status (true | false)

**Response:**
```json
[
  {
    "_id": "...",
    "name": "CDC",
    "fullName": "Corazones del Cibao",
    "type": "HOSPITAL",
    "active": true
  }
]
```

### GET `/locaciones/:id`
Get single location by ID

### POST `/locaciones`
Create new location

**Body:**
```json
{
  "name": "CDC",
  "fullName": "Corazones del Cibao",
  "type": "HOSPITAL",
  "address": {
    "street": "...",
    "city": "...",
    "province": "..."
  },
  "contact": {
    "name": "Contact Person",
    "phone": "809-XXX-XXXX",
    "email": "contact@hospital.com"
  },
  "stockLimits": {
    "minStock": 10,
    "reorderPoint": 15
  }
}
```

### PUT `/locaciones/:id`
Update location

### DELETE `/locaciones/:id`
Deactivate location (soft delete)

### GET `/locaciones/tipos`
Get list of location types

**Response:**
```json
[
  { "value": "HOSPITAL", "label": "Hospital" },
  { "value": "WAREHOUSE", "label": "Almacén" },
  { "value": "CLINIC", "label": "Clínica" }
]
```

---

## Transactions

### POST `/transacciones/warehouse-receipt`
Receive products at warehouse

**Body:**
```json
{
  "productId": "product_id_here",
  "locationId": "warehouse_id_here",
  "lotNumber": "BATCH-2024-001",
  "quantity": 50,
  "expiryDate": "2026-12-31",
  "manufactureDate": "2024-01-01",
  "supplier": "Boston Scientific",
  "unitCost": 100,
  "notes": "Optional notes"
}
```

**What it does:**
- Creates a new Lote record
- Creates a Transaction record
- Updates Inventario aggregate

**Response:**
```json
{
  "message": "Productos recibidos exitosamente",
  "lote": { ... },
  "transaccion": { ... }
}
```

### POST `/transacciones/consignment-out`
Send products on consignment to hospital

**Body:**
```json
{
  "productId": "product_id_here",
  "lotId": "lot_id_from_warehouse",
  "fromLocationId": "warehouse_id",
  "toLocationId": "hospital_id",
  "quantity": 10,
  "notes": "Optional notes"
}
```

**What it does:**
- Updates source lot (warehouse): reduces available, increases consigned
- Creates/updates destination lot (hospital): adds quantity
- Creates Transaction record
- Updates Inventario for both locations

**Response:**
```json
{
  "message": "Productos enviados en consignación exitosamente",
  "transaccion": { ... },
  "sourceLot": { ... },
  "destLot": { ... }
}
```

### POST `/transacciones/consumption`
Record product consumption at hospital

**Body:**
```json
{
  "productId": "product_id_here",
  "lotId": "lot_id_at_hospital",
  "locationId": "hospital_id",
  "quantity": 2,
  "patientInfo": "Optional patient info",
  "procedureInfo": "PCI procedure",
  "doctorName": "Dr. Rodriguez",
  "notes": "Optional notes"
}
```

**What it does:**
- Updates lot: reduces available and consigned, increases consumed
- Creates Transaction record
- Updates Inventario at hospital

**Response:**
```json
{
  "message": "Consumo registrado exitosamente",
  "transaccion": { ... },
  "lote": { ... }
}
```

### GET `/transacciones`
List transactions

**Query params:**
- `type` - Filter by transaction type
- `productId` - Filter by product
- `locationId` - Filter by location (from or to)
- `startDate` - Filter by date (ISO format)
- `endDate` - Filter by date (ISO format)
- `limit` - Limit results (default: 50)

**Response:**
```json
[
  {
    "_id": "...",
    "type": "CONSUMPTION",
    "productId": { "name": "...", "code": ... },
    "quantity": 2,
    "transactionDate": "2025-01-07T...",
    "performedBy": { ... }
  }
]
```

### GET `/transacciones/:id`
Get single transaction by ID

---

## Inventory

### GET `/inventario`
Get inventory summary (aggregated)

**Query params:**
- `productId` - Filter by product
- `locationId` - Filter by location

**Response:**
```json
[
  {
    "_id": "...",
    "productId": { "name": "Orsiro 2.25/13", ... },
    "locationId": { "name": "CDC", ... },
    "quantityTotal": 50,
    "quantityAvailable": 40,
    "quantityConsigned": 40,
    "quantityConsumed": 10
  }
]
```

### GET `/inventario/location/:locationId`
Get inventory at specific location

### GET `/inventario/product/:productId`
Get inventory for specific product across all locations

### GET `/inventario/alerts`
Get low stock and expiry alerts

**Response:**
```json
{
  "lowStock": [
    {
      "productId": { ... },
      "locationId": { ... },
      "quantityAvailable": 3
    }
  ],
  "expiringSoon": [
    {
      "lotNumber": "BATCH-001",
      "expiryDate": "2025-03-15",
      "quantityAvailable": 20
    }
  ],
  "expired": [
    {
      "lotNumber": "BATCH-OLD",
      "expiryDate": "2024-12-31",
      "quantityAvailable": 5
    }
  ]
}
```

### GET `/inventario/lotes`
Get all lots

**Query params:**
- `productId` - Filter by product
- `locationId` - Filter by location
- `status` - Filter by status (ACTIVE | DEPLETED | EXPIRED | RECALLED)

**Response:**
```json
[
  {
    "_id": "...",
    "productId": { ... },
    "lotNumber": "BATCH-2024-001",
    "expiryDate": "2026-12-31",
    "quantityTotal": 50,
    "quantityAvailable": 40,
    "quantityConsigned": 40,
    "quantityConsumed": 10,
    "currentLocationId": { ... },
    "status": "ACTIVE"
  }
]
```

### GET `/inventario/lotes/location/:locationId`
Get lots at specific location

**Query params:**
- `productId` - Filter by product

### GET `/inventario/lotes/expiring`
Get lots expiring soon

**Query params:**
- `days` - Days from now (default: 90)

### GET `/inventario/dashboard/stats`
Get dashboard statistics

**Response:**
```json
{
  "products": 25,
  "locations": 8,
  "inventory": {
    "available": 500,
    "consigned": 450,
    "consumed": 200
  },
  "alerts": {
    "lowStock": 3,
    "expiringSoon": 5,
    "expired": 1
  }
}
```

---

## Complete Flow Example

### 1. Create Product
```bash
POST /api/productos
{
  "name": "Orsiro 2.25/13",
  "code": 364475,
  "category": "STENTS_CORONARIOS"
}
```

### 2. Create Locations
```bash
POST /api/locaciones
{
  "name": "Almacen Central",
  "type": "WAREHOUSE"
}

POST /api/locaciones
{
  "name": "CDC",
  "type": "HOSPITAL"
}
```

### 3. Receive at Warehouse
```bash
POST /api/transacciones/warehouse-receipt
{
  "productId": "{productId}",
  "locationId": "{warehouseId}",
  "lotNumber": "BATCH-001",
  "quantity": 50,
  "expiryDate": "2026-12-31"
}
```

### 4. Send on Consignment
```bash
POST /api/transacciones/consignment-out
{
  "productId": "{productId}",
  "lotId": "{lotIdFromWarehouse}",
  "fromLocationId": "{warehouseId}",
  "toLocationId": "{hospitalId}",
  "quantity": 10
}
```

### 5. Record Consumption
```bash
POST /api/transacciones/consumption
{
  "productId": "{productId}",
  "lotId": "{lotIdAtHospital}",
  "locationId": "{hospitalId}",
  "quantity": 2
}
```

### 6. View Inventory
```bash
GET /api/inventario
GET /api/inventario/location/{hospitalId}
GET /api/inventario/lotes/location/{hospitalId}
GET /api/inventario/dashboard/stats
```

---

## Testing with curl

### Login
```bash
curl -X POST http://localhost:3003/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'
```

### Create Product (with auth)
```bash
curl -X POST http://localhost:3003/api/productos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "name": "Orsiro 2.25/13",
    "code": 364475,
    "category": "STENTS_CORONARIOS"
  }'
```

### View Inventory
```bash
curl -X GET http://localhost:3003/api/inventario \
  -H "Authorization: Bearer {token}"
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message here",
  "errors": [
    {
      "msg": "Validation error message",
      "param": "fieldName"
    }
  ]
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing token)
- `404` - Not Found
- `500` - Internal Server Error
