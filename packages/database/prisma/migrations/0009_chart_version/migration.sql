-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "chart_version" TEXT NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "cost_of_sales_gl_account_id" UUID;

-- AlterTable
ALTER TABLE "biological_asset_valuations" ADD COLUMN     "rearing_cost_absorbed_kobo" BIGINT NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_cost_of_sales_gl_account_id_fkey" FOREIGN KEY ("cost_of_sales_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Two accounts the old chart had and the client's chart lacked, added so every
-- balance has a six-digit home when a company unifies (decided 2026-09-25):
--   125200  WHT Receivable       (was 1602)
--   690100  Operating Expenses   (was 5401)
INSERT INTO "gl_accounts" ("id", "company_id", "account_number", "name", "account_type", "normal_balance", "is_posting_account", "active", "updated_at")
SELECT gen_random_uuid(), c."company_id", a."number", a."name", a."type"::"AccountType", a."normal"::"NormalBalance", true, true, NOW()
FROM (SELECT DISTINCT "company_id" FROM "posting_keys") c
CROSS JOIN (VALUES
  ('125200', 'WHT Receivable', 'ASSET', 'DEBIT'),
  ('690100', 'Operating Expenses', 'EXPENSE', 'DEBIT')
) AS a("number", "name", "type", "normal")
WHERE NOT EXISTS (
  SELECT 1 FROM "gl_accounts" g WHERE g."company_id" = c."company_id" AND g."account_number" = a."number"
);
