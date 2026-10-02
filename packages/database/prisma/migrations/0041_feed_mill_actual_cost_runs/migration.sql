ALTER TABLE cost_pool_sources
  ADD COLUMN resource_type "RoutingResourceType" NOT NULL DEFAULT 'OVERHEAD';

CREATE TABLE feed_mill_actual_cost_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  financial_period_id UUID NOT NULL REFERENCES financial_periods(id),
  prepared_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, financial_period_id)
);

CREATE TABLE feed_mill_actual_cost_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES feed_mill_actual_cost_runs(id) ON DELETE CASCADE,
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  cost_pool_id UUID NOT NULL REFERENCES cost_pools(id),
  source_gl_account_id UUID NOT NULL REFERENCES gl_accounts(id),
  source_cost_centre_id UUID REFERENCES cost_centres(id),
  source_cost_centre_key TEXT NOT NULL DEFAULT '',
  resource_type "RoutingResourceType" NOT NULL,
  driver_hours DECIMAL(18,6) NOT NULL CHECK (driver_hours >= 0),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  UNIQUE(run_id, production_order_id, cost_pool_id, source_gl_account_id, source_cost_centre_key)
);
CREATE INDEX feed_mill_actual_cost_allocations_order_idx
  ON feed_mill_actual_cost_allocations(production_order_id);
