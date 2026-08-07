-- BioAssetPro — invariants for the Accounting Adjustment Centre (§3).
--
-- §3 lists the permissions this module allows: View, Create, Edit, Submit,
-- Approve, Post, Reverse, Export, Email — and states that Delete is "disabled
-- entirely". That is not a menu decision; it is enforced here, so it holds for
-- a psql session as much as for the API.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Money shape on adjustment lines, identical to the GL lines they become.
--    Catching a two-sided line here means it is refused at data entry rather
--    than at posting, when an approver has already signed it.
-- ---------------------------------------------------------------------------

ALTER TABLE manual_journal_lines DROP CONSTRAINT IF EXISTS manual_journal_lines_sign_chk;
ALTER TABLE manual_journal_lines ADD CONSTRAINT manual_journal_lines_sign_chk
  CHECK (debit_kobo >= 0 AND credit_kobo >= 0);

ALTER TABLE manual_journal_lines DROP CONSTRAINT IF EXISTS manual_journal_lines_single_side_chk;
ALTER TABLE manual_journal_lines ADD CONSTRAINT manual_journal_lines_single_side_chk
  CHECK (
    (debit_kobo > 0 AND credit_kobo = 0)
    OR (credit_kobo > 0 AND debit_kobo = 0)
  );

ALTER TABLE recurring_journal_lines DROP CONSTRAINT IF EXISTS recurring_journal_lines_single_side_chk;
ALTER TABLE recurring_journal_lines ADD CONSTRAINT recurring_journal_lines_single_side_chk
  CHECK (
    debit_kobo >= 0 AND credit_kobo >= 0
    AND (
      (debit_kobo > 0 AND credit_kobo = 0)
      OR (credit_kobo > 0 AND debit_kobo = 0)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. §3: Delete is disabled entirely.
--    A DRAFT may be cancelled; nothing may be deleted. The distinction matters
--    because a cancelled draft leaves a record that someone raised and withdrew
--    it, and a deleted one leaves a gap in a reference sequence that nobody can
--    account for.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_manual_journal_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Manual journals cannot be deleted (§3 — Delete is disabled entirely). Cancel the draft, or reverse it if posted.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_manual_journal_no_delete ON manual_journals;
CREATE TRIGGER trg_manual_journal_no_delete
  BEFORE DELETE ON manual_journals
  FOR EACH ROW EXECUTE FUNCTION bap_block_manual_journal_delete();

-- ---------------------------------------------------------------------------
-- 3. A posted adjustment is frozen (Rule 2).
--    Editing one after it has hit the ledger would leave the document and the
--    journal describing different things.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_posted_manual_journal_edit()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status <> 'POSTED' THEN
    RAISE EXCEPTION
      'Manual journal % is posted and its status cannot change. Post a reversal instead.',
      OLD.reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'POSTED' AND (
       NEW.narration IS DISTINCT FROM OLD.narration
    OR NEW.journal_date IS DISTINCT FROM OLD.journal_date
    OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
    OR NEW.reference IS DISTINCT FROM OLD.reference
  ) THEN
    RAISE EXCEPTION
      'Manual journal % is posted and cannot be edited. Post a reversal or adjustment instead.',
      OLD.reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_manual_journal_posted_frozen ON manual_journals;
CREATE TRIGGER trg_manual_journal_posted_frozen
  BEFORE UPDATE ON manual_journals
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_manual_journal_edit();

-- ---------------------------------------------------------------------------
-- 4. Lines may only change while the document is editable.
--    §3's "approver cannot edit" (Rule 4) is about the header status; this is
--    the same rule applied to the lines, which is where the money actually is.
--    Only DRAFT and RETURNED are editable — a document under review must not
--    change beneath the person reviewing it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_locked_manual_journal_lines()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_reference text;
BEGIN
  SELECT status, reference INTO v_status, v_reference
    FROM manual_journals
   WHERE id = COALESCE(NEW.manual_journal_id, OLD.manual_journal_id);

  IF v_status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION
      'Manual journal % is %; its lines cannot be changed.', v_reference, v_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_manual_journal_lines_locked ON manual_journal_lines;
CREATE TRIGGER trg_manual_journal_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON manual_journal_lines
  FOR EACH ROW EXECUTE FUNCTION bap_block_locked_manual_journal_lines();

-- ---------------------------------------------------------------------------
-- 5. One reversal per document.
--    Without this, a posted journal could be reversed twice and the second
--    reversal would silently re-create the original entry's effect.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS manual_journals_one_reversal_idx;
CREATE UNIQUE INDEX manual_journals_one_reversal_idx
  ON manual_journals (reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Recurrence windows must make sense.
-- ---------------------------------------------------------------------------

ALTER TABLE recurring_journals DROP CONSTRAINT IF EXISTS recurring_journals_window_chk;
ALTER TABLE recurring_journals ADD CONSTRAINT recurring_journals_window_chk
  CHECK (
    (end_date IS NULL OR end_date >= start_date)
    AND day_of_month BETWEEN 1 AND 31
  );
