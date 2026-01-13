# Cómo Exportar Inventario de Lotes desde SAP B1

## Paso 1: Abrir el Administrador de Consultas

En SAP Business One Client:

1. Ir a: **Herramientas → Consultas → Administrador de consultas**
2. O presionar: `Alt + Q`

## Paso 2: Crear Nueva Consulta

1. Click en **"Añadir"** (o el botón +)
2. En el campo de consulta, pegar el siguiente SQL:

```sql
SELECT
    T0.ItemCode AS 'ItemCode',
    T0.BatchNum AS 'BatchNum',
    T0.WhsCode AS 'WhsCode',
    T0.BinAbs AS 'BinAbs',
    T0.Quantity AS 'Quantity',
    T1.ExpDate AS 'ExpDate',
    T2.BinCode AS 'BinCode'
FROM OIBT T0
INNER JOIN OBTN T1 ON T0.ItemCode = T1.ItemCode AND T0.BatchNum = T1.DistNumber
LEFT JOIN OBIN T2 ON T0.BinAbs = T2.AbsEntry
WHERE T0.Quantity > 0
  AND T0.ItemCode LIKE '419%'
ORDER BY T0.WhsCode, T2.BinCode, T0.ItemCode
```

> **Nota:** El filtro `T0.ItemCode LIKE '419%'` solo trae los stents Orsiro.
> Quitar esta línea para exportar TODO el inventario.

3. Click en **"Ejecutar"** para probar

## Paso 3: Exportar a Excel/CSV

1. Una vez ejecutada la consulta, verás los resultados
2. Click derecho en la tabla de resultados
3. Seleccionar **"Exportar → Excel"**
4. Guardar como: `oibt-export.xlsx`

## Paso 4: Convertir a CSV (si es necesario)

Si exportaste a Excel:

1. Abrir el archivo en Excel
2. **Archivo → Guardar como**
3. Seleccionar formato: **CSV (delimitado por comas)**
4. Guardar como: `oibt-export.csv`

## Paso 5: Importar en Vasculares

```bash
# Copiar el archivo al servidor
cp ~/Downloads/oibt-export.csv server/data/

# Previsualizar (sin cambios)
node scripts/import-inventory-csv.js data/oibt-export.csv --dry-run --verbose

# Importar
node scripts/import-inventory-csv.js data/oibt-export.csv
```

---

## Ejemplo de Datos Exportados

| ItemCode | BatchNum | WhsCode | BinAbs | Quantity | ExpDate | BinCode |
|----------|----------|---------|--------|----------|---------|---------|
| 419113 | 04244766 | 10 | 3 | 1 | 2026-06-24 | 10-CDC |
| 419113 | 07245012 | 10 | 4 | 2 | 2026-09-29 | 10-CECANOR |
| 419120 | 07245307 | 01 | NULL | 4 | 2027-01-15 | NULL |

---

## Consulta Alternativa (Más Simple)

Si la consulta anterior da error, usar esta versión simplificada:

```sql
SELECT
    ItemCode,
    BatchNum,
    WhsCode,
    Quantity
FROM OIBT
WHERE Quantity > 0
  AND ItemCode LIKE '419%'
ORDER BY WhsCode, ItemCode
```

Esta versión no incluye BinCode ni fecha de vencimiento, pero funciona en todas las versiones de SAP B1.

---

## Mapeo de Ubicaciones

| BinCode en SAP | BinAbs | Ubicación en Vasculares |
|----------------|--------|-------------------------|
| 10-CDC | 3 | CDC |
| 10-CECANOR | 4 | CECANOR |
| 10-INCAE | 37 | INCAE |
| 10-CENICARDIO | 38 | CENICARDIO |
| 10-CERECA | 40 | CERECA |
| (sin bin) | NULL | Almacén Principal |
