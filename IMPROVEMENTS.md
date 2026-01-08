# Vasculares - Mejoras Pendientes

## 🎯 Alto Impacto - Próximas Tareas

### 1. Página de Historial de Transacciones
- Ver todos los movimientos (recepciones, consignaciones, consumos)
- Filtrar por fecha, producto, locación, tipo de transacción
- Exportar a Excel/PDF
- Ver detalles completos de cada transacción (doctor, paciente, procedimiento)

### 2. Mejorar UX de Selección de Lotes
- ✅ Ordenar lotes por fecha de vencimiento (FIFO)
- ✅ Indicadores visuales de estado (rojo=vencido, amarillo=por vencer, verde=bueno)
- Mostrar más información en el dropdown (cantidad, días hasta vencer)
- Sugerencia automática del mejor lote a usar

### 3. Búsqueda y Filtros
- Página de inventario: buscar por nombre de producto, código, lote
- Filtrar por categoría, estado, locación
- Ordenar por cantidad, vencimiento, fecha de recepción

### 4. Mejoras al Dashboard
- Gráficas de tendencias (tasa de consumo por mes)
- Alertas con acciones directas ("Ver productos por vencer")
- Indicadores clave: rotación de inventario, productos más consumidos
- Predicción de necesidad de reabastecimiento

### 5. Validaciones de Formularios
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

---

**Última actualización:** 2026-01-07
**Próxima revisión:** Después de implementar historial de transacciones
