# Vasculares - Mejoras Pendientes

## 🎯 Alto Impacto - Próximas Tareas

### 1. ✅ Página de Historial de Transacciones (COMPLETADO)
- ✅ Ver todos los movimientos (recepciones, consignaciones, consumos)
- ✅ Filtrar por fecha, producto, locación, tipo de transacción
- ✅ Ver detalles completos de cada transacción (doctor, paciente, procedimiento)
- ⏳ Exportar a Excel/PDF (pendiente)

### 2. **Planificación de Inventario & Analytics (EN PROGRESO)**
**Objetivo:** Replicar funcionalidad del Excel "Productos Vasculares a Consignación 2019-2025"

#### Fase 1: Product Targets & Basic Analytics
- [ ] **Schema Changes:**
  - [ ] Agregar `inventorySettings` a productos (targetStockWarehouse, reorderPoint, minStockLevel, maxStockLevel)
  - [ ] Crear colección `inventarioObjetivos` (targets por producto/locación)
  - [ ] Agregar campos de análisis a transacciones

- [ ] **Consumption Analytics API:**
  - [ ] Endpoint: GET /api/analytics/consumption/monthly - Consumo mensual por producto
  - [ ] Endpoint: GET /api/analytics/consumption/by-location - Consumo por locación
  - [ ] Endpoint: GET /api/analytics/consumption/trends - Tendencias y promedios
  - [ ] Endpoint: GET /api/analytics/consumption/by-size - Consumo agrupado por tamaño de producto
  - [ ] Función: Calcular promedio mensual de consumo automáticamente

- [ ] **Product Configuration UI:**
  - [ ] Agregar sección "Niveles de Inventario" en formulario de productos
  - [ ] Inputs para: Stock objetivo almacén, Punto de reorden, Stock mín/máx
  - [ ] Validaciones de negocio (min < target < max)

- [ ] **Inventory Planning Page (Vista tipo Excel):**
  - [ ] Crear ruta `/planning` y agregar a navegación
  - [ ] Tabla principal con productos ordenados por tamaño
  - [ ] Columnas:
    * Producto & Tamaño
    * Stock Actual (Almacén)
    * Stock en Consignación (Total)
    * Promedio Consumo Mensual (calculado)
    * Stock Objetivo (configurable)
    * Punto de Reorden (configurable)
    * Cantidad Sugerida a Ordenar (objetivo - actual)
    * Acciones (Ajustar, Consignar)
  - [ ] Filtros: categoría, subcategoría, tamaño
  - [ ] Ordenamiento: por tamaño, stock, consumo
  - [ ] Indicadores visuales: rojo (bajo mínimo), amarillo (cerca de reorden), verde (OK)

#### Fase 2: Location-Specific Planning
- [ ] **Per-Location Targets:**
  - [ ] UI para configurar stock objetivo por producto/hospital
  - [ ] API endpoints CRUD para inventarioObjetivos
  - [ ] Vista de planificación filtrada por locación

- [ ] **Suggested Consignment Feature:**
  - [ ] Calcular sugerencias de consignación basado en:
    * Stock actual en hospital
    * Consumo promedio del hospital
    * Stock objetivo del hospital
    * Disponibilidad en almacén central
  - [ ] UI: Tabla de sugerencias con botón "Crear Consignación"
  - [ ] Acción: Pre-llenar formulario de consignación con cantidades sugeridas

- [ ] **Location Planning View:**
  - [ ] Selector de hospital/clínica
  - [ ] Tabla con productos y sus métricas para esa locación:
    * Stock actual en locación
    * Consumo mensual promedio en locación
    * Stock objetivo para locación
    * Días de cobertura restantes
    * Sugerencia de reposición

#### Fase 3: Advanced Analytics & Visualization
- [ ] **Consumption Charts:**
  - [ ] Gráfica de tendencia mensual (línea) por producto
  - [ ] Gráfica de consumo por tamaño (barras)
  - [ ] Comparación de consumo por locación (barras agrupadas)
  - [ ] Comparación año a año (líneas múltiples)

- [ ] **Analytics Dashboard:**
  - [ ] Widget: Top 10 productos más consumidos
  - [ ] Widget: Productos con mayor variación en consumo
  - [ ] Widget: Hospitales con mayor consumo
  - [ ] Widget: Predicción de necesidad de reorden (próximos 30 días)

- [ ] **Forecasting:**
  - [ ] Algoritmo simple de predicción basado en promedios móviles
  - [ ] Alertas predictivas: "Stock estimado a agotarse en X días"
  - [ ] Sugerencias de orden de compra al fabricante

- [ ] **Excel Export:**
  - [ ] Exportar vista de planificación a Excel
  - [ ] Exportar histórico de consumo mensual
  - [ ] Exportar comparativas por hospital
  - [ ] Formato similar al Excel original

#### Fase 4: Monthly Consumption Tracking View
- [ ] **Monthly Consumption Matrix:**
  - [ ] Tabla tipo Excel: Productos en filas, Meses en columnas
  - [ ] Mostrar consumo por mes para cada producto
  - [ ] Totales por producto y por mes
  - [ ] Filtro de año
  - [ ] Resaltar meses con consumo anormal (muy alto/bajo)

