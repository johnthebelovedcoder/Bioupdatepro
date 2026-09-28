-- Feed-mill recovery by species (client decision, 2026-09-28): snail feed
-- absorbs to S_Feed_Recovery_GL and poultry feed to P_Feed_Recovery_GL, as
-- FeedMill_Setup and FeedMill_Accounting describe. Feed orders carry their
-- species; farms on the six-digit chart get the two accounts. 219830 stays for
-- orders raised before the split.
ALTER TABLE "production_orders" ADD COLUMN "species_key" TEXT;

INSERT INTO gl_accounts (id, company_id, account_number, name, account_type, normal_balance, is_posting_account, active, created_at, updated_at)
SELECT gen_random_uuid(), a.company_id, v.number, v.name, 'LIABILITY', 'CREDIT', true, true, now(), now()
FROM gl_accounts a
CROSS JOIN (VALUES ('219831', 'S_Feed_Recovery_GL'), ('219832', 'P_Feed_Recovery_GL')) AS v(number, name)
WHERE a.account_number = '219830'
  AND NOT EXISTS (SELECT 1 FROM gl_accounts b WHERE b.company_id = a.company_id AND b.account_number = v.number);
