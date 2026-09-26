-- BioAssetPro — leave requests (SOP-038, AC-HR-003).
--
-- A leave request is approved or rejected once, by someone other than
-- whoever asked for it (unless the company has chosen self-approval). Its
-- employee, type and dates never change after it is requested; a different
-- leave is a new request. Approved leave can later be cancelled — nothing
-- else about a decided request changes, and a request is never deleted once
-- decided, because payroll and the balance roll-forward read it.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_leave_controlled()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Leave request % is %; it cannot be deleted.', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.working_days IS DISTINCT FROM OLD.working_days
     OR NEW.requested_by_id IS DISTINCT FROM OLD.requested_by_id THEN
    RAISE EXCEPTION 'Leave request %: the employee, type and dates are fixed once requested. Make a new request.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED'))
       OR (OLD.status = 'APPROVED' AND NEW.status = 'CANCELLED')) THEN
    RAISE EXCEPTION 'Leave request % cannot go from % to %.', OLD.id, OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Leave request % is %; it cannot change.', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'APPROVED' AND OLD.status = 'PENDING'
     AND NEW.decided_by_id = NEW.requested_by_id
     AND NOT (SELECT allow_self_approval FROM companies WHERE id = NEW.company_id) THEN
    RAISE EXCEPTION 'Leave request %: whoever requested it cannot approve it.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leave_controlled ON leave_requests;
CREATE TRIGGER trg_leave_controlled
  BEFORE UPDATE OR DELETE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION bap_leave_controlled();
