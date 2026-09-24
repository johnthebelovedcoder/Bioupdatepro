-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "rearing_cost_kobo" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "livestock_rearing_reliefs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "count" INTEGER NOT NULL,
    "population_before" INTEGER NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "journal_entry_id" UUID,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livestock_rearing_reliefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "opening_balance_kobo" BIGINT NOT NULL,
    "closing_balance_kobo" BIGINT NOT NULL,
    "source_file_name" TEXT,
    "imported_by_id" UUID NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "value_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount_kobo" BIGINT NOT NULL,
    "status" "BankLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matched_journal_line_id" UUID,
    "ignored_reason" TEXT,
    "settled_by_id" UUID,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snail_breeding_cycles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "breeder_group_id" UUID NOT NULL,
    "set_on" DATE NOT NULL,
    "breeders" INTEGER NOT NULL,
    "eggs_laid" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SET',
    "hatched_on" DATE,
    "hatched_count" INTEGER,
    "unhatched_count" INTEGER,
    "hatchling_group_id" UUID,
    "failed_reason" TEXT,
    "notes" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snail_breeding_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "livestock_rearing_reliefs_group_id_idx" ON "livestock_rearing_reliefs"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_rearing_reliefs_group_id_event_type_source_id_key" ON "livestock_rearing_reliefs"("group_id", "event_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_company_id_gl_account_id_key" ON "bank_accounts"("company_id", "gl_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_company_id_name_key" ON "bank_accounts"("company_id", "name");

-- CreateIndex
CREATE INDEX "bank_statements_bank_account_id_period_to_idx" ON "bank_statements"("bank_account_id", "period_to");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_matched_journal_line_id_key" ON "bank_statement_lines"("matched_journal_line_id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_status_idx" ON "bank_statement_lines"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_statement_id_line_number_key" ON "bank_statement_lines"("statement_id", "line_number");

-- CreateIndex
CREATE INDEX "snail_breeding_cycles_company_id_breeder_group_id_idx" ON "snail_breeding_cycles"("company_id", "breeder_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "snail_breeding_cycles_company_id_code_key" ON "snail_breeding_cycles"("company_id", "code");

-- AddForeignKey
ALTER TABLE "livestock_rearing_reliefs" ADD CONSTRAINT "livestock_rearing_reliefs_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