#### Data Migration (si es necesario)
- [ ] Importar datos históricos del Excel 2019-2025
- [ ] Script de importación de transacciones históricas
- [ ] Validación de datos importados
- [ ] Recalcular promedios basado en históricos

### 3. Mejorar UX de Selección de Lotes
- ✅ Ordenar lotes por fecha de vencimiento (FIFO)
- ✅ Indicadores visuales de estado (rojo=vencido, amarillo=por vencer, verde=bueno)
- Mostrar más información en el dropdown (cantidad, días hasta vencer)
- Sugerencia automática del mejor lote a usar

### 4. Búsqueda y Filtros
- Página de inventario: buscar por nombre de producto, código, lote
- Filtrar por categoría, estado, locación
- Ordenar por cantidad, vencimiento, fecha de recepción

### 5. Mejoras al Dashboard
- Gráficas de tendencias (tasa de consumo por mes)
- Alertas con acciones directas ("Ver productos por vencer")
- Indicadores clave: rotación de inventario, productos más consumidos
- Predicción de necesidad de reabastecimiento

### 6. Validaciones de Formularios
- ✅ Fecha de vencimiento debe ser futura (min=today)
- ✅ Validación de número de lote único
- ✅ Limpiar formulario al cerrar diálogo
- Validación de cantidades (no permitir 0 o negativos)
- Confirmar acciones destructivas (consumir productos caros)

## 🔧 Mejoras Técnicas

### 1. Optimización de Rendimiento
- Paginación en listas largas (productos, lotes, transacciones)
- Lazy loading de imágenes/componentes
- Cacheo inteligente de queries
- Debounce en búsquedas

### 2. Integridad de Datos
- Tarea programada para actualizar estado de lotes (EXPIRED)
- Validación de cantidades negativas en el backend
- Limpieza de registros huérfanos (inventario sin locación activa)
- Auditoría de inconsistencias en inventario

### 3. Seguridad
- Rate limiting en API endpoints
- Validación más estricta de permisos por rol
- Logs de auditoría de cambios críticos
- Encriptación de datos sensibles de pacientes

## 🎨 Mejoras de UX/UI

### 1. Estados Vacíos Mejorados
- Mensajes útiles con botones de acción
- Iconos ilustrativos
- Guías de primeros pasos para nuevos usuarios

### 2. Indicadores de Carga
- Skeletons en lugar de "Cargando..."
- Spinners en botones durante mutaciones
- Progress bars para operaciones largas

### 3. Feedback Visual
- ✅ Sistema de toasts implementado
- Confirmaciones antes de eliminar/desactivar
- Animaciones sutiles en transiciones
- Estados de error más claros

### 4. Responsive Design
- Optimizar para tablets
- Menú hamburguesa en móviles
- Tablas scrolleables en pantallas pequeñas

## 📊 Reportes y Analytics

### 1. Reportes Básicos
- Reporte de consumo por hospital (mensual)
- Reporte de productos por vencer
- Reporte de rotación de inventario
- Reporte de productos más consumidos

### 2. Exportación
- Exportar inventario a Excel
- Exportar transacciones a PDF
- Generar facturas/comprobantes de consignación

### 3. Analytics
- Dashboard de métricas clave
- Comparación mes a mes
- Proyecciones de consumo
- Alertas predictivas de stock bajo

## 🔐 Control de Acceso

### 1. Roles y Permisos
- Admin: acceso total
- Gerente de Almacén: recepciones, consignaciones
- Personal de Hospital: solo consumos
- Auditor: solo lectura

### 2. Restricciones por Locación
- Usuarios solo ven su locación asignada
- Multi-locación para supervisores

## 📱 Funcionalidades Avanzadas

### 1. Notificaciones
- Email cuando productos están por vencer
- Alertas de stock bajo
- Notificaciones de recepciones pendientes

### 2. Escaneo de Códigos
- Escanear código de barras de productos
- QR codes para lotes
- Integración con escáneres móviles

### 3. Integración con Otros Sistemas
- Sincronización con sistema de facturación
- Integración con ERP existente
- API para aplicaciones móviles

## 🐛 Bugs Conocidos (Resueltos)

- ✅ Fecha de vencimiento permite fechas pasadas
- ✅ No valida números de lote duplicados
- ✅ quantityConsigned puede volverse negativo en consumos
- ✅ Formularios no se limpian al cerrar diálogos
- ✅ Selects de categoría/tipo no funcionaban correctamente
- ✅ Mongoose populate errors (MissingSchemaError)
- ✅ TransactionHistory usando campos incorrectos del schema

---

**Última actualización:** 2026-01-07
**Próxima revisión:** Después de implementar Fase 1 de Planificación de Inventario

## 📝 Notas de Implementación

### Planificación de Inventario (2026-01-07)
Basado en análisis del Excel "Productos Vasculares a Consignación 2019-2025":
- **RESUMEN GNRAL**: Vista consolidada con stock objetivo y cantidades a reponer
- **Consumo por mes**: Matriz de consumo mensual por producto (2019-2025)
- **Hojas por Hospital**: Tracking de inventario y reposiciones por locación
- **Objetivo**: Replicar esta funcionalidad en la app con cálculos automáticos y analytics en tiempo real
