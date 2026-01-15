# Missing SAP Items

Last checked: 2026-01-15

These products exist in our database but their `sapItemCode` does not exist in SAP.
They need to be created in SAP before GoodsReceipts can be processed for them.

## Missing Items (2)

| Our Code | Product Name | SAP Code | Status |
|----------|--------------|----------|--------|
| 419102 | Orsiro Mission 2.5/9 | 419102 | Not in SAP |
| 419103 | Orsiro Mission 2.75/9 | 419103 | Not in SAP |

## How to Create in SAP

In SAP Business One:
1. Go to Inventory > Item Master Data
2. Create new item with:
   - ItemCode: (as listed above)
   - ItemName: (as listed above)
   - ManageBatchNumbers: Yes (tYES)
   - Set appropriate Item Group, Warehouse defaults, etc.

## Validation Summary

- **Total active products in database:** 92
- **Valid SAP codes:** 90
- **Invalid/Missing SAP codes:** 2

## Notes

- The "Orsiro Mission" line appears to be newer products
- SAP has older "Orsiro" products (without "Mission") like 364471 for 2.75/9
- These /9 (9mm length) variants in the Mission line are missing
