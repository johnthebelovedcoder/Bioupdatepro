-- AlterTable
ALTER TABLE "egg_collection_batches" ADD COLUMN     "eggs_per_unit" INTEGER,
ADD COLUMN     "item_id" UUID,
ADD COLUMN     "value_kobo" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "incubation_batches" ADD COLUMN     "journal_entry_id" UUID,
ADD COLUMN     "value_kobo" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "processing_cycle" "ProductionOrderCycle";

-- CreateTable
CREATE TABLE "egg_value_policies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "eggs_per_unit" INTEGER NOT NULL,
    "value_per_unit_kobo" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "egg_value_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_cost_allocations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_cost_allocation_sources" (
    "id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "amount_kobo" BIGINT NOT NULL,

    CONSTRAINT "farm_cost_allocation_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_cost_allocation_lines" (
    "id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "species_key" TEXT NOT NULL,
    "animal_days" DECIMAL(18,6) NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,

    CONSTRAINT "farm_cost_allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "egg_value_policies_company_id_effective_from_key" ON "egg_value_policies"("company_id", "effective_from");

-- CreateIndex
CREATE INDEX "farm_cost_allocations_company_id_financial_period_id_idx" ON "farm_cost_allocations"("company_id", "financial_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "farm_cost_allocations_company_id_reference_key" ON "farm_cost_allocations"("company_id", "reference");

-- CreateIndex
CREATE INDEX "farm_cost_allocation_sources_allocation_id_idx" ON "farm_cost_allocation_sources"("allocation_id");

-- CreateIndex
CREATE INDEX "farm_cost_allocation_lines_allocation_id_idx" ON "farm_cost_allocation_lines"("allocation_id");

-- CreateIndex
CREATE INDEX "farm_cost_allocation_lines_group_id_idx" ON "farm_cost_allocation_lines"("group_id");

-- AddForeignKey
ALTER TABLE "incubation_batches" ADD CONSTRAINT "incubation_batches_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_cost_allocations" ADD CONSTRAINT "farm_cost_allocations_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_cost_allocation_sources" ADD CONSTRAINT "farm_cost_allocation_sources_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "farm_cost_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_cost_allocation_lines" ADD CONSTRAINT "farm_cost_allocation_lines_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "farm_cost_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Two accounts the workbook implies but never names with a single code, added
-- to every farm that has its posting rules loaded (new farms get them from
-- the provisioning chart):
--   420210  PCR-067-CR "130210/420210" — eggs are agricultural produce, so
--           recognising them at value is a gain (IAS 41), not a change in the
--           layers themselves.
--   623100  PCR-031-DR "Processing/Feed-mill OH Expense" — the feed mill's
--           overhead pool; snail and poultry processing already have theirs
--           (621200, 622100).
INSERT INTO "gl_accounts" ("id", "company_id", "account_number", "name", "account_type", "normal_balance", "is_posting_account", "active", "updated_at")
SELECT gen_random_uuid(), c."company_id", a."number", a."name", a."type"::"AccountType", a."normal"::"NormalBalance", true, true, NOW()
FROM (SELECT DISTINCT "company_id" FROM "posting_keys") c
CROSS JOIN (VALUES
  ('420210', 'Agricultural Produce Gain — Eggs', 'REVENUE', 'CREDIT'),
  ('623100', 'Feed Mill Overhead Expense', 'EXPENSE', 'DEBIT')
) AS a("number", "name", "type", "normal")
WHERE NOT EXISTS (
  SELECT 1 FROM "gl_accounts" g WHERE g."company_id" = c."company_id" AND g."account_number" = a."number"
);

-- The last six unresolved posting keys, now resolved by the code this
-- migration's tables serve (see DYNAMIC_RESOLUTION in the provisioning
-- service). Only keys still unresolved are touched.
UPDATE "posting_keys" SET "dynamic_resolution" = CASE "key"
  WHEN 'PCR-028-DR' THEN 'FarmCostAllocationService.post() — payroll shared by animal-days to each flock’s Work in Progress (1501) or snail cohort (612000); credits back the salary expense the payroll run charged, since that run already credited Payroll Payable (220100)'
  WHEN 'PCR-031-DR' THEN 'FixedAssetService.postApprovedDepreciation() — a machine marked with a processing line posts to that line’s overhead: 621200 snail, 622100 poultry, 623100 feed mill'
  WHEN 'PCR-043-CR' THEN 'FarmCostAllocationService.post() — each source account chosen for the run (payroll, overhead or depreciation expense), credited by the amount allocated'
  WHEN 'PCR-064-DR' THEN 'FarmCostAllocationService.post() — capitalised into the flock’s Work in Progress (1501), relieved at weighted average'
  WHEN 'PCR-064-CR' THEN 'FarmCostAllocationService.post() — each source account chosen for the run (payroll, overhead or depreciation expense), credited by the amount allocated'
  WHEN 'PCR-067-CR' THEN 'EggPostingService.postCollection() — Agricultural Produce Gain — Eggs (420210): eggs are produce, recognised at the farm’s dated value per crate'
END,
"updated_at" = NOW()
WHERE "key" IN ('PCR-028-DR', 'PCR-031-DR', 'PCR-043-CR', 'PCR-064-DR', 'PCR-064-CR', 'PCR-067-CR')
  AND "atomic" = false
  AND "dynamic_resolution" IS NULL;
