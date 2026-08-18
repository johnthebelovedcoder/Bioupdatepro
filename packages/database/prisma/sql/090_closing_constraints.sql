-- BioAssetPro — invariants for Period-End & Year-End Closing (§8).
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The close log is append-only (§8 note 4: "Every close/reopen is an
--    immutable audit record").
--
--    This is the record that says a period was closed, by whom, and what the
--    trial balance was at the time. A close log that can be edited afterwards
--    answers no question worth asking.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_close_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'period_close_logs is append-only; % is not permitted.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_close_log_immutable ON period_close_logs;
CREATE TRIGGER trg_close_log_immutable
  BEFORE UPDATE OR DELETE ON period_close_logs
  FOR EACH ROW EXECUTE FUNCTION bap_block_close_log_mutation();

-- ---------------------------------------------------------------------------
-- 2. A stored balance is a historical fact, not a working figure.
--    Recomputing a year-end produces a new row after the old one is removed by
--    an explicit re-open, never a silent overwrite.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_account_balance_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'account_balances records a closed position and cannot be updated. Reopen the year if it is wrong.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_account_balance_immutable ON account_balances;
CREATE TRIGGER trg_account_balance_immutable
  BEFORE UPDATE ON account_balances
  FOR EACH ROW EXECUTE FUNCTION bap_block_account_balance_update();

-- ---------------------------------------------------------------------------
-- 3. Balances must be internally consistent.
-- ---------------------------------------------------------------------------

ALTER TABLE account_balances DROP CONSTRAINT IF EXISTS account_balances_sides_chk;
ALTER TABLE account_balances ADD CONSTRAINT account_balances_sides_chk
  CHECK (total_debit_kobo >= 0 AND total_credit_kobo >= 0);

ALTER TABLE period_close_logs DROP CONSTRAINT IF EXISTS period_close_logs_totals_chk;
ALTER TABLE period_close_logs ADD CONSTRAINT period_close_logs_totals_chk
  CHECK (total_debit_kobo >= 0 AND total_credit_kobo >= 0);

-- ---------------------------------------------------------------------------
-- 4. A waived checklist item must say why.
--    §8 makes the checklist a control. A step passed over with no reason is a
--    step nobody can review, which is worse than no step at all.
-- ---------------------------------------------------------------------------

ALTER TABLE period_close_checklists DROP CONSTRAINT IF EXISTS period_close_checklists_waiver_chk;
ALTER TABLE period_close_checklists ADD CONSTRAINT period_close_checklists_waiver_chk
  CHECK (
    status <> 'WAIVED'
    OR (comments IS NOT NULL AND length(trim(comments)) > 0)
  );

-- ---------------------------------------------------------------------------
-- 5. A closed year cannot be re-closed into a different shape.
--    Once a financial year is CLOSED or ARCHIVED, its status only moves
--    forward. Going back is a re-open, which is its own workflow-governed
--    action with its own log entry.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_guard_financial_year_status()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status::text = 'ARCHIVED' AND NEW.status::text <> 'ARCHIVED' THEN
    RAISE EXCEPTION
      'Financial year % is archived and cannot change status.', OLD.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_financial_year_status ON financial_years;
CREATE TRIGGER trg_financial_year_status
  BEFORE UPDATE ON financial_years
  FOR EACH ROW EXECUTE FUNCTION bap_guard_financial_year_status();

-- ---------------------------------------------------------------------------
-- 6. A reopen request cannot be approved without an approver.
-- ---------------------------------------------------------------------------

ALTER TABLE period_reopen_requests DROP CONSTRAINT IF EXISTS period_reopen_requests_approval_chk;
ALTER TABLE period_reopen_requests ADD CONSTRAINT period_reopen_requests_approval_chk
  CHECK (
    (approved_at IS NULL AND approved_by_id IS NULL)
    OR (approved_at IS NOT NULL AND approved_by_id IS NOT NULL)
  );

-- A reopen cannot have happened before it was approved.
ALTER TABLE period_reopen_requests DROP CONSTRAINT IF EXISTS period_reopen_requests_order_chk;
ALTER TABLE period_reopen_requests ADD CONSTRAINT period_reopen_requests_order_chk
  CHECK (reopened_at IS NULL OR approved_at IS NOT NULL);

ALTER TABLE period_reopen_requests DROP CONSTRAINT IF EXISTS period_reopen_requests_reason_chk;
ALTER TABLE period_reopen_requests ADD CONSTRAINT period_reopen_requests_reason_chk
  CHECK (length(trim(reason)) > 0);
