-- BioAssetPro — stock counts (INT-009).
--
-- SYSTEM_INTEGRITY_MATRIX INT-009: a count adjustment needs an "approved
-- count, reason and variance evidence" and must never be a "silent overwrite
-- of book quantity", with a "count freeze, recount threshold and period
-- check" and "counter is not approver".
--
-- 1. The freeze. While a store has an open count (counting, submitted or on
--    hold), no stock moves into or out of it except the count's own
--    adjustment. The book quantities the count was frozen against stay true.
-- 2. The frozen book is fixed: a line's book quantity and cost never change.
-- 3. A posted or cancelled count is closed: nothing on it changes again.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_stock_count_freeze()
RETURNS TRIGGER AS $$
DECLARE
  open_reference TEXT;
BEGIN
  IF NEW.source_document_type = 'StockCount' THEN
    RETURN NEW;
  END IF;
  SELECT reference INTO open_reference
    FROM stock_counts
   WHERE company_id = NEW.company_id
     AND warehouse_id = NEW.warehouse_id
     AND status IN ('COUNTING', 'SUBMITTED', 'ON_HOLD')
   LIMIT 1;
  IF open_reference IS NOT NULL THEN
    RAISE EXCEPTION 'This store is frozen for stock count %: nothing moves in or out until the count is posted or cancelled.', open_reference
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_count_freeze ON stock_movements;
CREATE TRIGGER trg_stock_count_freeze
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION bap_stock_count_freeze();

CREATE OR REPLACE FUNCTION bap_stock_count_closed()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Stock count % is %; it cannot be deleted.', OLD.reference, OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('POSTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Stock count % is %; it cannot change.', OLD.reference, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at OR NEW.started_by_id IS DISTINCT FROM OLD.started_by_id THEN
    RAISE EXCEPTION 'Stock count %: the store and freeze time are fixed.', OLD.reference USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_count_closed ON stock_counts;
CREATE TRIGGER trg_stock_count_closed
  BEFORE UPDATE OR DELETE ON stock_counts
  FOR EACH ROW EXECUTE FUNCTION bap_stock_count_closed();

CREATE OR REPLACE FUNCTION bap_stock_count_line_fixed()
RETURNS TRIGGER AS $$
DECLARE
  count_status TEXT;
BEGIN
  SELECT status INTO count_status FROM stock_counts WHERE id = COALESCE(NEW.stock_count_id, OLD.stock_count_id);
  IF count_status IN ('POSTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'That stock count is %; its lines cannot change.', count_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.book_quantity IS DISTINCT FROM OLD.book_quantity
      OR NEW.unit_cost_kobo IS DISTINCT FROM OLD.unit_cost_kobo
      OR NEW.item_id IS DISTINCT FROM OLD.item_id) THEN
    RAISE EXCEPTION 'The frozen book quantity and cost of a count line never change.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_count_line_fixed ON stock_count_lines;
CREATE TRIGGER trg_stock_count_line_fixed
  BEFORE UPDATE OR DELETE ON stock_count_lines
  FOR EACH ROW EXECUTE FUNCTION bap_stock_count_line_fixed();
