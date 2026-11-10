ALTER TABLE "livestock_groups"
  ADD CONSTRAINT "livestock_groups_hatch_date_estimator_fkey"
    FOREIGN KEY ("hatch_date_estimated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "livestock_groups_hatch_date_approver_fkey"
    FOREIGN KEY ("hatch_date_approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "livestock_groups_hatch_date_requester_fkey"
    FOREIGN KEY ("pending_hatch_requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION bap_guard_hatch_date_correction()
RETURNS TRIGGER AS $$
DECLARE
  has_history BOOLEAN;
BEGIN
  IF NEW.hatched_on IS DISTINCT FROM OLD.hatched_on
     OR NEW.hatch_date_estimated IS DISTINCT FROM OLD.hatch_date_estimated
     OR NEW.hatch_date_evidence IS DISTINCT FROM OLD.hatch_date_evidence
     OR NEW.hatch_date_estimated_by_id IS DISTINCT FROM OLD.hatch_date_estimated_by_id
     OR NEW.hatch_date_approved_by_id IS DISTINCT FROM OLD.hatch_date_approved_by_id
     OR NEW.hatch_date_approved_at IS DISTINCT FROM OLD.hatch_date_approved_at THEN
    SELECT EXISTS (SELECT 1 FROM daily_records WHERE group_id = OLD.id)
        OR EXISTS (SELECT 1 FROM stage_changes WHERE group_id = OLD.id)
        OR EXISTS (SELECT 1 FROM livestock_weighings WHERE group_id = OLD.id)
        OR EXISTS (SELECT 1 FROM livestock_group_disposals WHERE group_id = OLD.id)
        OR EXISTS (SELECT 1 FROM harvest_records WHERE group_id = OLD.id)
        OR EXISTS (SELECT 1 FROM health_events WHERE group_id = OLD.id)
        OR EXISTS (SELECT 1 FROM treatment_records WHERE group_id = OLD.id)
        OR OLD.origin_type IN ('HATCHED', 'PRODUCED')
      INTO has_history;

    IF has_history AND NOT COALESCE((
      OLD.hatch_date_approval_status = 'PENDING'
      AND NEW.hatch_date_approval_status IN ('APPROVED', 'CORRECTED')
      AND OLD.pending_hatch_requested_by_id IS NOT NULL
      AND NEW.hatch_date_approved_by_id IS NOT NULL
      AND NEW.hatch_date_approved_by_id IS DISTINCT FROM OLD.pending_hatch_requested_by_id
    ), false) THEN
      RAISE EXCEPTION 'Hatch date for livestock group % is locked after lifecycle history; submit an independently approved correction.', OLD.code
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_hatch_date_correction ON livestock_groups;
CREATE TRIGGER trg_guard_hatch_date_correction
  BEFORE UPDATE ON livestock_groups
  FOR EACH ROW EXECUTE FUNCTION bap_guard_hatch_date_correction();
