-- AlterTable
ALTER TABLE "egg_collection_batches" ADD COLUMN     "hatching_value_kobo" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "egg_value_policies" ADD COLUMN     "hatching_value_per_unit_kobo" BIGINT;

-- AlterTable
ALTER TABLE "farm_cost_allocations" ADD COLUMN     "basis" TEXT NOT NULL DEFAULT 'ANIMAL_DAYS';

-- AlterTable
ALTER TABLE "farm_cost_allocation_lines" ADD COLUMN     "hours" DECIMAL(18,6);

-- CreateTable
CREATE TABLE "timesheet_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_hours" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "processing_cycle" "ProductionOrderCycle" NOT NULL,
    "hours" DECIMAL(10,2) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timesheet_entries_company_id_work_date_idx" ON "timesheet_entries"("company_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_entries_employee_id_group_id_work_date_key" ON "timesheet_entries"("employee_id", "group_id", "work_date");

-- CreateIndex
CREATE INDEX "machine_hours_company_id_financial_period_id_idx" ON "machine_hours"("company_id", "financial_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "machine_hours_asset_id_financial_period_id_processing_cycle_key" ON "machine_hours"("asset_id", "financial_period_id", "processing_cycle");

