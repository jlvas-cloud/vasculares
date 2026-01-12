# Known Issues & Future Improvements

## SAP Batch Validation (High Priority)

**Issue discovered:** 2026-01-12

**Problem:**
When creating lots locally (via packing list OCR or manual entry), there's no validation against SAP to verify the batch-item relationship. This can cause:
- Local lot linked to wrong product (e.g., batch `06251742` linked to item `419102` locally, but SAP has it as `419123`)
- Stock transfers fail with "No matching records found (ODBC -2028)"
- Data divergence between our system and SAP

**Root cause:**
Lots can be created without a formal goods receipt that syncs to SAP. The batch number exists in SAP with one ItemCode, but our system links it to a different product.

**Proposed solution:**
Before creating a lot with a batch number, query SAP:
```
GET /BatchNumberDetails?$filter=Batch eq '{batchNumber}'
```
If SAP returns an ItemCode, validate it matches our product's `sapItemCode`. If not, either:
1. Reject the creation with an error
2. Auto-correct to the SAP-linked product
3. Warn the user about the mismatch

**Affected flows:**
- Goods Receipt (packing list extraction)
- Manual lot creation
- Any flow that creates lots without SAP sync
