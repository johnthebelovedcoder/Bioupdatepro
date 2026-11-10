-- Keep IAS 41 maturity classification on the governed breed-stage master.
-- NULL is intentional until Finance approves a stage classification.
ALTER TABLE "species_breed_stages"
  ADD COLUMN "maturity_class" TEXT;

ALTER TABLE "species_breed_stages"
  ADD CONSTRAINT "species_breed_stages_maturity_class_check"
  CHECK ("maturity_class" IS NULL OR "maturity_class" IN ('IMMATURE', 'MATURE'));
