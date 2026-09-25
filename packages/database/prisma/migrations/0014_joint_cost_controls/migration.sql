-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "joint_cost_method" TEXT NOT NULL DEFAULT 'NRV';

-- AlterTable
ALTER TABLE "production_order_routing_lines" ADD COLUMN     "absorbed_cost_kobo" BIGINT,
ADD COLUMN     "actual_hours" DECIMAL(18,6);

-- CreateTable
CREATE TABLE "joint_output_prices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "selling_price_per_unit_kobo" BIGINT NOT NULL,
    "further_cost_per_unit_kobo" BIGINT NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "evidence_reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "proposed_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "joint_output_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "joint_output_prices_company_id_item_id_effective_from_idx" ON "joint_output_prices"("company_id", "item_id", "effective_from");

-- AddForeignKey
ALTER TABLE "joint_output_prices" ADD CONSTRAINT "joint_output_prices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_output_prices" ADD CONSTRAINT "joint_output_prices_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_output_prices" ADD CONSTRAINT "joint_output_prices_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_output_prices" ADD CONSTRAINT "joint_output_prices_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The released method is one of the methods the allocator implements.
ALTER TABLE "companies" ADD CONSTRAINT "companies_joint_cost_method_known"
  CHECK ("joint_cost_method" IN ('NRV', 'WEIGHT', 'SALES_VALUE', 'STANDARD_PERCENTAGE'));
ALTER TABLE "joint_output_prices" ADD CONSTRAINT "joint_output_prices_status_known" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE "joint_output_prices" ADD CONSTRAINT "joint_output_prices_amounts" CHECK ("selling_price_per_unit_kobo" > 0 AND "further_cost_per_unit_kobo" >= 0);
