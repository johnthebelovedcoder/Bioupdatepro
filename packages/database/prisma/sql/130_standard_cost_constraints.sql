-- BioAssetPro — standard costing is configured once a year and then fixed.
--
-- POL-001 / DEC-004 / AC-MFG-002: production posts at standard cost only,
-- configured by entity and year before the first posting and "permanently
-- locked for that financial year". Once a policy is locked — the first
-- production posting in the year sets locked_at — nothing on it changes and
-- it cannot be deleted.
--
-- POL-003 / SOP-050: a standard-cost version is prepared by one person and
-- released by another, then never edited. The only change a released version
-- takes is being superseded by the next one.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_costing_policy_locked()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'The costing policy for this year is locked by its first production posting and cannot be removed.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.financial_year_id IS DISTINCT FROM OLD.financial_year_id THEN
    RAISE EXCEPTION 'A costing policy cannot be moved to another company or year.' USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.locked_at IS NOT NULL AND (
       NEW.method IS DISTINCT FROM OLD.method
       OR NEW.variance_disposition IS DISTINCT FROM OLD.variance_disposition
       OR NEW.variance_tolerance_percent IS DISTINCT FROM OLD.variance_tolerance_percent
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN
    RAISE EXCEPTION 'The costing policy for this year is locked; a change takes effect from next year''s policy.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_costing_policy_locked ON costing_policies;
CREATE TRIGGER trg_costing_policy_locked
  BEFORE UPDATE OR DELETE ON costing_policies
  FOR EACH ROW EXECUTE FUNCTION bap_costing_policy_locked();

CREATE OR REPLACE FUNCTION bap_standard_cost_controlled()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('RELEASED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'Standard-cost version % was released and cannot be deleted.', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id
     OR NEW.financial_year_id IS DISTINCT FROM OLD.financial_year_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.output_quantity IS DISTINCT FROM OLD.output_quantity
     OR NEW.material_kobo IS DISTINCT FROM OLD.material_kobo
     OR NEW.packaging_kobo IS DISTINCT FROM OLD.packaging_kobo
     OR NEW.labour_kobo IS DISTINCT FROM OLD.labour_kobo
     OR NEW.machine_kobo IS DISTINCT FROM OLD.machine_kobo
     OR NEW.overhead_kobo IS DISTINCT FROM OLD.overhead_kobo
     OR NEW.depreciation_kobo IS DISTINCT FROM OLD.depreciation_kobo
     OR NEW.total_kobo IS DISTINCT FROM OLD.total_kobo
     OR NEW.unit_cost_kobo IS DISTINCT FROM OLD.unit_cost_kobo
     OR NEW.lines IS DISTINCT FROM OLD.lines
     OR NEW.prepared_by_id IS DISTINCT FROM OLD.prepared_by_id THEN
    RAISE EXCEPTION 'Standard-cost version % cannot be changed once prepared. Prepare a new version.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('RELEASED', 'REJECTED'))
       OR (OLD.status = 'RELEASED' AND NEW.status = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'Standard-cost version % cannot go from % to %.', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'RELEASED' AND OLD.status = 'PENDING'
     AND NEW.approved_by_id = NEW.prepared_by_id
     AND NOT (SELECT allow_self_approval FROM companies WHERE id = NEW.company_id) THEN
    RAISE EXCEPTION 'Standard-cost version %: whoever prepared it cannot release it.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_standard_cost_controlled ON standard_cost_versions;
CREATE TRIGGER trg_standard_cost_controlled
  BEFORE UPDATE OR DELETE ON standard_cost_versions
  FOR EACH ROW EXECUTE FUNCTION bap_standard_cost_controlled();

-- One released version per product and year at a time.
CREATE UNIQUE INDEX IF NOT EXISTS standard_cost_versions_one_released
  ON standard_cost_versions (company_id, item_id, financial_year_id) WHERE status = 'RELEASED';
