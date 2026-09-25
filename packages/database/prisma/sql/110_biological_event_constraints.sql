-- BioAssetPro — biological events are history, not editable fields.
--
-- SNAIL_WEIGHT_HISTORY / POULTRY_WEIGHT_HISTORY: "Weights are event history,
-- not overwritten master fields." A weighing's measurement — when, how many,
-- what they weighed, at what stage and age — is fixed once recorded. Only its
-- review may change: PENDING to APPROVED or REJECTED, once, and whether it is
-- the batch's current weighing. A wrong weighing is rejected and a new one
-- recorded; nothing is deleted.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_weighing_is_history()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Weighing % is history and cannot be deleted. Reject it instead.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.weighed_on IS DISTINCT FROM OLD.weighed_on
     OR NEW.stage IS DISTINCT FROM OLD.stage
     OR NEW.age_days IS DISTINCT FROM OLD.age_days
     OR NEW.sample_size IS DISTINCT FROM OLD.sample_size
     OR NEW.total_sample_weight_grams IS DISTINCT FROM OLD.total_sample_weight_grams
     OR NEW.average_weight_grams IS DISTINCT FROM OLD.average_weight_grams
     OR NEW.target_weight_grams IS DISTINCT FROM OLD.target_weight_grams
     OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.recorded_by_id IS DISTINCT FROM OLD.recorded_by_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Weighing % is history: its measurement cannot be changed. Reject it and record a new one.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- A decision is made once.
  IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Weighing % was already %.', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Whoever recorded it does not approve it (maker-checker), unless the
  -- company has chosen self-approval for a farm with nobody else.
  IF NEW.status = 'APPROVED' AND OLD.status = 'PENDING'
     AND NEW.approved_by_id = NEW.recorded_by_id
     AND NOT (SELECT allow_self_approval FROM companies WHERE id = NEW.company_id) THEN
    RAISE EXCEPTION 'Weighing %: whoever recorded it cannot approve it.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_weighing_is_history ON livestock_weighings;
CREATE TRIGGER trg_weighing_is_history
  BEFORE UPDATE OR DELETE ON livestock_weighings
  FOR EACH ROW EXECUTE FUNCTION bap_weighing_is_history();

-- A weighing belongs to the company of the batch it weighs.
CREATE OR REPLACE FUNCTION bap_weighing_own_group()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT company_id FROM livestock_groups WHERE id = NEW.group_id) IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Tenant isolation: weighing % names a batch of another company.', NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_weighing_own_group ON livestock_weighings;
CREATE TRIGGER trg_weighing_own_group
  BEFORE INSERT ON livestock_weighings
  FOR EACH ROW EXECUTE FUNCTION bap_weighing_own_group();
