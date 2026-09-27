-- Sensitive employee numbers are encrypted in the application (AES-256-GCM,
-- key in PII_ENCRYPTION_KEY). The account number and TIN also keep a keyed
-- fingerprint so the duplicate checks can still compare them.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'VIEW';

ALTER TABLE "employees" ADD COLUMN "account_number_hash" TEXT;
ALTER TABLE "employees" ADD COLUMN "tin_hash" TEXT;

CREATE INDEX "employees_company_id_account_number_hash_idx" ON "employees"("company_id", "account_number_hash");
CREATE INDEX "employees_company_id_tin_hash_idx" ON "employees"("company_id", "tin_hash");
