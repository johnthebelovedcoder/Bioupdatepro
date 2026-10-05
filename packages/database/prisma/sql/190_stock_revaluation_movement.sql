-- BioAssetPro — a supplier invoice priced differently from its goods receipt
-- revalues the stock it paid for. The revaluation is a stock movement with a
-- value and no quantity, so the stock ledger keeps agreeing with the inventory
-- control account. Every other movement still needs a positive quantity.
--
-- Idempotent: safe to re-run.

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_chk;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_chk
  CHECK (
    (quantity > 0 OR (quantity = 0 AND source_document_type = 'SupplierInvoicePriceDifference'))
    AND unit_cost_kobo >= 0 AND value_kobo >= 0
  );
