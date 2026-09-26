-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "bank_set_at" TIMESTAMP(3),
ADD COLUMN     "bank_set_by_id" UUID,
ADD COLUMN     "bank_verification_reference" TEXT,
ADD COLUMN     "bank_verified_at" TIMESTAMP(3),
ADD COLUMN     "bank_verified_by_id" UUID;

-- CreateTable
CREATE TABLE "purchase_budgets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "cost_centre_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "note" TEXT,
    "set_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_budgets_company_id_financial_year_id_cost_centre_i_key" ON "purchase_budgets"("company_id", "financial_year_id", "cost_centre_id");


ALTER TABLE "purchase_budgets" ADD CONSTRAINT "purchase_budgets_amount" CHECK ("amount_kobo" >= 0);
