ALTER TABLE "production_order_outputs"
ADD COLUMN "allocation_percentage" DECIMAL(7,4);

ALTER TABLE "companies"
DROP CONSTRAINT "companies_joint_cost_method_known";

ALTER TABLE "companies"
ADD CONSTRAINT "companies_joint_cost_method_known"
CHECK ("joint_cost_method" IN ('NRV', 'WEIGHT', 'SALES_VALUE', 'STANDARD_PERCENTAGE', 'MANUAL'));

CREATE TABLE "joint_output_standard_allocations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "allocation_percentage" DECIMAL(7,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "evidence_reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "proposed_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "joint_output_standard_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "joint_output_standard_allocations_company_id_item_id_effective_from_idx"
ON "joint_output_standard_allocations"("company_id", "item_id", "effective_from");

ALTER TABLE "joint_output_standard_allocations"
ADD CONSTRAINT "joint_output_standard_allocations_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "joint_output_standard_allocations"
ADD CONSTRAINT "joint_output_standard_allocations_item_id_fkey"
FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "joint_output_standard_allocations"
ADD CONSTRAINT "joint_output_standard_allocations_proposed_by_id_fkey"
FOREIGN KEY ("proposed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "joint_output_standard_allocations"
ADD CONSTRAINT "joint_output_standard_allocations_approved_by_id_fkey"
FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
