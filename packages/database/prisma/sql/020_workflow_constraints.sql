-- BioAssetPro — database-level invariants for the Workflow & Approval Engine.
--
-- Same reasoning as 010: the service layer enforces these too, but a guarantee
-- that only holds for code paths we remember to route correctly is not a
-- guarantee. Maker-checker in particular is a control an auditor will test.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Maker-checker (Rule 4), at the row level.
--    A step may never record an approval by the transaction's maker — not by
--    role, not through a delegation, not by direct UPDATE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_enforce_maker_checker()
RETURNS TRIGGER AS $$
DECLARE
  v_maker_id uuid;
  v_reference text;
BEGIN
  IF NEW.acted_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT maker_id, document_reference
    INTO v_maker_id, v_reference
    FROM workflow_transactions
   WHERE id = NEW.transaction_id;

  IF NEW.acted_by_id = v_maker_id THEN
    RAISE EXCEPTION
      'Maker-checker violation: user % created % and cannot approve it.',
      NEW.acted_by_id, v_reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_maker_checker ON workflow_transaction_steps;
CREATE TRIGGER trg_maker_checker
  BEFORE INSERT OR UPDATE ON workflow_transaction_steps
  FOR EACH ROW EXECUTE FUNCTION bap_enforce_maker_checker();

-- ---------------------------------------------------------------------------
-- 2. Workflow history is append-only (Rule 9).
--    Same treatment as audit_records: no UPDATE, no DELETE, ever.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_workflow_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'workflow_history is append-only; % is not permitted.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workflow_history_immutable ON workflow_history;
CREATE TRIGGER trg_workflow_history_immutable
  BEFORE UPDATE OR DELETE ON workflow_history
  FOR EACH ROW EXECUTE FUNCTION bap_block_workflow_history_mutation();

-- ---------------------------------------------------------------------------
-- 3. A terminal transaction cannot be re-opened by mutation.
--    POSTED, CLOSED, REJECTED and CANCELLED are end states. Correcting one
--    means a new document through the same pipeline, never an edit (Rule 2).
--    The APPROVED -> POSTED and POSTED -> CLOSED transitions stay open, since
--    those are the pipeline completing rather than history being rewritten.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_terminal_workflow_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status IN ('POSTED', 'CLOSED') THEN
      RAISE EXCEPTION
        'Workflow transaction % is % and cannot be deleted.',
        OLD.document_reference, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('REJECTED', 'CANCELLED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION
      'Workflow transaction % is % and cannot be re-opened. Submit a new document.',
      OLD.document_reference, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED', 'CLOSED') THEN
    RAISE EXCEPTION
      'Workflow transaction % is posted; it may only be closed.',
      OLD.document_reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
    RAISE EXCEPTION
      'Workflow transaction % is closed and cannot change status.',
      OLD.document_reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workflow_terminal ON workflow_transactions;
CREATE TRIGGER trg_workflow_terminal
  BEFORE UPDATE OR DELETE ON workflow_transactions
  FOR EACH ROW EXECUTE FUNCTION bap_block_terminal_workflow_mutation();

-- ---------------------------------------------------------------------------
-- 4. Approval ladders must be sane.
--    Levels start at 1 and escalation thresholds must increase, or the
--    escalation sweep would fire its stages out of order.
-- ---------------------------------------------------------------------------

ALTER TABLE workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_level_chk;
ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_level_chk
  CHECK (level >= 1);

ALTER TABLE workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_ceiling_chk;
ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_ceiling_chk
  CHECK (max_amount_kobo IS NULL OR max_amount_kobo > 0);

ALTER TABLE workflow_transactions DROP CONSTRAINT IF EXISTS workflow_transactions_amount_chk;
ALTER TABLE workflow_transactions ADD CONSTRAINT workflow_transactions_amount_chk
  CHECK (amount_kobo >= 0);

ALTER TABLE workflow_escalation_rules DROP CONSTRAINT IF EXISTS workflow_escalation_order_chk;
ALTER TABLE workflow_escalation_rules ADD CONSTRAINT workflow_escalation_order_chk
  CHECK (
    remind_after_hours > 0
    AND notify_manager_after_hours > remind_after_hours
    AND escalate_after_hours > notify_manager_after_hours
  );

-- ---------------------------------------------------------------------------
-- 5. A delegation must cover a real window, and nobody delegates to themselves.
-- ---------------------------------------------------------------------------

ALTER TABLE workflow_delegations DROP CONSTRAINT IF EXISTS workflow_delegations_window_chk;
ALTER TABLE workflow_delegations ADD CONSTRAINT workflow_delegations_window_chk
  CHECK (end_date > start_date);

ALTER TABLE workflow_delegations DROP CONSTRAINT IF EXISTS workflow_delegations_self_chk;
ALTER TABLE workflow_delegations ADD CONSTRAINT workflow_delegations_self_chk
  CHECK (delegator_id <> delegate_id);
