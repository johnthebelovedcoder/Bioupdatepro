-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COUNTING',
    "recount_threshold_percent" DECIMAL(9,4) NOT NULL DEFAULT 5,
    "frozen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_by_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "journal_entry_id" UUID,
    "net_adjustment_kobo" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "book_quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost_kobo" BIGINT NOT NULL,
    "counted_quantity" DECIMAL(18,6),
    "counted_by_id" UUID,
    "recount_required" BOOLEAN NOT NULL DEFAULT false,
    "recount_quantity" DECIMAL(18,6),
    "recounted_by_id" UUID,
    "reason" TEXT,
    "variance_quantity" DECIMAL(18,6),
    "variance_value_kobo" BIGINT,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_counts_company_id_warehouse_id_status_idx" ON "stock_counts"("company_id", "warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_company_id_reference_key" ON "stock_counts"("company_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_stock_count_id_item_id_key" ON "stock_count_lines"("stock_count_id", "item_id");

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_status_known" CHECK ("status" IN ('COUNTING', 'SUBMITTED', 'ON_HOLD', 'POSTED', 'CANCELLED'));
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_threshold_range" CHECK ("recount_threshold_percent" >= 0 AND "recount_threshold_percent" <= 100);
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_quantities" CHECK (
  "book_quantity" >= 0 AND ("counted_quantity" IS NULL OR "counted_quantity" >= 0) AND ("recount_quantity" IS NULL OR "recount_quantity" >= 0));

-- One open count per store: the freeze has one owner.
CREATE UNIQUE INDEX "stock_counts_one_open_per_store" ON "stock_counts" ("company_id", "warehouse_id")
  WHERE "status" IN ('COUNTING', 'SUBMITTED', 'ON_HOLD');
