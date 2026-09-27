-- Approval routes a registered farm was never given (found by the 40-step
-- rehearsal): paying payroll, disposing of a fixed asset, reopening a period,
-- and claiming abnormal biological mortality or an abnormal production loss.
-- With no route, the application refuses the submission, so a new farm could
-- not pay its staff. Sign-up now creates them; this adds them, on the same
-- illustrative ladder as every other route, to farms that already exist and
-- have the standard routes but not these. A farm with its own route for a
-- type is left alone.
WITH missing(transaction_type, name, auto_post) AS (
  VALUES
    ('PAYROLL_PAYMENT', 'Payroll Payment', true),
    ('FIXED_ASSET_DISPOSAL', 'Fixed Asset Disposal', true),
    ('PERIOD_REOPEN', 'Period Reopen', false),
    ('BIOLOGICAL_ASSET_ABNORMAL_MORTALITY', 'Biological Asset — abnormal mortality claim', true),
    ('PRODUCTION_ORDER_ABNORMAL_LOSS', 'Production Order — abnormal loss claim', true)
),
targets AS (
  SELECT c.id AS company_id, m.transaction_type, m.name, m.auto_post,
         LEAST(DATE '2026-01-01', COALESCE((SELECT MIN(y.start_date) FROM financial_years y WHERE y.company_id = c.id), DATE '2026-01-01')) AS effective_from
  FROM companies c
  CROSS JOIN missing m
  WHERE EXISTS (SELECT 1 FROM workflow_definitions d WHERE d.company_id = c.id AND d.transaction_type = 'PAYROLL_RUN')
    AND NOT EXISTS (SELECT 1 FROM workflow_definitions d WHERE d.company_id = c.id AND d.transaction_type = m.transaction_type)
),
inserted AS (
  INSERT INTO workflow_definitions (id, company_id, transaction_type, name, description, auto_post_on_approval, active, effective_from, created_at, updated_at)
  SELECT gen_random_uuid(), company_id, transaction_type, name || ' — standard approval',
         'Company-wide default route. Add a narrower definition to give a branch, farm or cost centre its own ladder.',
         auto_post, true, effective_from, now(), now()
  FROM targets
  RETURNING id
)
INSERT INTO workflow_steps (id, definition_id, level, role_code, name, max_amount_kobo, created_at, updated_at)
SELECT gen_random_uuid(), i.id, l.level, l.role_code, l.name, l.max_amount_kobo, now(), now()
FROM inserted i
CROSS JOIN (VALUES
  (1, 'FARM_MANAGER', 'Farm Manager', 25000000::bigint),
  (2, 'FINANCE_MANAGER', 'Finance Manager', 200000000::bigint),
  (3, 'FINANCE_CONTROLLER', 'Finance Controller', 1000000000::bigint),
  (4, 'CFO', 'CFO', NULL::bigint)
) AS l(level, role_code, name, max_amount_kobo);
