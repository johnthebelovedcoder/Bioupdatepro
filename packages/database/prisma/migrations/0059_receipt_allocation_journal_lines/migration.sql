-- Allow customer receipts to settle non-invoice AR items, such as asset-sale
-- proceeds, while retaining exactly one open-item target per allocation.
ALTER TABLE "receipt_allocations"
  ALTER COLUMN "invoice_id" DROP NOT NULL,
  ADD COLUMN "journal_line_id" UUID;

ALTER TABLE "receipt_allocations"
  ADD CONSTRAINT "receipt_allocations_one_target_check"
  CHECK (("invoice_id" IS NOT NULL)::integer + ("journal_line_id" IS NOT NULL)::integer = 1);

ALTER TABLE "receipt_allocations"
  ADD CONSTRAINT "receipt_allocations_journal_line_id_fkey"
  FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "receipt_allocations_journal_line_id_idx"
  ON "receipt_allocations"("journal_line_id");

CREATE UNIQUE INDEX "receipt_allocations_receipt_journal_line_key"
  ON "receipt_allocations"("receipt_id", "journal_line_id");
