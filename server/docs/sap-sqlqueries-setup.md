# SAP Service Layer - SQLQueries Setup for Inventory Sync

**Date:** 2026-01-13
**Environment:** SAP Business One on Microsoft SQL Server
**SAP Partner Contact:** Winder Mejia Ortiz

---

## Overview

This document details how to enable access to batch inventory tables (OIBT, OBBQ) via SAP B1 Service Layer for inventory synchronization.

---

## The Problem

SAP B1 Service Layer does NOT expose batch inventory data by default:

| What We Tried | Result |
|---------------|--------|
| `BatchNumberDetails` endpoint | Returns batch master data but NO quantity or warehouse |
| `ItemWarehouseInfoCollection` | Returns warehouse totals but NO batch breakdown |
| `sml.svc/OIBT` (Semantic Layer) | Error 805: "Semantic Layer not enabled" |

**Root Cause:** The Semantic Layer (`sml.svc`) is **HANA-only**. Our SAP B1 runs on Microsoft SQL Server.

---

## The Solution

For SAP B1 on SQL Server, use the **SQLQueries endpoint** with **AllowList configuration**.

### Tables Required

| Table | Purpose | Data |
|-------|---------|------|
| `OIBT` | Batch inventory by warehouse | ItemCode, BatchNum, WhsCode, Quantity |
| `OBBQ` | Batch quantities by bin | ItemCode, SnBMDAbs, BinAbs, WhsCode, OnHandQty |
| `OBTN` | Batch master data | AbsEntry, ItemCode, DistNumber (batch#), ExpDate |
| `OBIN` | Bin locations | AbsEntry, BinCode |

### How The Tables Relate

```
OIBT (warehouse level)
  └── BatchNum links to OBTN.DistNumber

OBBQ (bin level)
  └── SnBMDAbs links to OBTN.AbsEntry
  └── BinAbs links to OBIN.AbsEntry
```

---

## Configuration Steps (For SAP Partner)

### Step 1: Locate the AllowList Configuration File

On the SAP server, find:
```
C:\Program Files\SAP\SAP Business One ServerTools\ServiceLayer\conf\b1s_sqltable.conf
```

### Step 2: Add Tables to the AllowList

Open `b1s_sqltable.conf` and find the `"TableList"` array. Add these tables if not present:

```json
"TableList": [
  ... existing tables ...
  "OIBT",
  "OBBQ",
  "OBTN",
  "OBIN",
  ...
]
```

**Note:** OBTN and OBIN may already be in the list. Only add what's missing.

### Step 3: Restart Service Layer

```powershell
Restart-Service "SAP Business One Service Layer"
```

Or restart via Windows Services Manager.

### Step 4: Verify Access

Test with this curl command:

```bash
# Login
curl -k -X POST "https://[SERVER]:50000/b1s/v1/Login" \
  -H "Content-Type: application/json" \
  -d '{"CompanyDB":"[COMPANY_DB]","UserName":"[USER]","Password":"[PASS]"}' \
  -c /tmp/sap_cookies.txt

# Test OIBT query
curl -k -X POST "https://[SERVER]:50000/b1s/v1/SQLQueries" \
  -H "Content-Type: application/json" \
  -d '{"SqlCode":"TestOIBT","SqlName":"Test","SqlText":"SELECT TOP 5 ItemCode, BatchNum, WhsCode, Quantity FROM OIBT WHERE Quantity > 0"}' \
  -b /tmp/sap_cookies.txt

# Execute the query
curl -k -X POST "https://[SERVER]:50000/b1s/v1/SQLQueries('TestOIBT')/List" \
  -H "Content-Type: application/json" \
  -b /tmp/sap_cookies.txt
```

**Expected:** JSON array with batch inventory data.

**If you get "Table 'OIBT' not accessible":** The table is not in the AllowList.

---

## SQL Queries Used

### Query 1: Warehouse Inventory (OIBT)

For locations WITHOUT bin management (e.g., warehouse 01):

```sql
SELECT T0.ItemCode, T0.BatchNum, T0.WhsCode, T0.Quantity, T1.ExpDate
FROM OIBT T0
INNER JOIN OBTN T1 ON T0.ItemCode = T1.ItemCode AND T0.BatchNum = T1.DistNumber
WHERE T0.Quantity > 0
  AND T0.ItemCode LIKE '419%'
  AND T0.WhsCode = '01'
ORDER BY T0.ItemCode
```

### Query 2: Bin-Level Inventory (OBBQ)

For locations WITH bin management (e.g., centros in warehouse 10):

```sql
SELECT T0.ItemCode, T1.DistNumber AS BatchNum, T0.WhsCode, T0.BinAbs, T2.BinCode,
       T0.OnHandQty AS Quantity, T1.ExpDate
FROM OBBQ T0
INNER JOIN OBTN T1 ON T0.SnBMDAbs = T1.AbsEntry
LEFT JOIN OBIN T2 ON T0.BinAbs = T2.AbsEntry
WHERE T0.OnHandQty > 0
  AND T0.ItemCode LIKE '419%'
  AND T0.BinAbs = 3  -- CDC bin
ORDER BY T0.ItemCode
```

### Query 3: List All Bins with Stock

```sql
SELECT DISTINCT T0.BinAbs, T2.BinCode, COUNT(*) AS BatchCount, SUM(T0.OnHandQty) AS TotalQty
FROM OBBQ T0
LEFT JOIN OBIN T2 ON T0.BinAbs = T2.AbsEntry
WHERE T0.OnHandQty > 0 AND T0.ItemCode LIKE '419%'
GROUP BY T0.BinAbs, T2.BinCode
ORDER BY T0.BinAbs
```

---

## Bin Location Mapping

| BinAbs | BinCode | Location Name |
|--------|---------|---------------|
| 3 | 10-CDC | CDC |
| 4 | 10-CECANOR | CECANOR |
| 17 | 10-PROV | PROV |
| 37 | 10-INCAE | INCAE |
| 38 | 10-CENICARDIO | CENICARDIO |
| 40 | 10-CERECA | CERECA |

---

## Alternative: B1SLQuery Views (Did Not Work)

We also tried creating SQL views with the `B1SLQuery` suffix:

```sql
CREATE VIEW [dbo].[OIBT_InventoryB1SLQuery] AS
SELECT T0.ItemCode, T0.BatchNum, T0.WhsCode, T0.Quantity, T1.ExpDate
FROM OIBT T0
INNER JOIN OBTN T1 ON T0.ItemCode = T1.ItemCode AND T0.BatchNum = T1.DistNumber
WHERE T0.Quantity > 0
```

**Result:** View was created and worked in SAP Client, but Service Layer did not auto-detect it. The `GET /SQLQueries` endpoint returned empty.

**Conclusion:** B1SLQuery auto-detection may require additional Service Layer configuration beyond our scope. The AllowList approach is simpler and works reliably.

---

## Troubleshooting

### Error: "Table 'OIBT' not accessible"

**Cause:** Table not in AllowList.
**Solution:** Add OIBT to `b1s_sqltable.conf` and restart Service Layer.

### Error: "Semantic Layer exposure is not enabled" (805)

**Cause:** Using `sml.svc` endpoint on SQL Server.
**Solution:** Semantic Layer is HANA-only. Use SQLQueries endpoint instead.

### Error: "Column 'BinAbs' from table 'OIBT' not exist"

**Cause:** OIBT doesn't have bin information; it's warehouse-level only.
**Solution:** Use OBBQ table for bin-level data.

### SQLQueries returns empty array

**Cause:** No B1SLQuery views registered or feature not enabled.
**Solution:** Use AllowList approach instead of B1SLQuery views.

### SQLQueries returns only 20 records (pagination issue)

**Cause:** SAP Service Layer **ignores `$top` and `$skip`** parameters for SQLQueries endpoint. Default page size is 20 records.

**Solution:** Follow `odata.nextLink` in the response to get all pages.

**Wrong approach (doesn't work):**
```javascript
// BAD - SAP ignores $top and $skip for SQLQueries
const url = `${baseUrl}/SQLQueries('MyQuery')/List?$top=100&$skip=20`;
```

**Correct approach:**
```javascript
// GOOD - Follow odata.nextLink for pagination
let url = `${baseUrl}/SQLQueries('MyQuery')/List`;
let allResults = [];

while (url) {
  const response = await fetch(url, { method: 'POST', headers });
  const data = await response.json();

  allResults.push(...(data.value || []));

  // Get next page URL from odata.nextLink
  const nextLink = data['odata.nextLink'];
  if (nextLink) {
    // nextLink can be relative or absolute
    url = nextLink.startsWith('http') ? nextLink : `${baseUrl}/${nextLink}`;
  } else {
    url = null;
  }
}
```

**Symptoms of this bug:**
- Query returns exactly 20 records even when more exist
- COUNT(*) shows more records than query returns
- Different locations show same number of batches (20)

---

## Files Updated in Our Application

| File | Changes |
|------|---------|
| `services/sapSyncService.js` | Added `executeSQLQuery()`, `getBatchInventoryFromOIBT()`, `getBatchInventoryByBin()` |
| `scripts/sync-inventory-from-sap.js` | Updated to use bin-specific queries for each location |

---

## Production Deployment Checklist

When deploying to production SAP:

- [ ] Contact SAP partner
- [ ] Request OIBT be added to AllowList in `b1s_sqltable.conf`
- [ ] Verify OBBQ, OBTN, OBIN are also accessible
- [ ] Restart Service Layer
- [ ] Test with: `node scripts/sync-inventory-from-sap.js --dry-run`
- [ ] Run full sync: `node scripts/sync-inventory-from-sap.js`

---

## Contact Information

**Demo Server:**
- URL: https://94.74.64.47:50000/b1s/v1
- Database: HOSPAL_ENERO
- User: Profes02

**SAP Partner:** Winder Mejia Ortiz
- Added OIBT to AllowList on 2026-01-13

---

## References

- [SAP Community - SQL Query Feature](https://community.sap.com/t5/enterprise-resource-planning-blogs-by-sap/service-layer-sql-query-feature/ba-p/13462991)
- [SAP Help - Working with Service Layer](https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf)
