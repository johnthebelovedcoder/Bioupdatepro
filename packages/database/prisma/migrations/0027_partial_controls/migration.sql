-- The partial control rows: shifts and order time (INT-013), cost pool
-- sources (AC-MFG-004) and variance proration (POL-009).

-- AlterTable
ALTER TABLE "costing_policies" ADD COLUMN     "proration_threshold_kobo" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "timesheet_entries" ADD COLUMN     "ends_at" TIMESTAMP(3),
ADD COLUMN     "production_order_id" UUID,
ADD COLUMN     "starts_at" TIMESTAMP(3),
ALTER COLUMN "group_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "cost_pool_sources" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_pool_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variance_prorations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "total_variance_kobo" BIGINT NOT NULL,
    "cogs_base_kobo" BIGINT NOT NULL,
    "fg_base_kobo" BIGINT NOT NULL,
    "wip_base_kobo" BIGINT NOT NULL,
    "to_cogs_kobo" BIGINT NOT NULL,
    "to_fg_kobo" BIGINT NOT NULL,
    "to_wip_kobo" BIGINT NOT NULL,
    "journal_entry_id" UUID,
    "reversal_journal_entry_id" UUID,
    "reversed_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variance_prorations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_pool_sources_pool_id_gl_account_id_cost_centre_id_key" ON "cost_pool_sources"("pool_id", "gl_account_id", "cost_centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "variance_prorations_company_id_financial_year_id_key" ON "variance_prorations"("company_id", "financial_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_entries_employee_id_production_order_id_work_date_key" ON "timesheet_entries"("employee_id", "production_order_id", "work_date");

-- AddForeignKey
ALTER TABLE "cost_pool_sources" ADD CONSTRAINT "cost_pool_sources_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "cost_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_one_target_check"
  CHECK (("group_id" IS NULL) <> ("production_order_id" IS NULL));
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_shift_check"
  CHECK (("starts_at" IS NULL) = ("ends_at" IS NULL) AND ("starts_at" IS NULL OR "ends_at" > "starts_at"));

ALTER TABLE "costing_policies" DROP CONSTRAINT IF EXISTS "costing_policies_disposition_known";
ALTER TABLE "costing_policies" ADD CONSTRAINT "costing_policies_disposition_known" CHECK ("variance_disposition" IN ('COGS', 'PRORATE'));
ALTER TABLE "costing_policies" ADD CONSTRAINT "costing_policies_threshold_check" CHECK ("proration_threshold_kobo" >= 0);

-- Where prorated variance is held in stock and WIP, on every legacy chart
-- (the spec chart has no number; 130590 and 130595 are added by hand there).
INSERT INTO "gl_accounts" ("id", "company_id", "account_number", "name", "account_type", "normal_balance", "is_posting_account", "active", "fs_category", "created_at", "updated_at")
SELECT gen_random_uuid(), a."company_id", v."number", v."name", a."account_type", a."normal_balance", true, true, a."fs_category", now(), now()
FROM "gl_accounts" a
CROSS JOIN (VALUES ('1402', 'Finished Goods - Capitalised Variance'), ('1403', 'Work in Progress - Capitalised Variance')) AS v("number", "name")
WHERE a."account_number" = '1401'
  AND NOT EXISTS (SELECT 1 FROM "gl_accounts" b WHERE b."company_id" = a."company_id" AND b."account_number" = v."number");

-- The same three on six-digit charts, where the client's chart names none:
-- 630200 impairment loss (IAS 36) and 130590/130595 capitalised variance.
INSERT INTO "gl_accounts" ("id", "company_id", "account_number", "name", "account_type", "normal_balance", "is_posting_account", "active", "updated_at")
SELECT gen_random_uuid(), c."id", v."number", v."name", v."type"::"AccountType", v."normal"::"NormalBalance", true, true, now()
FROM "companies" c
CROSS JOIN (VALUES
  ('630200', 'Impairment Loss - Fixed Assets', 'EXPENSE', 'DEBIT'),
  ('130590', 'Finished Goods - Capitalised Variance', 'ASSET', 'DEBIT'),
  ('130595', 'Work in Progress - Capitalised Variance', 'ASSET', 'DEBIT')
) AS v("number", "name", "type", "normal")
WHERE c."chart_version" = 'SPEC'
  AND NOT EXISTS (SELECT 1 FROM "gl_accounts" b WHERE b."company_id" = c."id" AND b."account_number" = v."number");
