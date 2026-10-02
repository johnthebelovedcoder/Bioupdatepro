-- Apply the approved defaults for joint costing. Preserve explicitly selected
-- methods; only replace the prior system default.
ALTER TABLE companies ALTER COLUMN joint_cost_method SET DEFAULT 'SALES_VALUE';
UPDATE companies SET joint_cost_method = 'SALES_VALUE' WHERE joint_cost_method = 'NRV';

-- The approved COA requires cost-centre analysis on P&L, biological asset,
-- inventory, WIP, recovery and variance accounts.
UPDATE gl_accounts
SET requires_cost_centre = TRUE
WHERE account_number ~ '^[456]'
   OR account_number LIKE '12%'
   OR account_number LIKE '13%'
   OR account_number LIKE '2198%';
