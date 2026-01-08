# Vasculares - Inventory Management System

**Sistema de Gestión de Inventario en Consignación para Productos Vasculares**

Integrated with Xirugias and Nomina apps - Shared authentication & multi-tenant architecture

---

## Project Overview

### Purpose
Replace the Excel spreadsheet "Productos Vasculares a Consignación 2019-2025" with a modern web application that tracks medical products (guidewires and coronary stents) distributed on consignment across multiple hospitals in the Dominican Republic.

### Key Business Goals
- Real-time inventory visibility across all locations
- Automated replenishment calculations
- Expiration tracking and alerts
- Consumption analytics and reporting
- Historical data preservation (2019-2025)
- Audit trail for all transactions

---

## Technical Architecture

### Tech Stack (Matching Nomina App)

**Backend:**
- Node.js 18+
- Express.js
- MongoDB + Mongoose
- JWT Authentication (shared with Xirugias/Nomina)
- express-jwt, express-validator
- helmet (security)

**Frontend:**
- React 19
- React Router 7
- TanStack React Query v5
- Tailwind CSS 4
- shadcn/ui components
- React Hook Form + Zod validation
- Vite (build tool)
- Zustand (state management)
- Lucide React (icons)

### Multi-Tenant Architecture

```
MongoDB Cluster (shared with Xirugias & Nomina)
├── users (shared) - Authentication
├── company (shared) - Company info
├── {companyId} - Xirugias data
├── {companyId}_nomina - HR/Payroll data
└── {companyId}_vasculares - Vascular inventory (NEW)
```

### Authentication Flow
1. User logs in through any app (Xirugias/Nomina/Vasculares)
2. JWT token issued with: `_id`, `email`, `firstname`, `lastname`, `companyId`, `profilePicture`
3. Token includes same `JWT_SECRET` shared across all apps
4. User can access all apps without re-login
5. Middleware extracts `companyId` to route to correct database

---

## Database Schema Design

### 1. Products Collection (`productos`)

```javascript
{
  _id: ObjectId,
  name: String,              // "Galeo Hydro F 014", "Orsiro 2.25/13"
  code: Number,              // 127450, 364475
  missionCode: Number,       // Alternative code (419107)
  category: String,          // "GUIAS" | "STENTS_CORONARIOS"
  subcategory: String,       // "Hydro", "Orsiro", etc.
  specifications: {
    size: String,            // "2.25/13" (auto-generated from diameter/length)
    diameter: Number,        // 2.25, 2.5, 3.0 (mm) - for proper sorting
    length: Number,          // 13, 15, 18 (mm) - for proper sorting
    type: String,            // "Straight", "Regular"
  },
  inventorySettings: {       // Warehouse-level targets
    targetStockWarehouse: Number,  // Ideal quantity in central warehouse
    reorderPoint: Number,          // Trigger order when below this
    minStockLevel: Number,         // Minimum safety stock
    maxStockLevel: Number,         // Maximum stock capacity
  },
  active: Boolean,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  historia: [{               // Change history
    fecha: Date,
    user: { _id, firstname, lastname },
    accion: String
  }]
}
```

### 2. Locations Collection (`locaciones`)

