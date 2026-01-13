# Known Issues & Improvement Plan

**Created:** 2026-01-12
**Last Updated:** 2026-01-12

## Status Legend
- [ ] Not started
- [x] Completed
- [~] In progress

---

## CRITICAL ISSUES

### 1. [x] Retry Race Conditions - Duplicate SAP Documents
**Location:** `controllers/consumption.js:461-544`, `controllers/goodsReceipt.js:512-618`, `controllers/consignaciones.js:726-800`
**Risk:** HIGH - Two concurrent retry requests can both pass the "already synced" check and create duplicate SAP documents.
**Solution:** Add optimistic locking using MongoDB version field or atomic findOneAndUpdate with conditions.
**Fixed:** 2026-01-12 - Added atomic findOneAndUpdate with 'RETRYING' status to claim retry lock.

### 2. [x] GoodsReceipt Result Dialog Shows Success on Failure
**Location:** `client/src/pages/GoodsReceipt.jsx:689`
**Risk:** HIGH - Users think operation succeeded when SAP sync actually failed.
**Solution:** Check `receiptResult.sapResult?.success` before showing success icon.
**Fixed:** 2026-01-12 - Dialog now shows error icon and message when SAP sync fails.

### 3. [x] ConsumoModel Reference Mismatch
**Location:** `models/consumoModel.js`
**Risk:** HIGH - Uses `ref: 'Producto'` but collection is `'productos'` - populate() will fail.
**Solution:** Change ref to lowercase `'productos'`.
**Fixed:** 2026-01-12 - Changed refs to 'productos', 'lotes', 'locaciones'.

---

## HIGH PRIORITY ISSUES

### 4. [ ] Session Race Conditions in SAP Service
**Location:** `services/sapService.js:50-55, 105-109`
**Risk:** Multiple concurrent requests can trigger simultaneous login() calls, causing session confusion.
**Solution:** Implement login mutex/lock using Promise-based queue.

### 5. [ ] OData Filter Injection
**Location:** `services/sapService.js:193, 222, 261`
**Risk:** Unsanitized input in OData filter expressions could allow injection attacks.
**Solution:** Validate input format (alphanumeric only) or use parameterized queries.

### 6. [ ] No Idempotency Keys for Retries
**Location:** All retry functions
**Risk:** No way to detect/prevent duplicate requests.
**Solution:** Generate and store idempotency keys, check before creating SAP documents.

---

## MEDIUM PRIORITY ISSUES

### 7. [ ] Inconsistent SAP Field Names Across Models
**Location:** Multiple models
**Details:**
- `consumoModel` uses `sapSync.pushed`, `sapSync.sapDocEntry`
- `goodsReceiptModel` uses `sapIntegration.pushed`, `sapIntegration.docEntry`
- `consignacionModel` uses `sapDocNum`, `sapTransferStatus`
- `transaccionModel` uses `sapIntegration.pushed`
**Solution:** Standardize to single naming convention across all models.

### 8. [ ] No Request Timeouts in SAP Service
**Location:** `services/sapService.js:47`
**Risk:** Hung SAP connections block indefinitely.
**Solution:** Use AbortController with 30-second timeout.

### 9. [ ] Inconsistent Status Enums
**Location:** Multiple models
**Details:**
- `consumoModel.status`: ['PENDING', 'SYNCED', 'FAILED']
- `consignacionModel.sapTransferStatus`: ['PENDING', 'CREATED', 'FAILED']
- `goodsReceiptModel`: No status enum, only `pushed` boolean
**Solution:** Standardize SAP sync status across all models.

### 10. [ ] Missing Database Indexes for SAP Queries
**Location:** Multiple models
**Details:**
- `consignacionModel`: Missing `sapTransferStatus` index
- `consumoModel`: Missing `sapSync.pushed` index
- `goodsReceiptModel`: Missing `sapIntegration.pushed` index
**Solution:** Add indexes for frequently queried SAP fields.

### 11. [ ] Null vs 'PENDING' Default Inconsistency
**Location:** `consignacionModel.sapTransferStatus`
**Risk:** Queries for `sapTransferStatus === 'PENDING'` miss records with `null`.
**Solution:** Use consistent defaults or adjust queries.

### 12. [ ] No Retry Count Limits
**Location:** `consumption.js`, `consignaciones.js` retry functions
**Risk:** Users can retry indefinitely.
**Solution:** Add retryCount field and max retry limit (like goodsReceipt has).

---

## LOW PRIORITY ISSUES

### 13. [ ] TLS Certificate Validation Globally Disabled
**Location:** `services/sapService.js:9`
**Risk:** All HTTPS connections in the app are vulnerable to MITM attacks.
**Solution:** Use https.Agent with proper CA only for SAP requests.

### 14. [ ] SAP Credentials Exported
**Location:** `services/sapService.js:374`
**Risk:** SAP_CONFIG with credentials accessible from outside the service.
**Solution:** Don't export SAP_CONFIG, only export functions.

### 15. [ ] Toast Auto-Dismisses Errors Too Quickly
**Location:** `client/src/components/ui/toast.jsx`
**Risk:** SAP errors dismissed after 5 seconds, users might miss them.
**Solution:** Increase error toast duration to 10 seconds.

### 16. [ ] Debug Logging Exposes Sensitive Data
**Location:** `services/sapService.js:164, 345`
**Risk:** Full payloads with prices logged to stdout.
**Solution:** Only log in debug mode, redact sensitive fields.

### 17. [ ] No Connection Pooling for SAP
**Location:** `services/sapService.js`
**Risk:** Each request creates new TCP connection.
**Solution:** Create module-level https.Agent with keepAlive.

### 18. [ ] Session Duration Hardcoded
**Location:** `services/sapService.js:22`
**Risk:** Can't adjust without redeploying.
**Solution:** Move to environment variable.

---

## ARCHITECTURAL IMPROVEMENTS (Future)

### A. Implement SAP Document Lookup Before Creation
Query SAP to check if document already exists before creating new one in retry scenarios.

### B. Create Reconciliation Process
Background job to match orphaned SAP documents with local records.

### C. Centralized Error Handling
Create shared error handling utility for consistent SAP error processing.

### D. Implement Exponential Backoff for Retries
Add delay between retry attempts with increasing wait times.

### E. Add Error Analytics/Tracking
Log errors to monitoring service for visibility.

---

## Completion Tracking

| Priority | Total | Done | Remaining |
|----------|-------|------|-----------|
| Critical | 3 | 3 | 0 |
| High | 3 | 0 | 3 |
| Medium | 6 | 0 | 6 |
| Low | 6 | 0 | 6 |
| **Total** | **18** | **3** | **15** |
