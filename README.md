# Vasculares - Sistema de Gestión de Inventario en Consignación

Sistema de gestión de inventario para productos vasculares (guías y stents coronarios) en consignación. Integrado con Xirugias y Nomina para autenticación compartida.

## Características

### ✅ Implementado
- Estructura de proyecto inicial
- Configuración multi-tenant

### 🚧 En Desarrollo
- Gestión de productos (guías, stents)
- Gestión de locaciones (hospitales, almacenes)
- Tracking de inventario en tiempo real
- Registro de transacciones
- Órdenes de compra
- Reportes y analytics

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                   MongoDB Cluster                        │
├─────────────────────────────────────────────────────────┤
│  Shared:     users │ company                            │
│  Per-tenant: {companyId} (Xirugias)                     │
│              {companyId}_nomina (HR/Nómina)             │
│              {companyId}_vasculares (Inventario)        │
└─────────────────────────────────────────────────────────┘
```

## Requisitos

- Node.js 18+
- MongoDB (mismo cluster que Xirugias y Nomina)
- Acceso al mismo `JWT_SECRET` que las otras apps

## Configuración

### 1. Variables de Entorno

Crear archivo `.env` en `/server`:

```bash
PORT=3003
NODE_ENV=development
MONGODB_URI=mongodb+srv://...  # Mismo cluster que Xirugias/Nomina
JWT_SECRET=...                  # DEBE ser igual que las otras apps
CLIENT_URL=http://localhost:5173
```

### 2. Instalar Dependencias

```bash
# Root - instalar todo
npm run install:all

# O manualmente
cd server && npm install
cd ../client && npm install
```

### 3. Iniciar en Desarrollo

Terminal 1 - Backend:
```bash
cd server
npm run dev
```

Terminal 2 - Frontend:
```bash
cd client
npm run dev
```

- Backend: http://localhost:3003
- Frontend: http://localhost:5173

## Estructura del Proyecto

```
vasculares/
├── client/                    # Frontend React
│   ├── src/
│   │   ├── components/        # Componentes UI (shadcn)
│   │   │   ├── ui/            # Componentes base
│   │   │   ├── ProductSelector.jsx
│   │   │   ├── LocationSelector.jsx
│   │   │   └── InventoryCard.jsx
│   │   ├── context/           # AuthContext
│   │   ├── lib/               # API client, utils
│   │   └── pages/             # Páginas de la app
│   │       ├── Dashboard.jsx
│   │       ├── Products.jsx
│   │       ├── Locations.jsx
│   │       ├── Inventory.jsx
│   │       ├── Transactions.jsx
│   │       └── Reports.jsx
│   └── package.json
│
├── server/                    # Backend Express
│   ├── controllers/           # Lógica de negocio
│   │   ├── auth.js
│   │   ├── productos.js
│   │   ├── locaciones.js
│   │   ├── inventario.js
│   │   ├── transacciones.js
│   │   └── reportes.js
│   ├── models/                # Schemas Mongoose
│   │   ├── productoModel.js
│   │   ├── locacionModel.js
│   │   ├── inventarioModel.js
│   │   ├── transaccionModel.js
│   │   ├── ordenCompraModel.js
│   │   └── loteModel.js
│   ├── routes/                # Rutas API
│   ├── util/                  # Middleware, helpers
│   ├── services/              # Business logic
│   ├── getModel.js            # Multi-tenant DB access
│   ├── connection.js          # MongoDB connection
│   └── app.js
│
├── docs/                      # Documentación
│   └── plan.md                # Plan de implementación
│
└── README.md
```

## Módulos Principales

### 1. Productos
Catálogo de productos vasculares:
- Guías (Galeo Hydro, Magnum, etc.)
- Stents Coronarios (Orsiro series)
- Códigos, especificaciones, categorías

### 2. Locaciones
Hospitales y almacenes:
- Información de contacto
- Límites de stock
- Configuración de alertas

### 3. Inventario
Tracking en tiempo real:
- Stock disponible por locación
- Stock total en la red
- Alertas de bajo stock
- Productos próximos a vencer

### 4. Transacciones
Registro de movimientos:
- Compras
- Consignaciones
- Consumo
- Devoluciones
- Ajustes
- Transferencias

### 5. Órdenes de Compra
Gestión de POs:
- Creación de órdenes
- Tracking de estado
- Recepción de productos

### 6. Reportes
Analytics y reportes:
- Resumen general
- Resumen por almacén
- Consumo mensual
- Necesidades de reposición
- Productos vencidos

## API Endpoints

### Auth
- `POST /api/auth/login` - Login
- `GET /api/auth/verify` - Verificar token
- `GET /api/auth/me` - Usuario actual

### Productos
- `GET /api/productos` - Listar productos
- `POST /api/productos` - Crear producto
- `GET /api/productos/:id` - Detalle producto
- `PUT /api/productos/:id` - Actualizar producto

### Locaciones
- `GET /api/locaciones` - Listar locaciones
- `POST /api/locaciones` - Crear locación
- `GET /api/locaciones/:id` - Detalle locación
- `PUT /api/locaciones/:id` - Actualizar locación

### Inventario
- `GET /api/inventario` - Resumen de inventario
- `GET /api/inventario/por-locacion/:id` - Inventario por locación
- `GET /api/inventario/por-producto/:id` - Inventario por producto
- `GET /api/inventario/alertas` - Alertas de stock

### Transacciones
- `GET /api/transacciones` - Historial
- `POST /api/transacciones/compra` - Registrar compra
- `POST /api/transacciones/consignacion` - Consignar
- `POST /api/transacciones/consumo` - Registrar consumo
- `POST /api/transacciones/devolucion` - Registrar devolución

### Reportes
- `GET /api/reportes/resumen-general` - Resumen general
- `GET /api/reportes/resumen-almacenes` - Resumen almacenes
- `GET /api/reportes/consumo-mensual` - Consumo mensual
- `GET /api/reportes/reposiciones` - Necesidades reposición

## Tecnologías

**Frontend:**
- React 19
- React Router 7
- TanStack React Query
- Tailwind CSS
- shadcn/ui
- React Hook Form + Zod

**Backend:**
- Express.js
- MongoDB + Mongoose
- JWT Authentication

## Roadmap

- [x] Estructura inicial del proyecto
- [ ] Autenticación compartida
- [ ] CRUD Productos
- [ ] CRUD Locaciones
- [ ] Sistema de inventario
- [ ] Registro de transacciones
- [ ] Órdenes de compra
- [ ] Reportes básicos
- [ ] Migración de datos Excel
- [ ] Alertas y notificaciones
- [ ] Dashboard analytics

## Documentación Adicional

- [Plan de Implementación](../vasculares-plan.md)

---

**Versión:** 1.0.0
**Última actualización:** Enero 2025
