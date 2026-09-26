-- Unsafe-stock controls: lots with expiry and quarantine (FEFO issue),
-- item quarantine and shelf life, and the incubation log.

-- CreateEnum
CREATE TYPE "StockLotStatus" AS ENUM ('AVAILABLE', 'QUARANTINE', 'REJECTED');

-- CreateEnum
CREATE TYPE "IncubationReadingKind" AS ENUM ('ENVIRONMENT', 'CANDLING');

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "quarantine_on_receipt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shelf_life_days" INTEGER;

-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "lot_allocation" JSONB;

-- AlterTable
ALTER TABLE "inventory_write_offs" ADD COLUMN     "lot_reference" TEXT;

-- AlterTable
ALTER TABLE "goods_receipt_notes" ADD COLUMN     "quarantine" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_reference" TEXT NOT NULL,
    "expiry_date" DATE,
    "received_on" DATE NOT NULL,
    "status" "StockLotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "received_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incubation_standards" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "min_temperature_c" DECIMAL(5,2) NOT NULL,
    "max_temperature_c" DECIMAL(5,2) NOT NULL,
    "min_humidity_percent" DECIMAL(5,2) NOT NULL,
    "max_humidity_percent" DECIMAL(5,2) NOT NULL,
    "reading_interval_hours" INTEGER NOT NULL,
    "set_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incubation_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incubation_readings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "incubation_batch_id" UUID NOT NULL,
    "kind" "IncubationReadingKind" NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL,
    "temperature_c" DECIMAL(5,2),
    "humidity_percent" DECIMAL(5,2),
    "turned" BOOLEAN,
    "fertile_count" INTEGER,
    "clear_count" INTEGER,
    "dead_in_shell_count" INTEGER,
    "note" TEXT,
    "exceptions" TEXT[],
    "recorded_by_id" UUID NOT NULL,
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMP(3),
    "action_taken" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incubation_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_lots_company_id_status_idx" ON "stock_lots"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_company_id_item_id_lot_reference_key" ON "stock_lots"("company_id", "item_id", "lot_reference");

-- CreateIndex
CREATE UNIQUE INDEX "incubation_standards_company_id_key" ON "incubation_standards"("company_id");

-- CreateIndex
CREATE INDEX "incubation_readings_incubation_batch_id_read_at_idx" ON "incubation_readings"("incubation_batch_id", "read_at");

-- CreateIndex
CREATE INDEX "incubation_readings_company_id_acknowledged_at_idx" ON "incubation_readings"("company_id", "acknowledged_at");

-- AddForeignKey
ALTER TABLE "incubation_readings" ADD CONSTRAINT "incubation_readings_incubation_batch_id_fkey" FOREIGN KEY ("incubation_batch_id") REFERENCES "incubation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "incubation_readings" ADD CONSTRAINT "incubation_readings_counts_check"
  CHECK (coalesce("fertile_count", 0) >= 0 AND coalesce("clear_count", 0) >= 0 AND coalesce("dead_in_shell_count", 0) >= 0);
ALTER TABLE "incubation_standards" ADD CONSTRAINT "incubation_standards_range_check"
  CHECK ("min_temperature_c" <= "max_temperature_c" AND "min_humidity_percent" <= "max_humidity_percent" AND "reading_interval_hours" > 0);
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_life_check" CHECK ("shelf_life_days" IS NULL OR "shelf_life_days" > 0);

-- Stock already received with an expiry date but no lot number gets one on
-- its receipt line (the receipt number and line), so its expiry can be
-- enforced. The stock ledger is append-only, so its movements keep no lot
-- number; a lot is matched to them through its receipt (source_id).
UPDATE "goods_receipt_note_lines" l
SET "batch_reference" = g."grn_number" || '/' || l."line_number"
FROM "goods_receipt_notes" g
WHERE g."id" = l."goods_receipt_note_id" AND l."expiry_date" IS NOT NULL AND l."batch_reference" IS NULL;

-- Every lot already received on a posted receipt, with its earliest expiry.
INSERT INTO "stock_lots" ("id", "company_id", "item_id", "lot_reference", "expiry_date", "received_on", "status", "source_type", "source_id", "created_at")
SELECT gen_random_uuid(), g."company_id", l."item_id", l."batch_reference", min(l."expiry_date"), min(g."receipt_date"), 'AVAILABLE', 'GoodsReceiptNote', min(g."id"::text), now()
FROM "goods_receipt_note_lines" l
JOIN "goods_receipt_notes" g ON g."id" = l."goods_receipt_note_id"
WHERE g."status" = 'POSTED' AND l."batch_reference" IS NOT NULL
GROUP BY g."company_id", l."item_id", l."batch_reference"
ON CONFLICT ("company_id", "item_id", "lot_reference") DO NOTHING;
