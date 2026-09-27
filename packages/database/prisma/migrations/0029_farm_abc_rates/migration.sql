-- Farm lifecycle ABC rates (S_SNAILERY_ABC): per company, species, stage and
-- pool, the naira-per-driver-unit weight used to share a lifecycle cost pool
-- across stages. A company with no rows uses the workbook's defaults in code.
CREATE TABLE "farm_abc_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "species_key" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "pool" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "set_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_abc_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "farm_abc_rates_pool_check" CHECK ("pool" IN ('FEED', 'LABOUR')),
    CONSTRAINT "farm_abc_rates_rate_check" CHECK ("rate" >= 0)
);

CREATE UNIQUE INDEX "farm_abc_rates_company_id_species_key_stage_pool_key" ON "farm_abc_rates"("company_id", "species_key", "stage", "pool");
