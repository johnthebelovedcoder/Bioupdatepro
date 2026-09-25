-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "reference_code" TEXT;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "voucher_number" TEXT;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "client_reference" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "client_reference" TEXT;

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "prefix" TEXT NOT NULL,
    "site_code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_company_id_prefix_site_code_year_key" ON "document_sequences"("company_id", "prefix", "site_code", "year");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_company_id_voucher_number_key" ON "journal_entries"("company_id", "voucher_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_company_id_client_reference_key" ON "sales_orders"("company_id", "client_reference");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_client_reference_key" ON "purchase_orders"("company_id", "client_reference");

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Every existing company gets an entity code from its own code: the first
-- three letters or digits, upper case (Numbering_Parameters: ENTITY, 3).
UPDATE "companies"
SET "reference_code" = UPPER(RPAD(LEFT(REGEXP_REPLACE("code", '[^A-Za-z0-9]', '', 'g'), 3), 3, 'X'))
WHERE "reference_code" IS NULL;

-- A sequence only moves forward: no number is ever handed out twice.
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_positive" CHECK ("last_value" >= 0);

CREATE OR REPLACE FUNCTION bap_document_sequence_forward()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_value < OLD.last_value THEN
    RAISE EXCEPTION 'Sequence %-%-% cannot go back from % to %: numbers are never reused.',
      OLD.prefix, OLD.site_code, OLD.year, OLD.last_value, NEW.last_value
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_sequence_forward ON "document_sequences";
CREATE TRIGGER trg_document_sequence_forward
  BEFORE UPDATE ON "document_sequences"
  FOR EACH ROW EXECUTE FUNCTION bap_document_sequence_forward();
