ALTER TABLE "snail_breeding_cycles"
  ADD COLUMN "workflow_transaction_id" UUID;

INSERT INTO "workflow_definitions" (
  "id", "company_id", "transaction_type", "name", "description",
  "auto_post_on_approval", "active", "effective_from", "created_at", "updated_at"
)
SELECT gen_random_uuid(), c."id", 'SNAIL_EGG_RECOGNITION',
       'Snail egg recognition — standard approval',
       'Finance approval required before a viable egg cohort is recognized in the biological asset ledger.',
       true, true,
       LEAST(DATE '2026-01-01', COALESCE((SELECT MIN(y."start_date") FROM "financial_years" y WHERE y."company_id" = c."id"), DATE '2026-01-01')),
       now(), now()
FROM "companies" c
WHERE EXISTS (SELECT 1 FROM "workflow_definitions" d WHERE d."company_id" = c."id" AND d."transaction_type" = 'BA_VALUATION')
  AND NOT EXISTS (SELECT 1 FROM "workflow_definitions" d WHERE d."company_id" = c."id" AND d."transaction_type" = 'SNAIL_EGG_RECOGNITION');

INSERT INTO "workflow_steps" (
  "id", "definition_id", "level", "role_code", "name", "max_amount_kobo", "created_at", "updated_at"
)
SELECT gen_random_uuid(), d."id", s."level", s."role_code", s."name", s."max_amount_kobo", now(), now()
FROM "workflow_definitions" d
CROSS JOIN (VALUES
  (1, 'FARM_MANAGER', 'Farm Manager', 25000000::bigint),
  (2, 'FINANCE_MANAGER', 'Finance Manager', 200000000::bigint),
  (3, 'FINANCE_CONTROLLER', 'Finance Controller', 1000000000::bigint),
  (4, 'CFO', 'CFO', NULL::bigint)
) AS s("level", "role_code", "name", "max_amount_kobo")
WHERE d."transaction_type" = 'SNAIL_EGG_RECOGNITION'
  AND d."name" = 'Snail egg recognition — standard approval'
  AND NOT EXISTS (SELECT 1 FROM "workflow_steps" x WHERE x."definition_id" = d."id");
