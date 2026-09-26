-- Operational features from the handbook: poultry plant intake and cold-store
-- detail on outputs, feed plan rates, feed quality plan, supplier returns and
-- debit notes, fixed-asset impairment and transfer, and bank payment files.

-- CreateEnum
CREATE TYPE "FeedQualityDisposition" AS ENUM ('PENDING', 'RELEASED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupplierReturnStatus" AS ENUM ('PENDING', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImpairmentStatus" AS ENUM ('PENDING', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentFileKind" AS ENUM ('SUPPLIER', 'SALARY');

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "condemnation_reason" TEXT,
ADD COLUMN     "condemned_count" INTEGER,
ADD COLUMN     "condemned_weight_kg" DECIMAL(18,6),
ADD COLUMN     "dead_on_arrival_count" INTEGER,
ADD COLUMN     "dead_on_arrival_weight_kg" DECIMAL(18,6),
ADD COLUMN     "intake_inspected_by" TEXT,
ADD COLUMN     "intake_recorded_at" TIMESTAMP(3),
ADD COLUMN     "intake_recorded_by_id" UUID,
ADD COLUMN     "plant_received_count" INTEGER,
ADD COLUMN     "plant_received_weight_kg" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "production_order_outputs" ADD COLUMN     "expiry_date" DATE,
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "storage_temperature_c" DECIMAL(5,1);

-- AlterTable
ALTER TABLE "payroll_payments" ADD COLUMN     "payment_file_id" UUID;

-- AlterTable
ALTER TABLE "goods_receipt_note_lines" ADD COLUMN     "debit_noted_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
ADD COLUMN     "returned_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "payment_file_id" UUID;

-- AlterTable
ALTER TABLE "species_breed_stages" ADD COLUMN     "daily_feed_grams_per_head" INTEGER;

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "impaired_kobo" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "feed_quality_specs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "min_protein_percent" DECIMAL(6,2),
    "max_moisture_percent" DECIMAL(6,2),
    "max_aflatoxin_ppb" DECIMAL(10,2),
    "sampling_note" TEXT,
    "set_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "feed_quality_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_quality_tests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "sampled_on" DATE NOT NULL,
    "protein_percent" DECIMAL(6,2),
    "moisture_percent" DECIMAL(6,2),
    "aflatoxin_ppb" DECIMAL(10,2),
    "contamination_note" TEXT,
    "passed" BOOLEAN NOT NULL,
    "failures" TEXT[],
    "disposition" "FeedQualityDisposition" NOT NULL DEFAULT 'PENDING',
    "tested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "feed_quality_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "grn_id" UUID NOT NULL,
    "return_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SupplierReturnStatus" NOT NULL DEFAULT 'PENDING',
    "stock_value_kobo" BIGINT NOT NULL DEFAULT 0,
    "debit_note_kobo" BIGINT NOT NULL DEFAULT 0,
    "debit_note_invoice_id" UUID,
    "journal_entry_id" UUID,
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "grn_line_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_impairments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "impaired_on" DATE NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "recoverable_amount_kobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "status" "ImpairmentStatus" NOT NULL DEFAULT 'PENDING',
    "journal_entry_id" UUID,
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "fixed_asset_impairments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_transfers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "from_cost_centre_id" UUID,
    "to_cost_centre_id" UUID,
    "effective_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "moved_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "fixed_asset_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_files" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "PaymentFileKind" NOT NULL,
    "row_count" INTEGER NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "payment_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feed_quality_specs_company_id_item_id_key" ON "feed_quality_specs"("company_id", "item_id");

-- CreateIndex
CREATE INDEX "feed_quality_tests_production_order_id_idx" ON "feed_quality_tests"("production_order_id");

-- CreateIndex
CREATE INDEX "supplier_returns_company_id_status_idx" ON "supplier_returns"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_company_id_return_number_key" ON "supplier_returns"("company_id", "return_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_return_lines_return_id_grn_line_id_key" ON "supplier_return_lines"("return_id", "grn_line_id");

-- CreateIndex
CREATE INDEX "fixed_asset_impairments_company_id_status_idx" ON "fixed_asset_impairments"("company_id", "status");

-- CreateIndex
CREATE INDEX "fixed_asset_transfers_asset_id_effective_on_idx" ON "fixed_asset_transfers"("asset_id", "effective_on");

-- CreateIndex
CREATE UNIQUE INDEX "payment_files_company_id_reference_key" ON "payment_files"("company_id", "reference");

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_payment_file_id_fkey" FOREIGN KEY ("payment_file_id") REFERENCES "payment_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_payment_file_id_fkey" FOREIGN KEY ("payment_file_id") REFERENCES "payment_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_quality_tests" ADD CONSTRAINT "feed_quality_tests_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "supplier_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_grn_line_id_fkey" FOREIGN KEY ("grn_line_id") REFERENCES "goods_receipt_note_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_impairments" ADD CONSTRAINT "fixed_asset_impairments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transfers" ADD CONSTRAINT "fixed_asset_transfers_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quality results and amounts are never negative.
ALTER TABLE "feed_quality_tests" ADD CONSTRAINT "feed_quality_tests_values_check"
  CHECK (coalesce("protein_percent", 0) >= 0 AND coalesce("moisture_percent", 0) >= 0 AND coalesce("aflatoxin_ppb", 0) >= 0);
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_returned_check"
  CHECK ("returned_quantity" >= 0 AND "debit_noted_quantity" >= 0 AND "debit_noted_quantity" <= "returned_quantity" AND "returned_quantity" <= "accepted_quantity");
ALTER TABLE "fixed_asset_impairments" ADD CONSTRAINT "fixed_asset_impairments_amount_check" CHECK ("amount_kobo" > 0 AND "recoverable_amount_kobo" >= 0);
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_impaired_check" CHECK ("impaired_kobo" >= 0);
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_intake_check"
  CHECK (coalesce("dead_on_arrival_count", 0) >= 0 AND coalesce("condemned_count", 0) >= 0
     AND coalesce("dead_on_arrival_weight_kg", 0) >= 0 AND coalesce("condemned_weight_kg", 0) >= 0);

-- Impairment loss account beside depreciation expense, on every legacy chart
-- (the spec chart has no approved number for it; 630200 is added by hand there).
INSERT INTO "gl_accounts" ("id", "company_id", "account_number", "name", "account_type", "normal_balance",
  "parent_id", "is_posting_account", "active", "fs_category", "created_at", "updated_at")
SELECT gen_random_uuid(), a."company_id", '5502', 'Impairment Loss - Fixed Assets', a."account_type", a."normal_balance",
  a."parent_id", true, true, a."fs_category", now(), now()
FROM "gl_accounts" a
WHERE a."account_number" = '5501'
  AND NOT EXISTS (SELECT 1 FROM "gl_accounts" b WHERE b."company_id" = a."company_id" AND b."account_number" = '5502');
