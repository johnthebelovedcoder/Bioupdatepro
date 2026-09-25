-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "income_tax_rate_percent" DECIMAL(9,4) NOT NULL DEFAULT 30;


-- A rate is a percentage from 0 to 100.
ALTER TABLE "companies" ADD CONSTRAINT "companies_income_tax_rate_range" CHECK ("income_tax_rate_percent" >= 0 AND "income_tax_rate_percent" <= 100);
