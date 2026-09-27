-- National identity and health insurance (NHIA) numbers (handbook §54.2):
-- encrypted in the application like the other identifiers; the NIN also keeps
-- a keyed fingerprint for the one-person-one-employee check.
ALTER TABLE "employees" ADD COLUMN "nin" TEXT;
ALTER TABLE "employees" ADD COLUMN "nin_hash" TEXT;
ALTER TABLE "employees" ADD COLUMN "nhia_number" TEXT;

CREATE INDEX "employees_company_id_nin_hash_idx" ON "employees"("company_id", "nin_hash");
