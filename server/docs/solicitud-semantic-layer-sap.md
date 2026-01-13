# Solicitud: Habilitar Consultas SQL para OIBT en SAP B1 Service Layer

**Fecha:** 2026-01-13 (actualizado)
**Solicitante:** José Luis Vásquez
**Sistema:** SAP Business One - HOSPAL_ENERO (Microsoft SQL Server)
**Servidor Service Layer:** https://94.74.64.47:50000/b1s/v1

---

## Resumen Ejecutivo

Necesitamos acceder a la tabla **OIBT** (inventario de lotes por almacén/ubicación) vía Service Layer para nuestra integración de gestión de inventario de dispositivos médicos.

**Nota Importante:** Nuestro SAP B1 usa Microsoft SQL Server (no HANA), por lo que el Semantic Layer (sml.svc) no está disponible. La alternativa es usar el endpoint **SQLQueries**.

---

## Contexto Técnico

Estamos desarrollando un sistema de gestión de inventario que se integra con SAP B1 vía Service Layer. Actualmente podemos:

- ✓ Crear transferencias de stock (StockTransfers)
- ✓ Crear notas de entrega (DeliveryNotes)
- ✓ Consultar maestro de artículos (Items)
- ✓ Consultar socios de negocio (BusinessPartners)

**Problema:** No podemos consultar el inventario de lotes por ubicación (bin location) porque la tabla OIBT no está accesible vía Service Layer.

### Error Actual

```json
GET /b1s/v1/sml.svc/OIBT

{
  "error": {
    "code": "805",
    "message": "Semantic Layer exposure is not enabled."
  }
}
```

Este error es esperado porque el Semantic Layer es solo para SAP B1 HANA.

---

## Solicitud Específica

### Opción 1: Habilitar SQLQueries con AllowList (Recomendada)

Necesitamos:

1. **Agregar la tabla OIBT al AllowList** del Service Layer
2. **Crear una SQL Query** que podamos ejecutar vía API

#### Datos que necesitamos de OIBT:

| Campo | Descripción |
|-------|-------------|
| ItemCode | Código del artículo |
| BatchNum | Número de lote |
| WhsCode | Código de almacén |
| BinAbs | ID de ubicación (bin) |
| Quantity | Cantidad en stock |

#### Query SQL Requerida:

```sql
SELECT
    T0.ItemCode,
    T0.BatchNum,
    T0.WhsCode,
    T0.BinAbs,
    T0.Quantity,
    T1.ExpDate
FROM OIBT T0
INNER JOIN OBTN T1 ON T0.ItemCode = T1.ItemCode AND T0.BatchNum = T1.DistNumber
WHERE T0.Quantity > 0
  AND T0.ItemCode LIKE '419%'
ORDER BY T0.WhsCode, T0.ItemCode
```

### Opción 2: Crear Vista SQL con sufijo B1SLQuery

Alternativamente, se puede crear una vista en SQL Server que termine en "B1SLQuery":

```sql
CREATE VIEW [dbo].[OIBT_InventoryB1SLQuery] AS
SELECT
    T0.ItemCode,
    T0.BatchNum,
    T0.WhsCode,
    T0.BinAbs,
    T0.Quantity,
    T1.ExpDate
FROM OIBT T0
INNER JOIN OBTN T1 ON T0.ItemCode = T1.ItemCode AND T0.BatchNum = T1.DistNumber
WHERE T0.Quantity > 0
```

Esta vista quedaría expuesta automáticamente en el endpoint SQLQueries.

---

## Pasos de Configuración

### Para SQLQueries con AllowList

1. En el servidor, editar el archivo:
   ```
   C:\Program Files\SAP\SAP Business One ServerTools\ServiceLayer\conf\b1s.conf
   ```

2. Agregar/modificar la sección AllowList:
   ```xml
   <AllowList>
     <Query Category="General">
       <Table>OIBT</Table>
       <Table>OBTN</Table>
       <Table>OBIN</Table>
     </Query>
   </AllowList>
   ```

3. Reiniciar Service Layer:
   ```powershell
   Restart-Service "SAP Business One Service Layer"
   ```

### Para Vista B1SLQuery

1. Abrir SQL Server Management Studio
2. Conectar a la base de datos HOSPAL_ENERO
3. Ejecutar el CREATE VIEW anterior
4. La vista aparecerá automáticamente en SQLQueries

---

## Verificación

Una vez configurado, podremos verificar con:

```bash
# Listar queries disponibles
GET /b1s/v1/SQLQueries

# Ejecutar query de inventario
POST /b1s/v1/SQLQueries('OIBT_InventoryB1SLQuery')/List
```

---

## Impacto en el Negocio

| Sin acceso a OIBT | Con acceso a OIBT |
|-------------------|-------------------|
| Carga inicial manual (CSV) | Sincronización automática |
| No podemos verificar discrepancias | Reconciliación completa |
| Proceso manual para re-sincronizar | Sincronización con un click |

---

## Seguridad

- SQLQueries respeta los permisos de usuario de SAP B1
- Solo usuarios autenticados pueden acceder
- AllowList limita qué tablas pueden consultarse

---

## Contacto para Dudas Técnicas

**Sistema:** Vasculares - Gestión de Inventario
**Integración:** Node.js + SAP B1 Service Layer
**Usuario SAP:** Profes02 (Superusuario)

---

## Referencias

- [SAP Community - SQL Query Feature in Service Layer](https://community.sap.com/t5/enterprise-resource-planning-blogs-by-sap/service-layer-sql-query-feature/ba-p/13462991)
- [SAP Help - Working with Service Layer](https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf)
- [SAP Note 2620790 - Service Layer Configuration](https://launchpad.support.sap.com/)
