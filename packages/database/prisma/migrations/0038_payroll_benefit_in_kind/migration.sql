ALTER TABLE salary_components
  ADD COLUMN is_benefit_in_kind BOOLEAN NOT NULL DEFAULT FALSE;
