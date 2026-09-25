-- BioAssetPro — joint-cost prices are approved once and then fixed.
--
-- Handbook §62.5: selling-price and further-processing assumptions "require
-- approval, effective dates and audit history because they drive joint-cost
-- allocation". A proposed price may be approved or rejected, once, by someone
-- other than whoever proposed it (unless the company has chosen self-approval
-- for a one-person farm). An approved price is never edited or deleted: a
-- change is a new price from a later date, so every past allocation can be
-- traced to the price it used.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_joint_price_controlled()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'APPROVED' THEN
      RAISE EXCEPTION 'Approved joint-cost price % cannot be deleted. Propose a new price from a later date.', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.selling_price_per_unit_kobo IS DISTINCT FROM OLD.selling_price_per_unit_kobo
     OR NEW.further_cost_per_unit_kobo IS DISTINCT FROM OLD.further_cost_per_unit_kobo
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
     OR NEW.proposed_by_id IS DISTINCT FROM OLD.proposed_by_id THEN
    RAISE EXCEPTION 'Joint-cost price % cannot be changed once proposed. Propose a new one.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Joint-cost price % was already %.', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'APPROVED' AND OLD.status = 'PENDING'
     AND NEW.approved_by_id = NEW.proposed_by_id
     AND NOT (SELECT allow_self_approval FROM companies WHERE id = NEW.company_id) THEN
    RAISE EXCEPTION 'Joint-cost price %: whoever proposed it cannot approve it.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_joint_price_controlled ON joint_output_prices;
CREATE TRIGGER trg_joint_price_controlled
  BEFORE UPDATE OR DELETE ON joint_output_prices
  FOR EACH ROW EXECUTE FUNCTION bap_joint_price_controlled();
