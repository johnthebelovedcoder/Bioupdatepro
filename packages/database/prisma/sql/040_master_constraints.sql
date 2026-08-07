-- BioAssetPro — database-level invariants for Master Data (§5, §6, §7, §10).
--
-- Master data is where bad values enter a system quietly and surface months
-- later as a mis-costed production order or an under-deducted payroll. These
-- constraints refuse the values that have no defensible meaning.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Money and quantity shape.
--    Credit limits and standard costs cannot be negative. Recipe quantities
--    cannot be zero or negative: a component consumed in no quantity is not a
--    component, and a negative one would credit inventory during production.
-- ---------------------------------------------------------------------------

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_credit_limit_chk;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_credit_limit_chk
  CHECK (credit_limit_kobo >= 0);

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_credit_limit_chk;
ALTER TABLE customers ADD CONSTRAINT customers_credit_limit_chk
  CHECK (credit_limit_kobo >= 0);

ALTER TABLE item_standard_costs DROP CONSTRAINT IF EXISTS item_standard_costs_amount_chk;
ALTER TABLE item_standard_costs ADD CONSTRAINT item_standard_costs_amount_chk
  CHECK (standard_cost_kobo >= 0);

ALTER TABLE item_standard_costs DROP CONSTRAINT IF EXISTS item_standard_costs_window_chk;
ALTER TABLE item_standard_costs ADD CONSTRAINT item_standard_costs_window_chk
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- One standard cost per item per day. Two costs effective on the same date
-- means "what did this cost on 3 March" has two answers, and every recipe
-- explosion that day becomes non-deterministic.
ALTER TABLE item_standard_costs DROP CONSTRAINT IF EXISTS item_standard_costs_no_overlap;
ALTER TABLE item_standard_costs ADD CONSTRAINT item_standard_costs_no_overlap
  EXCLUDE USING gist (
    item_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

ALTER TABLE product_recipe_components DROP CONSTRAINT IF EXISTS recipe_components_quantity_chk;
ALTER TABLE product_recipe_components ADD CONSTRAINT recipe_components_quantity_chk
  CHECK (quantity_per_batch > 0);

ALTER TABLE product_recipe_components DROP CONSTRAINT IF EXISTS recipe_components_wastage_chk;
ALTER TABLE product_recipe_components ADD CONSTRAINT recipe_components_wastage_chk
  CHECK (wastage_percent IS NULL OR (wastage_percent >= 0 AND wastage_percent < 100));

ALTER TABLE product_recipe_versions DROP CONSTRAINT IF EXISTS recipe_versions_batch_chk;
ALTER TABLE product_recipe_versions ADD CONSTRAINT recipe_versions_batch_chk
  CHECK (batch_size > 0);

-- A yield above 100% would mean a process creating mass from nothing. The
-- workbooks' yields run 68%-92%; the ceiling is deliberately generous rather
-- than tuned to those figures, because a different species may legitimately
-- differ — but it is not unbounded.
ALTER TABLE product_recipe_versions DROP CONSTRAINT IF EXISTS recipe_versions_yield_chk;
ALTER TABLE product_recipe_versions ADD CONSTRAINT recipe_versions_yield_chk
  CHECK (expected_yield_percent IS NULL OR (expected_yield_percent > 0 AND expected_yield_percent <= 100));

ALTER TABLE payment_terms DROP CONSTRAINT IF EXISTS payment_terms_days_chk;
ALTER TABLE payment_terms ADD CONSTRAINT payment_terms_days_chk
  CHECK (
    net_days >= 0
    AND (discount_days IS NULL OR discount_days <= net_days)
    AND (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent < 100))
  );

-- ---------------------------------------------------------------------------
-- 2. A recipe cannot consume the thing it produces.
--    The direct case, caught at the row. Indirect cycles (A makes B, B makes A)
--    are caught by RecipeService before a version is activated — a full
--    reachability walk is not something a row trigger can do cheaply.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_self_referencing_recipe()
RETURNS TRIGGER AS $$
DECLARE
  v_output_item uuid;
  v_recipe_code text;
BEGIN
  SELECT r.output_item_id, r.code
    INTO v_output_item, v_recipe_code
    FROM product_recipe_versions v
    JOIN product_recipes r ON r.id = v.recipe_id
   WHERE v.id = NEW.recipe_version_id;

  IF NEW.component_item_id = v_output_item THEN
    RAISE EXCEPTION
      'Recipe % cannot list its own output item as a component.', v_recipe_code
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recipe_no_self_reference ON product_recipe_components;
CREATE TRIGGER trg_recipe_no_self_reference
  BEFORE INSERT OR UPDATE ON product_recipe_components
  FOR EACH ROW EXECUTE FUNCTION bap_block_self_referencing_recipe();

-- ---------------------------------------------------------------------------
-- 3. An ACTIVE recipe version is frozen.
--    Production orders pin a version id. If an active version's components
--    could be edited, a past order's stated consumption would change under it,
--    and §10's traceability requirement would be unsatisfiable. Corrections
--    supersede the version and create a new one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_active_recipe_edit()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_version int;
BEGIN
  SELECT status, version INTO v_status, v_version
    FROM product_recipe_versions
   WHERE id = COALESCE(NEW.recipe_version_id, OLD.recipe_version_id);

  IF v_status IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION
      'Recipe version % is % and its components cannot be changed. Create a new version.',
      v_version, v_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recipe_components_frozen ON product_recipe_components;
CREATE TRIGGER trg_recipe_components_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON product_recipe_components
  FOR EACH ROW EXECUTE FUNCTION bap_block_active_recipe_edit();

-- ---------------------------------------------------------------------------
-- 4. At most one ACTIVE version of a recipe at a time.
--    "Which recipe applies today" must have exactly one answer.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS product_recipe_versions_one_active_idx;
CREATE UNIQUE INDEX product_recipe_versions_one_active_idx
  ON product_recipe_versions (recipe_id)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 5. Employee salary components do not overlap.
--    Two rows for the same component on the same day would double-pay it.
-- ---------------------------------------------------------------------------

ALTER TABLE employee_salary_components DROP CONSTRAINT IF EXISTS employee_salary_window_chk;
ALTER TABLE employee_salary_components ADD CONSTRAINT employee_salary_window_chk
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

ALTER TABLE employee_salary_components DROP CONSTRAINT IF EXISTS employee_salary_amount_chk;
ALTER TABLE employee_salary_components ADD CONSTRAINT employee_salary_amount_chk
  CHECK (
    (amount_kobo IS NOT NULL AND amount_kobo >= 0)
    OR (rate IS NOT NULL AND rate >= 0 AND rate <= 1)
  );

ALTER TABLE employee_salary_components DROP CONSTRAINT IF EXISTS employee_salary_no_overlap;
ALTER TABLE employee_salary_components ADD CONSTRAINT employee_salary_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    salary_component_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- ---------------------------------------------------------------------------
-- 6. An employee cannot report to themselves.
--    Longer management cycles are caught in the service layer; this closes the
--    one case a single row can express.
-- ---------------------------------------------------------------------------

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_self_report_chk;
ALTER TABLE employees ADD CONSTRAINT employees_self_report_chk
  CHECK (reporting_manager_id IS NULL OR reporting_manager_id <> id);

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_exit_date_chk;
ALTER TABLE employees ADD CONSTRAINT employees_exit_date_chk
  CHECK (exit_date IS NULL OR exit_date >= employment_date);
