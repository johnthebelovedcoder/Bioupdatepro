-- BioAssetPro — invariants for HR & Payroll (§7, §7.1, §7.2).
--
-- §7.1 states the validation directly: "Band configuration must not overlap or
-- leave gaps." A gap silently untaxes a slice of income; an overlap taxes it
-- twice. Neither is visible in a total, which is why it is enforced here rather
-- than left to review.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Band shape.
-- ---------------------------------------------------------------------------

ALTER TABLE paye_bands DROP CONSTRAINT IF EXISTS paye_bands_rate_chk;
ALTER TABLE paye_bands ADD CONSTRAINT paye_bands_rate_chk
  CHECK (rate >= 0 AND rate <= 1);

ALTER TABLE paye_bands DROP CONSTRAINT IF EXISTS paye_bands_limits_chk;
ALTER TABLE paye_bands ADD CONSTRAINT paye_bands_limits_chk
  CHECK (
    lower_limit_kobo >= 0
    AND (upper_limit_kobo IS NULL OR upper_limit_kobo > lower_limit_kobo)
    AND band_order >= 1
  );

ALTER TABLE paye_bands DROP CONSTRAINT IF EXISTS paye_bands_window_chk;
ALTER TABLE paye_bands ADD CONSTRAINT paye_bands_window_chk
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- No two bands of the same order effective on the same day.
ALTER TABLE paye_bands DROP CONSTRAINT IF EXISTS paye_bands_no_overlap;
ALTER TABLE paye_bands ADD CONSTRAINT paye_bands_no_overlap
  EXCLUDE USING gist (
    company_id WITH =,
    band_order WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- ---------------------------------------------------------------------------
-- 2. Bands must tile the income line with no gap and no overlap.
--
--    Checked on every insert and update: each band after the first must start
--    exactly where its predecessor ended, and only the last may be unbounded.
--    This is the §7.1 rule, enforced rather than documented.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_validate_paye_band_contiguity()
RETURNS TRIGGER AS $$
DECLARE
  v_prev_upper bigint;
  v_next_lower bigint;
BEGIN
  -- The band immediately below this one, in the same effective set.
  SELECT upper_limit_kobo INTO v_prev_upper
    FROM paye_bands
   WHERE company_id = NEW.company_id
     AND effective_from = NEW.effective_from
     AND band_order = NEW.band_order - 1;

  IF FOUND AND v_prev_upper IS DISTINCT FROM NEW.lower_limit_kobo THEN
    RAISE EXCEPTION
      'PAYE band % must start where band % ends (% kobo), not at % kobo. Bands must not overlap or leave gaps.',
      NEW.band_order, NEW.band_order - 1, v_prev_upper, NEW.lower_limit_kobo
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The band immediately above, if it already exists.
  SELECT lower_limit_kobo INTO v_next_lower
    FROM paye_bands
   WHERE company_id = NEW.company_id
     AND effective_from = NEW.effective_from
     AND band_order = NEW.band_order + 1;

  IF FOUND AND NEW.upper_limit_kobo IS DISTINCT FROM v_next_lower THEN
    RAISE EXCEPTION
      'PAYE band % must end where band % begins (% kobo), not at % kobo.',
      NEW.band_order, NEW.band_order + 1, v_next_lower, NEW.upper_limit_kobo
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Only the top band may be open-ended.
  IF NEW.upper_limit_kobo IS NULL AND FOUND THEN
    RAISE EXCEPTION
      'PAYE band % is unbounded but band % exists above it. Only the highest band may be open-ended.',
      NEW.band_order, NEW.band_order + 1
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_paye_band_contiguity ON paye_bands;
CREATE TRIGGER trg_paye_band_contiguity
  BEFORE INSERT OR UPDATE ON paye_bands
  FOR EACH ROW EXECUTE FUNCTION bap_validate_paye_band_contiguity();

-- ---------------------------------------------------------------------------
-- 3. Statutory and PAYE configuration shape.
-- ---------------------------------------------------------------------------

ALTER TABLE paye_configurations DROP CONSTRAINT IF EXISTS paye_configurations_rates_chk;
ALTER TABLE paye_configurations ADD CONSTRAINT paye_configurations_rates_chk
  CHECK (
    minimum_wage_monthly_kobo >= 0
    AND rent_relief_rate >= 0 AND rent_relief_rate <= 1
    AND rent_relief_cap_kobo >= 0
    AND pension_relief_rate >= 0 AND pension_relief_rate <= 1
  );

ALTER TABLE paye_configurations DROP CONSTRAINT IF EXISTS paye_configurations_no_overlap;
ALTER TABLE paye_configurations ADD CONSTRAINT paye_configurations_no_overlap
  EXCLUDE USING gist (
    company_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

ALTER TABLE statutory_configurations DROP CONSTRAINT IF EXISTS statutory_configurations_rates_chk;
ALTER TABLE statutory_configurations ADD CONSTRAINT statutory_configurations_rates_chk
  CHECK (
    pension_employee_rate BETWEEN 0 AND 1
    AND pension_employer_rate BETWEEN 0 AND 1
    AND pension_combined_rate BETWEEN 0 AND 1
    AND nhf_rate BETWEEN 0 AND 1
    AND nsitf_rate BETWEEN 0 AND 1
    AND itf_rate BETWEEN 0 AND 1
    AND pension_min_employees >= 0
    AND itf_min_employees >= 0
    AND minimum_wage_monthly_kobo >= 0
  );

-- §7.2 Developer_Logic: "Combined statutory minimum must not be below 18%."
-- A split that funds less than the combined rate would under-remit.
ALTER TABLE statutory_configurations DROP CONSTRAINT IF EXISTS statutory_configurations_combined_chk;
ALTER TABLE statutory_configurations ADD CONSTRAINT statutory_configurations_combined_chk
  CHECK (pension_employee_rate + pension_employer_rate >= pension_combined_rate - 0.00000001);

ALTER TABLE statutory_configurations DROP CONSTRAINT IF EXISTS statutory_configurations_no_overlap;
ALTER TABLE statutory_configurations ADD CONSTRAINT statutory_configurations_no_overlap
  EXCLUDE USING gist (
    company_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- ---------------------------------------------------------------------------
-- 4. A posted payroll run is immutable (Rule 2).
--    §7.1: "Posted calculation cannot be overwritten. Recalculation creates a
--    new version." So a posted run cannot move, and its lines cannot change.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_posted_payroll_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION
        'Payroll run % is posted and cannot be deleted.', OLD.reference
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'POSTED' AND NEW.status <> 'POSTED' THEN
    RAISE EXCEPTION
      'Payroll run % is posted. Correct it with an adjusting journal, not by re-opening it.',
      OLD.reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_run_posted ON payroll_runs;
CREATE TRIGGER trg_payroll_run_posted
  BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_payroll_mutation();

CREATE OR REPLACE FUNCTION bap_block_posted_payroll_line_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_reference text;
BEGIN
  SELECT status, reference INTO v_status, v_reference
    FROM payroll_runs
   WHERE id = COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);

  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION
      'Payroll run % is posted; its lines cannot be changed.', v_reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_line_posted ON payroll_run_lines;
CREATE TRIGGER trg_payroll_line_posted
  BEFORE INSERT OR UPDATE OR DELETE ON payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_payroll_line_mutation();

-- ---------------------------------------------------------------------------
-- 5. Payroll amounts are non-negative, and net pay cannot exceed gross.
--    A negative net pay means the deductions exceeded the salary, which is a
--    calculation error rather than a payroll the bank can execute.
-- ---------------------------------------------------------------------------

ALTER TABLE payroll_run_lines DROP CONSTRAINT IF EXISTS payroll_run_lines_amounts_chk;
ALTER TABLE payroll_run_lines ADD CONSTRAINT payroll_run_lines_amounts_chk
  CHECK (
    monthly_gross_kobo >= 0
    AND annual_paye_kobo >= 0
    AND monthly_paye_kobo >= 0
    AND employee_pension_kobo >= 0
    AND employer_pension_kobo >= 0
    AND nhf_kobo >= 0
    AND nsitf_kobo >= 0
    AND itf_kobo >= 0
    AND chargeable_income_kobo >= 0
    AND net_pay_kobo >= 0
    AND net_pay_kobo <= monthly_gross_kobo
  );

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_month_chk;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_month_chk
  CHECK (month BETWEEN 1 AND 12 AND employee_count >= 0);

-- ---------------------------------------------------------------------------
-- 6. Tax reliefs are non-negative annual figures.
-- ---------------------------------------------------------------------------

ALTER TABLE employee_tax_reliefs DROP CONSTRAINT IF EXISTS employee_tax_reliefs_amounts_chk;
ALTER TABLE employee_tax_reliefs ADD CONSTRAINT employee_tax_reliefs_amounts_chk
  CHECK (
    annual_rent_kobo >= 0
    AND nhf_annual_kobo >= 0
    AND nhis_annual_kobo >= 0
    AND life_assurance_annual_kobo >= 0
    AND mortgage_interest_annual_kobo >= 0
    AND annual_bonus_kobo >= 0
  );
