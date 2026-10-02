-- IAS 41 cost fallback is available only when fair value is clearly
-- unreliable at initial recognition. Preserve the written basis for that
-- assessment with new snail-egg cohorts; existing records remain readable.
ALTER TABLE snail_breeding_cycles
  ADD COLUMN egg_fair_value_unreliable_reason TEXT;
