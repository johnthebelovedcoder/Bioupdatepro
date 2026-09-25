-- BioAssetPro — tenant isolation at the database, for the ledger.
--
-- Every company's journal lines share one table and one chart-of-accounts
-- table. A foreign key proves an account EXISTS; it does not prove it is
-- this company's. Until 2026-09-25 the posting validator only checked that an
-- account existed, so a journal could name another company's account by id.
-- The validator now refuses that too (DimensionValidatorService); this makes
-- it hold for every path, including one nobody has written yet.
--
-- On INSERT and on UPDATE of the account or company only, so rows already
-- in the table are never re-judged by a rule they predate.
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_journal_line_own_account()
RETURNS TRIGGER AS $$
DECLARE
  v_account_company uuid;
BEGIN
  SELECT company_id INTO v_account_company FROM gl_accounts WHERE id = NEW.gl_account_id;
  IF v_account_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION
      'Tenant isolation: journal line % names an account of another company.', NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_line_own_account ON journal_lines;
CREATE TRIGGER trg_journal_line_own_account
  BEFORE INSERT OR UPDATE OF gl_account_id, company_id ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION bap_journal_line_own_account();

-- Manual journal lines carry their company through the journal header.
CREATE OR REPLACE FUNCTION bap_manual_journal_line_own_account()
RETURNS TRIGGER AS $$
DECLARE
  v_account_company uuid;
  v_journal_company uuid;
BEGIN
  SELECT company_id INTO v_account_company FROM gl_accounts WHERE id = NEW.gl_account_id;
  SELECT company_id INTO v_journal_company FROM manual_journals WHERE id = NEW.manual_journal_id;
  IF v_account_company IS DISTINCT FROM v_journal_company THEN
    RAISE EXCEPTION
      'Tenant isolation: manual journal line % names an account of another company.', NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_manual_journal_line_own_account ON manual_journal_lines;
CREATE TRIGGER trg_manual_journal_line_own_account
  BEFORE INSERT OR UPDATE OF gl_account_id, manual_journal_id ON manual_journal_lines
  FOR EACH ROW EXECUTE FUNCTION bap_manual_journal_line_own_account();
