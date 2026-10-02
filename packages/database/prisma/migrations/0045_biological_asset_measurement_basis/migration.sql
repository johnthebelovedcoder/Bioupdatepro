-- Record use of IAS 41's cost exception and the date/evidence of each Finance
-- review that fair value remains clearly unreliable. Existing assets default
-- to FVLCTS; legacy snail egg cohorts inherit their recorded basis.
ALTER TABLE livestock_groups
  ADD COLUMN measurement_basis TEXT NOT NULL DEFAULT 'FVLCTS',
  ADD COLUMN fair_value_unreliable_reason TEXT,
  ADD COLUMN fair_value_reliability_reviewed_on DATE,
  ADD COLUMN fair_value_reliability_evidence TEXT;

UPDATE livestock_groups AS g
SET measurement_basis = 'ATTRIBUTABLE_COST',
    fair_value_unreliable_reason = c.egg_fair_value_unreliable_reason,
    fair_value_reliability_reviewed_on = c.set_on,
    fair_value_reliability_evidence = c.egg_value_evidence
FROM snail_breeding_cycles AS c
WHERE c.egg_group_id = g.id
  AND c.egg_value_basis = 'ATTRIBUTABLE_COST';

UPDATE livestock_groups AS g
SET measurement_basis = 'ATTRIBUTABLE_COST',
    fair_value_unreliable_reason = c.egg_fair_value_unreliable_reason,
    fair_value_reliability_reviewed_on = c.hatched_on,
    fair_value_reliability_evidence = c.egg_value_evidence
FROM snail_breeding_cycles AS c
WHERE c.hatchling_group_id = g.id
  AND c.egg_value_basis = 'ATTRIBUTABLE_COST';
