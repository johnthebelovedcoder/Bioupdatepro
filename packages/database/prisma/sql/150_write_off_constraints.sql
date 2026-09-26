-- BioAssetPro — inventory write-offs are approved (PCR-014).
--
-- PCR-014 is an "approved stock write-off". A write-off is requested as
-- PENDING, then posted or rejected once, by someone other than whoever
-- requested it (unless the company has chosen self-approval for a one-person
-- farm). A posted or rejected write-off never changes and is never deleted;
-- a mistake is corrected by a new document.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_write_off_controlled()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Write-off % is %; it cannot be deleted.', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Write-off % is %; it cannot change.', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id THEN
    RAISE EXCEPTION 'Write-off %: what was requested cannot be changed. Reject it and request again.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'POSTED'
     AND NEW.approved_by_id = NEW.created_by_id
     AND NOT (SELECT allow_self_approval FROM companies WHERE id = NEW.company_id) THEN
    RAISE EXCEPTION 'Write-off %: whoever requested it cannot approve it.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_write_off_controlled ON inventory_write_offs;
CREATE TRIGGER trg_write_off_controlled
  BEFORE UPDATE OR DELETE ON inventory_write_offs
  FOR EACH ROW EXECUTE FUNCTION bap_write_off_controlled();
