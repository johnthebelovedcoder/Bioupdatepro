-- BioAssetPro — database-level invariants for the Tax Engine (§4).
--
-- Tax is the part of this system a revenue authority audits directly, so the
-- register must be provably consistent with the ledger rather than merely
-- assembled from it. These constraints hold that line at the database.
--
-- Idempotent: safe to re-run.

-- Needed for the overlap-exclusion constraints below: btree_gist is what lets a
-- GiST index mix an equality column (uuid, text) with a range column.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Rates are ratios, not money, but they still have bounds.
--    A negative rate would produce a negative liability; a rate above 1 would
--    charge more tax than the base. Both are configuration errors, not
--    arithmetic the engine should faithfully carry out.
-- ---------------------------------------------------------------------------

ALTER TABLE tax_rates DROP CONSTRAINT IF EXISTS tax_rates_range_chk;
ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_range_chk
  CHECK (rate >= 0 AND rate <= 1);

ALTER TABLE tax_rates DROP CONSTRAINT IF EXISTS tax_rates_window_chk;
ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_window_chk
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- Two rates for the same code cannot be effective on the same day. Without
-- this, "the rate on 3 March" has two answers and the engine picks by row
-- order, which is how a filing quietly goes wrong.
DROP INDEX IF EXISTS tax_rates_no_overlap_idx;
ALTER TABLE tax_rates DROP CONSTRAINT IF EXISTS tax_rates_no_overlap;
ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_no_overlap
  EXCLUDE USING gist (
    tax_code_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- Same reasoning for GL mappings: one account per code and direction per day.
ALTER TABLE tax_gl_mappings DROP CONSTRAINT IF EXISTS tax_gl_mappings_no_overlap;
ALTER TABLE tax_gl_mappings ADD CONSTRAINT tax_gl_mappings_no_overlap
  EXCLUDE USING gist (
    tax_code_id WITH =,
    direction WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

ALTER TABLE tax_configurations DROP CONSTRAINT IF EXISTS tax_configurations_no_overlap;
ALTER TABLE tax_configurations ADD CONSTRAINT tax_configurations_no_overlap
  EXCLUDE USING gist (
    company_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- ---------------------------------------------------------------------------
-- 2. Register entries are append-only.
--    A VAT return is filed from these rows. Editing one after the fact would
--    make the filed return unreproducible, so corrections go through
--    TaxAdjustment (Rule 2) and the original row stays exactly as posted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_tax_register_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only; % is not permitted. Post a tax adjustment instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vat_register_immutable ON vat_register_entries;
CREATE TRIGGER trg_vat_register_immutable
  BEFORE UPDATE OR DELETE ON vat_register_entries
  FOR EACH ROW EXECUTE FUNCTION bap_block_tax_register_mutation();

DROP TRIGGER IF EXISTS trg_wht_register_immutable ON wht_register_entries;
CREATE TRIGGER trg_wht_register_immutable
  BEFORE UPDATE OR DELETE ON wht_register_entries
  FOR EACH ROW EXECUTE FUNCTION bap_block_tax_register_mutation();

-- ---------------------------------------------------------------------------
-- 3. Nothing may be written into a closed or filed tax period.
--    Once a return is filed, its period is settled. A late entry would change
--    a figure already submitted to the authority.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_closed_tax_period_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_name   text;
BEGIN
  SELECT status, name INTO v_status, v_name
    FROM tax_periods WHERE id = NEW.tax_period_id;

  IF v_status IN ('CLOSED', 'FILED') THEN
    RAISE EXCEPTION
      'Tax period % is % and will not accept new register entries. Post a tax adjustment instead.',
      v_name, v_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vat_period_open ON vat_register_entries;
CREATE TRIGGER trg_vat_period_open
  BEFORE INSERT ON vat_register_entries
  FOR EACH ROW EXECUTE FUNCTION bap_block_closed_tax_period_entry();

DROP TRIGGER IF EXISTS trg_wht_period_open ON wht_register_entries;
CREATE TRIGGER trg_wht_period_open
  BEFORE INSERT ON wht_register_entries
  FOR EACH ROW EXECUTE FUNCTION bap_block_closed_tax_period_entry();

-- ---------------------------------------------------------------------------
-- 4. A filed period cannot be re-opened by mutation.
--    Re-opening is a workflow-governed action in Phase 11, not an UPDATE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_filed_tax_period_reopen()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'FILED' AND NEW.status <> 'FILED' THEN
    RAISE EXCEPTION
      'Tax period % has been filed and cannot be re-opened.', OLD.name
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tax_period_filed ON tax_periods;
CREATE TRIGGER trg_tax_period_filed
  BEFORE UPDATE ON tax_periods
  FOR EACH ROW EXECUTE FUNCTION bap_block_filed_tax_period_reopen();

-- ---------------------------------------------------------------------------
-- 5. Money shape on the registers.
--    Tax and base are non-negative on a register line; a reduction is an
--    adjustment document, not a negative register entry. Adjustments ARE
--    signed, which is why they are exempt from this.
-- ---------------------------------------------------------------------------

ALTER TABLE vat_register_entries DROP CONSTRAINT IF EXISTS vat_register_amounts_chk;
ALTER TABLE vat_register_entries ADD CONSTRAINT vat_register_amounts_chk
  CHECK (taxable_base_kobo >= 0 AND tax_kobo >= 0);

ALTER TABLE wht_register_entries DROP CONSTRAINT IF EXISTS wht_register_amounts_chk;
ALTER TABLE wht_register_entries ADD CONSTRAINT wht_register_amounts_chk
  CHECK (
    gross_amount_kobo >= 0
    AND vat_amount_kobo >= 0
    AND taxable_base_kobo >= 0
    AND tax_kobo >= 0
    AND tax_kobo <= taxable_base_kobo
  );

ALTER TABLE tax_periods DROP CONSTRAINT IF EXISTS tax_periods_window_chk;
ALTER TABLE tax_periods ADD CONSTRAINT tax_periods_window_chk
  CHECK (end_date >= start_date AND due_date >= end_date);
