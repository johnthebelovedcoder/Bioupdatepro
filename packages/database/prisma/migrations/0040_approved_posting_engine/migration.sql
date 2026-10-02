ALTER TABLE gl_accounts
  ADD COLUMN is_control_account BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN manual_journal_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN approved_statement TEXT,
  ADD COLUMN ifrs_category TEXT,
  ADD COLUMN ifrs_line TEXT,
  ADD COLUMN approved_posting_group TEXT,
  ADD COLUMN application_scope TEXT,
  ADD COLUMN business_stream TEXT,
  ADD COLUMN legal_entity_scope TEXT,
  ADD COLUMN cost_centre_rule TEXT,
  ADD COLUMN approved_effective_from DATE;

ALTER TABLE cost_centres
  ADD COLUMN approved_application TEXT,
  ADD COLUMN business_unit TEXT,
  ADD COLUMN function_name TEXT,
  ADD COLUMN activity_stage TEXT,
  ADD COLUMN location TEXT,
  ADD COLUMN responsibility_owner TEXT,
  ADD COLUMN posting_allowed BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE approved_posting_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  application TEXT NOT NULL,
  posting_group TEXT NOT NULL,
  posting_key TEXT NOT NULL,
  map_key TEXT NOT NULL,
  gl_account_id UUID REFERENCES gl_accounts(id),
  account_code TEXT NOT NULL,
  status TEXT NOT NULL,
  resolution_note TEXT,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, application, posting_group, posting_key, effective_from)
);
CREATE INDEX approved_posting_maps_lookup_idx
  ON approved_posting_maps(company_id, application, posting_group, posting_key, status, effective_from);

CREATE TABLE approved_posting_control_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  application TEXT NOT NULL,
  application_rule_id TEXT NOT NULL,
  base_rule_id TEXT NOT NULL,
  module TEXT NOT NULL,
  business_event TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  source_document TEXT NOT NULL,
  required_status TEXT NOT NULL,
  required_fields TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  side TEXT NOT NULL,
  posting_key TEXT NOT NULL,
  group_source TEXT NOT NULL,
  posting_group TEXT NOT NULL,
  map_key TEXT NOT NULL,
  resolved_gl TEXT NOT NULL,
  amount_basis TEXT NOT NULL,
  reversal_correction TEXT NOT NULL,
  blocking_controls TEXT NOT NULL,
  posting_mode TEXT NOT NULL,
  audit_requirements TEXT NOT NULL,
  cost_centre_requirement TEXT NOT NULL,
  cost_centre_source TEXT NOT NULL,
  cost_centre_validation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, application, application_rule_id, line_number)
);
CREATE INDEX approved_posting_control_lookup_idx
  ON approved_posting_control_lines(company_id, application, base_rule_id, sequence);
