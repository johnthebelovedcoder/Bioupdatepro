ALTER TABLE snail_breeding_cycles
  ADD COLUMN egg_group_id UUID,
  ADD COLUMN egg_value_basis TEXT NOT NULL DEFAULT 'ATTRIBUTABLE_COST',
  ADD COLUMN egg_value_per_unit_kobo BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN egg_value_evidence TEXT;

CREATE INDEX snail_breeding_cycles_egg_group_idx
  ON snail_breeding_cycles(egg_group_id);
