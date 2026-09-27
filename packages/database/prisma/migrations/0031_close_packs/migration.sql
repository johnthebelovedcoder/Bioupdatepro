-- The close pack (§8): the trial balance as it stood when a period or year was
-- closed, with its SHA-256 fingerprint, so anyone can later check the stored
-- figures were not altered and whether the ledger still agrees with them.
CREATE TABLE "close_packs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID,
    "scope" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "close_packs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "close_packs_scope_check" CHECK ("scope" IN ('PERIOD', 'YEAR')),
    CONSTRAINT "close_packs_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "close_packs_company_id_financial_year_id_idx" ON "close_packs"("company_id", "financial_year_id");
