ALTER TYPE "FsCategory" ADD VALUE IF NOT EXISTS 'INCOME_TAX';
CREATE TYPE "LivestockOrigin" AS ENUM ('PURCHASE', 'HATCHED', 'PRODUCED', 'OPENING_BALANCE', 'MIGRATION', 'OTHER');

ALTER TABLE "livestock_groups"
  ADD COLUMN "hatch_date_evidence" TEXT,
  ADD COLUMN "hatch_date_estimated_by_id" UUID,
  ADD COLUMN "hatch_date_approved_by_id" UUID,
  ADD COLUMN "hatch_date_approved_at" TIMESTAMP(3),
  ADD COLUMN "hatch_date_approval_status" TEXT,
  ADD COLUMN "hatch_date_rejection_reason" TEXT,
  ADD COLUMN "pending_hatched_on" DATE,
  ADD COLUMN "pending_hatch_evidence" TEXT,
  ADD COLUMN "pending_hatch_requested_by_id" UUID,
  ADD COLUMN "pending_hatch_date_estimated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pending_hatch_correction_reason" TEXT,
  ADD COLUMN "origin_type" "LivestockOrigin" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "origin_evidence" TEXT;

-- Existing estimated dates and origins predate governed evidence capture.
-- Preserve them and expose missing provenance to BIO_MASTER_CHECKS for cleanup.