```javascript
{
  _id: ObjectId,
  name: String,              // "CDC", "CECANOR", "Almacen Central"
  fullName: String,          // "Corazones del Cibao"
  type: String,              // "HOSPITAL" | "WAREHOUSE"
  address: {
    street: String,
    city: String,
    province: String,
    country: String
  },
  contact: {
    name: String,
    phone: String,
    email: String
  },
  stockLimits: {
    minStock: Number,        // Minimum stock threshold
    maxStock: Number,        // Maximum stock capacity
    reorderPoint: Number     // When to trigger replenishment alert
  },
  active: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### 3. Inventory Collection (`inventario`)

```javascript
{
  _id: ObjectId,
  productId: ObjectId,       // ref: productos
  locationId: ObjectId,      // ref: locaciones
  quantity: Number,          // Current available quantity
  quantityConsigned: Number, // Total sent on consignment
  quantityConsumed: Number,  // Total consumed/used
  quantityDamaged: Number,   // Damaged items
  quantityExpired: Number,   // Expired items
  quantityReturned: Number,  // Returned items
  lastMovement: Date,
  updatedAt: Date
}
```

### 4. Transactions Collection (`transacciones`)

```javascript
{
  _id: ObjectId,
  type: String,              // "PURCHASE" | "CONSIGNMENT_OUT" | "CONSUMPTION" |
                             // "RETURN" | "ADJUSTMENT" | "TRANSFER"
  productId: ObjectId,       // ref: productos
  fromLocationId: ObjectId,  // ref: locaciones (null for purchases)
  toLocationId: ObjectId,    // ref: locaciones
  quantity: Number,

  // Additional fields per type
  purchaseOrder: {           // For PURCHASE type
    poNumber: String,
    supplier: String,
    unitCost: Number,
    totalCost: Number,
    orderDate: Date
  },

  adjustment: {              // For ADJUSTMENT type
    reason: String,          // "DAMAGED" | "EXPIRED" | "LOST" | "FOUND"
    notes: String
  },

  batch: {                   // Batch/lot tracking
    batchNumber: String,
    expiryDate: Date,
    manufactureDate: Date
  },

  transactionDate: Date,
  notes: String,
  performedBy: ObjectId,     // ref: users
  createdAt: Date,
  updatedAt: Date
}
```

### 5. Purchase Orders Collection (`ordenes_compra`)

```javascript
{
  _id: ObjectId,
  poNumber: String,          // Auto-generated
  supplier: String,
  orderDate: Date,
  expectedDeliveryDate: Date,
  actualDeliveryDate: Date,
  status: String,            // "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED"

  items: [{
    productId: ObjectId,
    quantity: Number,
    unitCost: Number,
    totalCost: Number
  }],

  totalAmount: Number,
  currency: String,

  notes: String,
  createdBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

### 6. Batches Collection (`lotes`)

```javascript
{
  _id: ObjectId,
  productId: ObjectId,
  batchNumber: String,
  manufactureDate: Date,
  expiryDate: Date,
  quantity: Number,
  status: String,            // "ACTIVE" | "EXPIRED" | "RECALLED"
  locationId: ObjectId,      // Current location
  notes: String,
  createdAt: Date,
  updatedAt: Date
}
```

### 7. Reports Collection (`reportes`)

```javascript
{
  _id: ObjectId,
  reportType: String,        // "MONTHLY_CONSUMPTION" | "STOCK_SUMMARY" |
                             // "EXPIRATION_ALERT" | "REPLENISHMENT"
  period: {
    startDate: Date,
    endDate: Date,
    month: Number,
    year: Number
  },
  data: Mixed,               // Report-specific data
  generatedBy: ObjectId,
  generatedAt: Date
}
```

### 8. Inventory Targets Collection (`inventarioObjetivos`)

Per-location inventory targets for planning and replenishment.

```javascript
{
  _id: ObjectId,
  productId: ObjectId,       // ref: productos
  locationId: ObjectId,      // ref: locaciones (hospital/clinic)

  // Target levels for this product at this location
  targetStock: Number,       // Ideal quantity to maintain
  reorderPoint: Number,      // Trigger consignment when below this
  minStockLevel: Number,     // Minimum safety stock

  // Metadata
  notes: String,
  active: Boolean,
  createdBy: { _id, firstname, lastname },
  updatedBy: { _id, firstname, lastname },
  createdAt: Date,
  updatedAt: Date
}

// Compound unique index: { productId: 1, locationId: 1 }
```

---

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login (shared auth)
- `GET /api/auth/verify` - Verify token
- `GET /api/auth/me` - Get current user

### Products
- `GET /api/productos` - List products (with filters)
- `GET /api/productos/:id` - Get product details
- `POST /api/productos` - Create product
- `PUT /api/productos/:id` - Update product
- `DELETE /api/productos/:id` - Deactivate product
- `GET /api/productos/categorias` - Get categories

### Locations
- `GET /api/locaciones` - List locations
- `GET /api/locaciones/:id` - Get location details
- `POST /api/locaciones` - Create location
- `PUT /api/locaciones/:id` - Update location
- `DELETE /api/locaciones/:id` - Deactivate location

### Inventory
- `GET /api/inventario` - Get inventory summary
- `GET /api/inventario/por-locacion/:locationId` - Inventory by location
- `GET /api/inventario/por-producto/:productId` - Inventory by product
- `GET /api/inventario/disponible` - Available stock across all locations
- `GET /api/inventario/alertas` - Low stock & expiration alerts

### Transactions
- `GET /api/transacciones` - List transactions (with filters)
- `GET /api/transacciones/:id` - Get transaction details
- `POST /api/transacciones/compra` - Record purchase
- `POST /api/transacciones/consignacion` - Consign to location
- `POST /api/transacciones/consumo` - Record consumption
- `POST /api/transacciones/devolucion` - Record return
- `POST /api/transacciones/ajuste` - Record adjustment
- `POST /api/transacciones/transferencia` - Transfer between locations

### Purchase Orders
- `GET /api/ordenes-compra` - List purchase orders
- `GET /api/ordenes-compra/:id` - Get PO details
- `POST /api/ordenes-compra` - Create PO
- `PUT /api/ordenes-compra/:id` - Update PO
- `POST /api/ordenes-compra/:id/recibir` - Mark as received
- `DELETE /api/ordenes-compra/:id` - Cancel PO

### Reports
- `GET /api/reportes/resumen-general` - General summary (replaces RESUMEN GNRAL sheet)
- `GET /api/reportes/resumen-almacenes` - Warehouses summary (replaces RESUMEN DE ALMACENES)
- `GET /api/reportes/consumo-mensual` - Monthly consumption
- `GET /api/reportes/reposiciones` - Replenishment needs
- `GET /api/reportes/vencidos` - Expired products
- `GET /api/reportes/historial-compras` - Purchase history
- `POST /api/reportes/custom` - Generate custom report
- `GET /api/reportes/:id/export` - Export report to Excel

### Dashboard / Analytics
- `GET /api/dashboard/stats` - Overview statistics
- `GET /api/dashboard/alertas` - Active alerts
- `GET /api/dashboard/tendencias` - Consumption trends
- `GET /api/dashboard/top-productos` - Most consumed products
- `GET /api/dashboard/top-locaciones` - Most active locations

### Analytics (Consumption & Planning)
- `GET /api/analytics/consumption/monthly` - Monthly consumption by product
- `GET /api/analytics/consumption/by-location` - Consumption grouped by location
- `GET /api/analytics/consumption/trends` - Consumption trends and averages
- `GET /api/analytics/consumption/by-size` - Consumption by product size
- `GET /api/analytics/planning-data` - Comprehensive planning data
  - Query params: `category`, `locationId`
  - Returns: products with stock, consumption avg, suggested orders/consignments

### Inventory Targets (Per-Location)
- `GET /api/inventario-objetivos` - List targets (filter by productId, locationId)
- `GET /api/inventario-objetivos/:id` - Get single target
- `POST /api/inventario-objetivos` - Upsert target (create or update)
- `PUT /api/inventario-objetivos/:id` - Update target
- `DELETE /api/inventario-objetivos/:id` - Deactivate target

---

## Frontend Structure

### Pages

1. **Dashboard** (`/`)
   - Overview cards: Total products, locations, stock value, alerts
   - Recent transactions
   - Quick actions
   - Charts: Consumption trends, stock by location

2. **Products** (`/productos`)
   - List view with filters (category, active/inactive)
   - Create/Edit product modal
   - Product details with inventory across locations

3. **Locations** (`/locaciones`)
   - List of hospitals/warehouses
   - Create/Edit location modal
   - Location details with current inventory

4. **Inventory** (`/inventario`)
   - Real-time stock view
   - Filter by location/product
   - Stock alerts highlighted
   - Quick adjust quantities

5. **Transactions** (`/transacciones`)
   - Transaction history
   - Filter by type, date, location, product
   - Create transaction modal (with type selector)

6. **Purchase Orders** (`/ordenes-compra`)
   - PO list with status
   - Create/Edit PO
   - Receive PO workflow

7. **Reports** (`/reportes`)
   - Pre-defined reports (matching current Excel sheets)
   - Date range selector
   - Export to Excel/PDF
   - Custom report builder

8. **Planning** (`/planificacion`)
   - Excel-like product planning table
   - Location selector (Warehouse vs Hospital/Clinic)
   - Editable stock targets per row
   - Auto-calculated: consumption avg, days coverage, suggested orders
   - Summary cards: critical items, warnings, total to order
   - Products sorted by: category → name → diameter → length

9. **Settings** (`/configuracion`)
   - Company info
   - User management
   - Stock thresholds
   - Alert preferences

### Components (shadcn/ui based)

**Core UI:**
- Button, Input, Select, Checkbox, Label
- Table, DataTable (with sorting, filtering, pagination)
- Dialog, Sheet, Popover
- Card, Badge, Alert
- Form (React Hook Form + Zod)
- DatePicker, DateRangePicker

**Custom Components:**
- ProductSelector
- LocationSelector
- InventoryCard
- TransactionForm
- StockAlert
- ConsumptionChart
- ExpirationAlert
- ReportViewer

---

## Implementation Phases

### Phase 1: Foundation
- ✅ Project setup (folder structure, dependencies)
- ✅ Database schemas and models
- ✅ Authentication integration (shared JWT)
- ✅ Basic getModel.js for multi-tenant
- ✅ API structure (routes, controllers)
- ✅ Products CRUD with inventory settings
- ✅ Locations CRUD

### Phase 2: Core Inventory
- ✅ Inventory tracking logic (lot-based)
- ✅ Transaction recording (warehouse receipt, consignment, consumption)
- ✅ Basic inventory views
- ✅ Dashboard with key metrics
- ✅ Low stock and expiration alerts

### Phase 3: Planning & Analytics
- ✅ Analytics endpoints (monthly consumption, trends, by-location, by-size)
- ✅ Planning data endpoint (warehouse + location views)
- ✅ Planning page with Excel-like table
- ✅ Editable stock targets (via dialog)
- ✅ Per-location inventory targets (inventarioObjetivos)
- ✅ Product sorting: category → name → diameter → length
- ✅ Separate diameter/length fields for proper sorting

### Phase 4: Transactions & POs
- Purchase orders workflow
- Returns and adjustments
- Transfer between locations

### Phase 5: Reporting
- General summary report
- Warehouse summaries
- Monthly consumption reports
- Replenishment needs
- Excel export functionality

### Phase 6: Data Migration
- Import historical data from Excel
- Validate data integrity
- Map Excel structure to database

### Phase 7: Polish & Deploy
- Advanced filtering and search
- Performance optimization
- User testing
- Deployment to production

---

## Data Migration Strategy

### From Excel to Database

**Step 1: Extract Products**
- Parse "RESUMEN GNRAL" sheet
- Extract unique products (Guias, Orsiros)
- Create product catalog with codes

**Step 2: Extract Locations**
- Identify all hospital/warehouse sheets
- Create location records

**Step 3: Historical Transactions**
- Parse "Orden de Compra" sheet (2019-2025)
- Import as PURCHASE transactions
- Parse "Entrada Vasculares" sheet
- Import as CONSIGNMENT_OUT transactions

**Step 4: Current Inventory**
- Calculate current stock from "RESUMEN DE ALMACENES"
- Set initial inventory levels per location

**Step 5: Consumption History**
- Parse "Consumo por mes" sheet
- Import monthly consumption data

**Step 6: Validation**
- Verify totals match Excel
- Check inventory calculations
- Validate historical trends

---

## Key Features Detail

### 1. Real-Time Inventory Tracking
- Live stock levels per location
- Total available across network
- Stock movement history
- Visual stock indicators (low/normal/high)

### 2. Automated Alerts
- Low stock warnings (configurable thresholds)
- Expiration alerts (30/60/90 days)
- Overstocking notifications
- Zero stock alerts

### 3. Replenishment Calculation
- Based on consumption velocity
- Seasonal trend consideration
- Min/max stock levels
- Automatic PO suggestions

### 4. Batch/Lot Tracking
- Track products by batch number
- Expiration date monitoring
- FIFO (First In, First Out) recommendations
- Recall management

### 5. Multi-Level Reporting
- Executive dashboard
- Operational reports
- Historical analytics
- Custom report builder

### 6. Audit Trail
- Every transaction logged
- User attribution
- Timestamp tracking
- Change history

---

## Security & Permissions

### Role-Based Access Control

**Admin:**
- Full access to all features
- Create/edit products and locations
- Approve transactions
- Generate reports
- Manage users

**Manager:**
- View all data
- Record transactions
- Generate reports
- Cannot edit master data

**Hospital User:**
- View their location's inventory only
- Record consumption at their location
- Request replenishment
- View basic reports

**Viewer:**
- Read-only access
- View dashboards and reports
- No transaction recording

---

## Performance Considerations

1. **Indexing:**
   - Index on productId, locationId for inventory queries
   - Index on transactionDate for reports
   - Compound index on productId + locationId

2. **Caching:**
   - Cache product catalog
   - Cache location list
   - Cache dashboard stats (5 min TTL)

3. **Pagination:**
   - Paginate transaction history
   - Limit report results
   - Lazy load large tables

4. **Aggregation:**
   - Use MongoDB aggregation pipeline for reports
   - Pre-calculate summary stats
   - Background jobs for heavy computations

---

## Future Enhancements

- Mobile app for on-site consumption recording
- Barcode/QR code scanning
- Automatic inventory reconciliation
- Predictive analytics for demand forecasting
- Integration with accounting systems
- Supplier portal for PO management
- WhatsApp notifications for alerts
- Electronic signatures for approvals
- Document management for POs/invoices

---

## Success Metrics

1. **Operational:**
   - Reduce inventory discrepancies by 90%
   - Decrease stockouts by 80%
   - Reduce expired products by 70%

2. **Efficiency:**
   - Save 10+ hours/week on manual data entry
   - Generate reports in seconds (vs hours)
   - Real-time visibility vs daily updates

3. **Financial:**
   - Optimize stock levels (reduce carrying costs)
   - Minimize waste from expiration
   - Better forecasting for purchasing

4. **User Adoption:**
   - 100% user adoption within 1 month
   - <5 min average time for common tasks
   - High user satisfaction (>4/5 rating)

---

## Next Steps

1. Review and approve this plan
2. Set up project folder structure
3. Initialize Git repository
4. Create initial database schemas
5. Set up authentication integration
6. Begin Phase 1 development

---

**Created:** January 7, 2025
**Last Updated:** January 8, 2025
**Version:** 1.1

### Changelog
- v1.1 (Jan 8): Added Planning & Analytics phase, inventarioObjetivos collection, diameter/length fields for sorting
