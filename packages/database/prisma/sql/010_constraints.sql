-- BioAssetPro — database-level invariants for the Core Platform.
--
-- These exist because Rule 2 and Rule 9 are not style preferences. Prisma
-- middleware protects the ORM path; this protects every other path — a raw
-- query, a psql session, a future service that forgets. Both layers, always.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Money shape: non-negative, and never both sides on one line.
-- ---------------------------------------------------------------------------

ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS journal_lines_amount_sign_chk;
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_amount_sign_chk
  CHECK (debit_kobo >= 0 AND credit_kobo >= 0);

ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS journal_lines_single_side_chk;
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_single_side_chk
  CHECK (
    (debit_kobo > 0 AND credit_kobo = 0)
    OR (credit_kobo > 0 AND debit_kobo = 0)
  );

-- ---------------------------------------------------------------------------
-- 2. Posted journals are immutable.
--    The DRAFT -> POSTED transition is permitted (OLD.status = 'DRAFT').
--    Anything touching a row that is ALREADY posted is refused.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_posted_journal_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION
        'Journal % is posted and cannot be deleted. Post a reversing journal instead.',
        OLD.journal_number
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION
      'Journal % is posted and cannot be modified. Post a reversing or adjusting journal instead.',
      OLD.journal_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
CREATE TRIGGER trg_journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_journal_mutation();

-- ---------------------------------------------------------------------------
-- 3. Lines of a posted journal are immutable.
--    Checked against the parent's status, so a line cannot be edited out from
--    under a posted header.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_posted_journal_line_mutation()
RETURNS TRIGGER AS $$
DECLARE
  parent_status TEXT;
  parent_number TEXT;
  target_id     UUID;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    target_id := OLD.journal_entry_id;
  ELSE
    target_id := OLD.journal_entry_id;
  END IF;

  SELECT status::TEXT, journal_number
    INTO parent_status, parent_number
    FROM journal_entries
   WHERE id = target_id;

  -- Parent already gone (cascade from a draft delete): nothing to protect.
  IF parent_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION
      'Journal % is posted; its lines cannot be modified or deleted.',
      parent_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_immutable ON journal_lines;
CREATE TRIGGER trg_journal_lines_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_journal_line_mutation();

-- ---------------------------------------------------------------------------
-- 4. Audit records are append-only. No exceptions, no status carve-out.
--    Rule 9: "never editable or deletable through any application code path".
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only and cannot be % .', lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_records_append_only ON audit_records;
CREATE TRIGGER trg_audit_records_append_only
  BEFORE UPDATE OR DELETE ON audit_records
  FOR EACH ROW EXECUTE FUNCTION bap_block_audit_mutation();

-- ---------------------------------------------------------------------------
-- 5. A posted journal must balance, in integer kobo, exactly.
--    This is a CONSTRAINT TRIGGER deferred to COMMIT: lines are inserted one at
--    a time, so the balance can only be judged once the transaction is complete.
--    The PostingService checks this too — this is the backstop that makes the
--    invariant true of the database rather than of one code path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_assert_journal_balanced()
RETURNS TRIGGER AS $$
DECLARE
  total_debit  BIGINT;
  total_credit BIGINT;
  line_count   INT;
BEGIN
  IF NEW.status <> 'POSTED' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(debit_kobo), 0), COALESCE(SUM(credit_kobo), 0), COUNT(*)
    INTO total_debit, total_credit, line_count
    FROM journal_lines
   WHERE journal_entry_id = NEW.id;

  IF line_count < 2 THEN
    RAISE EXCEPTION
      'Journal % is posted with % line(s); a balanced entry needs at least two.',
      NEW.journal_number, line_count
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF total_debit <> total_credit THEN
    RAISE EXCEPTION
      'Journal % does not balance: debits % kobo, credits % kobo.',
      NEW.journal_number, total_debit, total_credit
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER trg_journal_entries_balanced
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bap_assert_journal_balanced();
