# SAP SQLQueries AllowList Configuration

This document tracks all SAP tables that need to be added to `b1s_sqltable.conf` for full functionality.

## Current Status (Tested 2026-01-14)

| Table | HOSPAL_ENERO | Production | Used For |
|-------|--------------|------------|----------|
| OIBT | ✓ Available | TBD | Inventory sync |
| OBTN | ✓ Available | TBD | Inventory sync |
| OPDN | ✓ Available | TBD | Reconciliation (Goods Receipts) |
| PDN1 | ✓ Available | TBD | Reconciliation (Goods Receipts) |
| ODLN | ✓ Available | TBD | Reconciliation (Consumptions) |
| DLN1 | ✓ Available | TBD | Reconciliation (Consumptions) |
| OWTR | ✗ Not allowed | TBD | Reconciliation (Stock Transfers) |
| WTR1 | ✗ Not allowed | TBD | Reconciliation (Stock Transfers) |
| IBT1 | ✗ Not allowed | TBD | Batch info in documents |

## How to Request (for Production)

Send this to the SAP partner (Winder):

```
Por favor agregar las siguientes tablas a b1s_sqltable.conf en la sección TableList:

  "OIBT",
  "OBTN",
  "OPDN",
  "PDN1",
  "OWTR",
  "WTR1",
  "ODLN",
  "DLN1",
  "IBT1",

Pueden agregarlas al final de la lista existente.
```

## Table Reference

### Inventory Sync (Required)

| Table | Description | Used For |
|-------|-------------|----------|
| OIBT | Item Batch Numbers by Warehouse | Query batch stock levels |
| OBTN | Batch Number Master Data | Batch expiry dates, attributes |

### Reconciliation Optimization (Optional but Recommended)

These tables enable server-side filtering for reconciliation queries. Without them, the system falls back to OData (works but less efficient).

| Table | Description | Status in HOSPAL_ENERO |
|-------|-------------|------------------------|
| OPDN | Purchase Delivery Notes (Header) | ✓ Already available |
| PDN1 | Purchase Delivery Notes (Lines) | ✓ Already available |
| OWTR | Stock Transfers (Header) | ✗ Needs AllowList |
| WTR1 | Stock Transfers (Lines) | ✗ Needs AllowList |
| ODLN | Delivery Notes (Header) | ✓ Already available |
| DLN1 | Delivery Notes (Lines) | ✓ Already available |
| IBT1 | Batch Allocations in Documents | ✗ Needs AllowList |

**Note:** OPDN, PDN1, ODLN, DLN1 appear to be in the default AllowList. Only OWTR, WTR1, IBT1 need to be requested.

## File Location on SAP Server

```
C:\Program Files\SAP\SAP Business One ServerTools\ServiceLayer\b1s_sqltable.conf
```

After editing, restart the SAP Service Layer service.

## Notes

- SQLQueries endpoint only allows queries on tables listed in `b1s_sqltable.conf`
- Tables not in the list will return "Table not allowed" error
- The app has fallback logic for reconciliation - OData works without these tables
- For production setup, request ALL tables at once to minimize requests

## History

| Date | Tables Added | Database | Requested By |
|------|--------------|----------|--------------|
| 2026-01-13 | OIBT, OBTN | HOSPAL_ENERO | JL |
| TBD | OPDN, PDN1, OWTR, WTR1, ODLN, DLN1, IBT1 | Production | - |
