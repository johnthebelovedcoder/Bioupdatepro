-- BioAssetPro — supplier bank details are verified by someone else (INT-001, INT-005).
--
-- SYSTEM_INTEGRITY_MATRIX INT-001 forbids an "unapproved bank change";
-- INT-005 forbids an "unverified bank payment". So:
--
-- 1. Changing a supplier's bank name, account number or account name clears
--    its verification, whoever makes the change and however: the account
--    that was verified is no longer the account on file.
-- 2. The person who entered or last changed the bank details cannot be the
--    one who verifies them, unless the company has chosen self-approval.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_supplier_bank_verified()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.bank_name IS DISTINCT FROM OLD.bank_name
     OR NEW.account_number IS DISTINCT FROM OLD.account_number
     OR NEW.account_name IS DISTINCT FROM OLD.account_name THEN
    NEW.bank_verified_by_id := NULL;
    NEW.bank_verified_at := NULL;
    NEW.bank_verification_reference := NULL;
    RETURN NEW;
  END IF;

  IF NEW.bank_verified_by_id IS NOT NULL
     AND NEW.bank_verified_by_id IS DISTINCT FROM OLD.bank_verified_by_id
     AND NEW.bank_verified_by_id = NEW.bank_set_by_id
     AND NOT (SELECT allow_self_approval FROM companies WHERE id = NEW.company_id) THEN
    RAISE EXCEPTION 'Supplier %: whoever entered its bank details cannot verify them.', NEW.code USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_bank_verified ON suppliers;
CREATE TRIGGER trg_supplier_bank_verified
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION bap_supplier_bank_verified();
