-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "material_price_variance_kobo" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "material_usage_variance_kobo" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "standard_cost_version_id" UUID,
ADD COLUMN     "yield_variance_kobo" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "production_order_components" ADD COLUMN     "price_variance_kobo" BIGINT,
ADD COLUMN     "usage_variance_kobo" BIGINT;

-- CreateTable
CREATE TABLE "costing_policies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'STANDARD',
    "variance_disposition" TEXT NOT NULL DEFAULT 'COGS',
    "variance_tolerance_percent" DECIMAL(9,4) NOT NULL DEFAULT 20,
    "configured_by_id" UUID NOT NULL,
    "configured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),

    CONSTRAINT "costing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_cost_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "recipe_version_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "output_quantity" DECIMAL(18,6) NOT NULL,
    "material_kobo" BIGINT NOT NULL,
    "labour_kobo" BIGINT NOT NULL,
    "machine_kobo" BIGINT NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "unit_cost_kobo" BIGINT NOT NULL,
    "previous_unit_cost_kobo" BIGINT,
    "lines" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "prepared_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "standard_cost_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "costing_policies_company_id_financial_year_id_key" ON "costing_policies"("company_id", "financial_year_id");

-- CreateIndex
CREATE INDEX "standard_cost_versions_company_id_item_id_status_idx" ON "standard_cost_versions"("company_id", "item_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "standard_cost_versions_company_id_item_id_financial_year_id_key" ON "standard_cost_versions"("company_id", "item_id", "financial_year_id", "version_number");

-- AddForeignKey
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "product_recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "costing_policies" ADD CONSTRAINT "costing_policies_standard_only" CHECK ("method" = 'STANDARD');
ALTER TABLE "costing_policies" ADD CONSTRAINT "costing_policies_disposition_known" CHECK ("variance_disposition" IN ('COGS'));
ALTER TABLE "costing_policies" ADD CONSTRAINT "costing_policies_tolerance_range" CHECK ("variance_tolerance_percent" > 0 AND "variance_tolerance_percent" <= 100);
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_status_known" CHECK ("status" IN ('PENDING', 'RELEASED', 'REJECTED', 'SUPERSEDED'));
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_amounts" CHECK (
  "material_kobo" >= 0 AND "labour_kobo" >= 0 AND "machine_kobo" >= 0
  AND "total_kobo" = "material_kobo" + "labour_kobo" + "machine_kobo"
  AND "unit_cost_kobo" >= 0 AND "output_quantity" > 0);

-- A company already running production orders keeps posting: its current
-- year gets the only policy the client allows (standard cost), configured by
-- its first user and locked, since production has already posted in it.
INSERT INTO "costing_policies" ("id", "company_id", "financial_year_id", "configured_by_id", "configured_at", "locked_at")
SELECT gen_random_uuid(), fy."company_id", fy."id",
  (SELECT u."id" FROM "users" u WHERE u."company_id" = fy."company_id" ORDER BY u."created_at" LIMIT 1),
  now(), now()
FROM "financial_years" fy
WHERE now()::date BETWEEN fy."start_date" AND fy."end_date"
  AND EXISTS (SELECT 1 FROM "production_orders" po WHERE po."company_id" = fy."company_id")
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."company_id" = fy."company_id");
