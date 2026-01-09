# SAP B1 Batch/Lot Tracking - Technical Reference

## Overview

This document explains how to access batch (lot) information from SAP Business One Service Layer API. This is critical for tracking medical device inventory where lot numbers and expiry dates are required.

## The Problem

When querying `PurchaseDeliveryNotes` (Goods Receipt PO / Entrada de Mercancía), the `BatchNumbers` array in `DocumentLines` is **always empty**, even for items with batch tracking enabled.

```javascript
// Example: PurchaseDeliveryNotes response
{
  "DocNum": 4411,
  "DocDate": "2024-07-05T00:00:00Z",
  "DocumentLines": [{
    "ItemCode": "364514",
    "Quantity": 3,
    "BatchNumbers": []  // Always empty!
  }]
}
```

This is a known behavior in SAP B1 Service Layer - batch information is stored separately.

---

## The Solution

Query the `BatchNumberDetails` entity, filtering by `ItemCode` and `AdmissionDate` (which matches the document date).

### BatchNumberDetails Entity

**Endpoint**: `GET /b1s/v1/BatchNumberDetails`

**Key Fields**:
| Field | Type | Description |
|-------|------|-------------|
| DocEntry | Number | Unique batch ID |
| ItemCode | String | SAP item code |
| ItemDescription | String | Item name |
| Batch | String | Lot/batch number |
| AdmissionDate | DateTime | Date batch was received |
| ExpirationDate | DateTime | Expiry date |
| Status | String | `bdsStatus_Released`, `bdsStatus_NotAccessible`, etc. |
| SystemNumber | Number | Internal sequence number |

### Query Pattern

```
GET /b1s/v1/BatchNumberDetails
  ?$filter=ItemCode eq '{itemCode}' and AdmissionDate eq '{YYYY-MM-DD}'
```

### Example

```bash
# Get batches for item 364514 received on July 5, 2024
curl -X GET "https://94.74.64.47:50000/b1s/v1/BatchNumberDetails?\$filter=ItemCode eq '364514' and AdmissionDate eq '2024-07-05'" \
  -H "Cookie: B1SESSION={sessionId}"
```

**Response**:
```json
{
  "value": [{
    "DocEntry": 18215,
    "ItemCode": "364514",
    "ItemDescription": "Stent Coronario Medicado Orsiro 3.0/30",
    "Batch": "03243463",
    "AdmissionDate": "2024-07-05T00:00:00Z",
    "ExpirationDate": "2026-05-14T00:00:00Z",
    "Status": "bdsStatus_Released"
  }]
}
```

---

## Implementation in Vasculares

### Server Code: `server/controllers/sap.js`

```javascript
/**
 * Helper to fetch batch details from BatchNumberDetails table
 */
async function fetchBatchDetails(itemCode, admissionDate, sessionId) {
  const url = `${SAP_CONFIG.serviceUrl}/BatchNumberDetails?$filter=ItemCode eq '${itemCode}' and AdmissionDate eq '${admissionDate}'`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `B1SESSION=${sessionId}`,
    },
  });

  const data = await response.json();
  return (data.value || []).map(b => ({
    batchNumber: b.Batch,
    expiryDate: b.ExpirationDate,
    admissionDate: b.AdmissionDate,
  }));
}
```

### Arrivals Endpoint Flow

1. Query `PurchaseDeliveryNotes` for goods receipts
2. For each document line:
   - Extract `DocDate` (YYYY-MM-DD format)
   - Query `BatchNumberDetails` by `ItemCode` + `AdmissionDate`
   - Map batch info to the response
3. If multiple batches found, distribute line quantity evenly

---

## Other SAP Entities Reference

### Items (Products)

**Endpoint**: `GET /b1s/v1/Items('{ItemCode}')`

**Check if batch-managed**:
```javascript
// ManageBatchNumbers: "tYES" = batch tracked
GET /b1s/v1/Items('364514')?$select=ItemCode,ItemName,ManageBatchNumbers
```

### Warehouse Stock (No Batch Detail)

**Endpoint**: `GET /b1s/v1/Items('{ItemCode}')?$select=ItemWarehouseInfoCollection`

Returns total `InStock` per warehouse, but **no batch breakdown**.

### BusinessPartners (Suppliers)

**Endpoint**: `GET /b1s/v1/BusinessPartners`

```
GET /b1s/v1/BusinessPartners
  ?$filter=CardType eq 'cSupplier'
  &$select=CardCode,CardName
```

**Example Suppliers**:
| CardCode | CardName |
|----------|----------|
| P00031 | CentralMed, S.A. |

### Warehouses

**Endpoint**: `GET /b1s/v1/Warehouses`

| Code | Name | Usage |
|------|------|-------|
| 01 | Principal | Main warehouse |
| 10 | Consignacion | Consignment (has bin locations) |

### Bin Locations (Centros)

**Endpoint**: `GET /b1s/v1/BinLocations`

```
GET /b1s/v1/BinLocations?$filter=Warehouse eq '10'
```

| AbsEntry | BinCode | Description |
|----------|---------|-------------|
| 4 | 10-CECANOR | Cecanor |
| 3 | 10-CDC | CDC |
| 37 | 10-INCAE | INCAE |

---

## Limitations

### 1. No Quantity per Batch
`BatchNumberDetails` doesn't store quantity. When multiple batches exist for the same item on the same date, we distribute the line quantity evenly (best approximation).

### 2. Same-Day Ambiguity
If multiple arrivals occur on the same day for the same item, we cannot distinguish which batches belong to which document.

### 3. Semantic Layer Not Enabled
Direct SQL queries via `sml.svc` are not available (error 805). Must use OData entities.

### 4. OIBT Table Not Exposed
The `OIBT` table (Item Batch Numbers by Warehouse with quantities) is not directly accessible via Service Layer.

---

## SAP Connection Details

```
Server: https://94.74.64.47:50000/b1s/v1
Company DB: HOSPAL_TESTING (test) / TBD (production)
Username: Profes02
Session Timeout: 30 minutes
```

### Authentication

```bash
# Login
POST /b1s/v1/Login
Content-Type: application/json

{
  "CompanyDB": "HOSPAL_TESTING",
  "UserName": "Profes02",
  "Password": "****"
}

# Response includes SessionId in cookie
# Use: Cookie: B1SESSION={SessionId}
```

---

## Testing Commands

```bash
# Login and save session
curl -k -X POST "https://94.74.64.47:50000/b1s/v1/Login" \
  -H "Content-Type: application/json" \
  -d '{"CompanyDB":"HOSPAL_TESTING","UserName":"Profes02","Password":"****"}' \
  -c /tmp/sap_cookies.txt

# Query batch details
curl -k -X GET "https://94.74.64.47:50000/b1s/v1/BatchNumberDetails?\$filter=ItemCode eq '364514' and AdmissionDate eq '2024-07-05'" \
  -b /tmp/sap_cookies.txt

# Query arrivals from supplier
curl -k -X GET "https://94.74.64.47:50000/b1s/v1/PurchaseDeliveryNotes?\$filter=CardCode eq 'P00031' and DocDate ge '2024-07-01'&\$top=10" \
  -b /tmp/sap_cookies.txt
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `server/services/sapService.js` | SAP API client, session management |
| `server/controllers/sap.js` | SAP endpoints including `getArrivals` with batch lookup |
| `client/src/pages/SapArrivals.jsx` | Frontend for viewing/importing arrivals |

---

## Change History

| Date | Change |
|------|--------|
| 2025-01-09 | Initial batch tracking via BatchNumberDetails implemented |
| 2025-01-09 | Arrivals endpoint enhanced to query batch info |
