# Quick Start Guide - Vasculares App

## What We Just Created

✅ **Complete project structure** matching your Nomina app
✅ **Multi-tenant architecture** integrated with Xirugias & Nomina
✅ **Shared authentication** using same JWT secret
✅ **Database setup** for `{companyId}_vasculares`
✅ **Initial schemas** for products, users, and company
✅ **Comprehensive plan** with all features documented

---

## Project Structure

```
vasculares/
├── README.md                    # Project overview
├── QUICKSTART.md                # This file
├── package.json                 # Root package config
├── Procfile                     # Heroku deployment
├── .gitignore                   # Git ignore rules
│
├── docs/
│   └── plan.md                  # Complete implementation plan
│
├── server/                      # Backend (Node.js + Express)
│   ├── package.json
│   ├── app.js                   # Express app setup
│   ├── connection.js            # MongoDB connection
│   ├── getModel.js              # Multi-tenant DB access
│   │
│   ├── bin/
│   │   └── www                  # Server entry point
│   │
│   ├── models/                  # Mongoose schemas
│   │   ├── usersModel.js        # ✅ Shared users (done)
│   │   ├── companyModel.js      # ✅ Shared company (done)
│   │   ├── productoModel.js     # ✅ Products catalog (done)
│   │   ├── locacionModel.js     # TODO
│   │   ├── inventarioModel.js   # TODO
│   │   ├── transaccionModel.js  # TODO
│   │   ├── ordenCompraModel.js  # TODO
│   │   └── loteModel.js         # TODO
│   │
│   ├── controllers/             # Business logic (TODO)
│   ├── routes/                  # API routes (TODO)
│   ├── services/                # Additional services (TODO)
│   │
│   └── util/
│       ├── authenticate.js      # ✅ JWT middleware (done)
│       └── cors.js              # ✅ CORS config (done)
│
└── client/                      # Frontend (React + Vite) (TODO)
    └── src/
```

---

## Next Steps to Get Started

### 1. Set Up Environment Variables

```bash
cd ~/Documents/vasculares/server
cp .env.example .env
```

Edit `.env` and add:
- Your MongoDB URI (same as Xirugias/Nomina)
- JWT_SECRET (MUST be same as your other apps)

### 2. Install Dependencies

```bash
cd ~/Documents/vasculares/server
npm install
```

### 3. Test the Server

```bash
npm run dev
```

You should see:
```
✅ MongoDB connected successfully
🚀 Vasculares API listening on port 3003
```

Test health endpoint:
```bash
curl http://localhost:3003/health
```

---

## What to Build Next

Based on the plan in `docs/plan.md`, here's the recommended order:

### Phase 1: Core Models & API (Week 1-2)

1. **Complete remaining models:**
   - `locacionModel.js` - Hospitals/warehouses
   - `inventarioModel.js` - Stock tracking
   - `transaccionModel.js` - Movement history
   - `ordenCompraModel.js` - Purchase orders
   - `loteModel.js` - Batch/lot tracking

2. **Build authentication:**
   - `controllers/auth.js` - Login/verify (copy from nomina)
   - `routes/auth.js` - Auth routes

3. **Build Products API:**
   - `controllers/productos.js` - CRUD operations
   - `routes/productos.js` - Product routes
   - Test with Postman/Thunder Client

4. **Build Locations API:**
   - `controllers/locaciones.js`
   - `routes/locaciones.js`

### Phase 2: Frontend Setup (Week 2-3)

1. **Initialize React app:**
   ```bash
   cd ~/Documents/vasculares/client
   npm create vite@latest . -- --template react
   ```

2. **Install dependencies:**
   - React Router 7
   - TanStack React Query
   - Tailwind CSS + shadcn/ui
   - React Hook Form + Zod
   - Axios

3. **Copy structure from Nomina:**
   - `src/lib/api.js`
   - `src/context/AuthContext.jsx`
   - `src/pages/` structure

4. **Build initial pages:**
   - Login page
   - Dashboard
   - Products list
   - Locations list

### Phase 3: Inventory System (Week 3-4)

1. **Inventory tracking logic**
2. **Transaction recording**
3. **Dashboard with metrics**
4. **Real-time stock updates**

### Phase 4: Reporting & Migration (Week 4-6)

1. **Build report endpoints**
2. **Excel export functionality**
3. **Data migration scripts**
4. **Import historical data**

---

## Key Features from Plan

📦 **Products Management**
- Guidewires (Galeo, Magnum series)
- Coronary Stents (Orsiro series)
- Product codes and specifications

🏥 **Locations**
- Hospitals: CDC, CECANOR, CAROLINA, etc.
- Central warehouse (Centralmed)
- Stock limits per location

📊 **Inventory Tracking**
- Real-time stock levels
- Total available across network
- Low stock alerts
- Expiration tracking

📝 **Transactions**
- Purchase orders
- Consignment out
- Consumption
- Returns
- Adjustments (damaged/expired)

📈 **Reports**
- General summary (replaces RESUMEN GNRAL)
- Warehouse summaries (replaces RESUMEN DE ALMACENES)
- Monthly consumption
- Replenishment needs
- Historical data (2019-2025)

---

## Database Structure

Your app will use:

```
MongoDB Cluster
├── users (shared)                    # Authentication
├── company (shared)                  # Company info
├── {companyId} (Xirugias)           # Surgery data
├── {companyId}_nomina (Nomina)      # HR/Payroll data
└── {companyId}_vasculares (NEW!)    # Vascular inventory
    ├── productos
    ├── locaciones
    ├── inventario
    ├── transacciones
    ├── ordenes_compra
    └── lotes
```

---

## Authentication Flow

1. User logs in through Vasculares (or already logged in Xirugias/Nomina)
2. JWT token contains: `_id`, `email`, `firstname`, `lastname`, `companyId`
3. Token validated using shared `JWT_SECRET`
4. `companyId` extracted from token
5. App connects to `{companyId}_vasculares` database
6. User can access their company's inventory data

---

## Resources

📄 **Documentation:**
- Full plan: `docs/plan.md`
- README: `README.md`

🔗 **Reference Apps:**
- Nomina: `~/Documents/nomina/`
- Xirugias: `~/Documents/tenant/`

📊 **Data Source:**
- Excel file: `~/Downloads/Productos Vasculares a Consignación 2019 - 2025 (1).xlsx`

---

## Need Help?

1. **Check the plan:** `docs/plan.md` has detailed specs
2. **Reference Nomina:** Copy patterns from `~/Documents/nomina/`
3. **Database schemas:** See models in `server/models/`
4. **API endpoints:** Documented in `docs/plan.md`

---

## Ready to Start Coding?

```bash
# Terminal 1 - Backend
cd ~/Documents/vasculares/server
npm run dev

# Terminal 2 - Frontend (once set up)
cd ~/Documents/vasculares/client
npm run dev
```

**Happy coding! 🚀**
