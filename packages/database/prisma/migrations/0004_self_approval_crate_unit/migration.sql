-- AlterTable
ALTER TABLE "workflow_transaction_steps" ADD COLUMN     "self_approved" BOOLEAN NOT NULL DEFAULT false;


-- A Crate unit (30 eggs) for every company that has units — new companies get
-- it from FarmStructureService.ensureDefaultUnits. Fractional, because a
-- collection of 45 eggs is 1.5 crates.
INSERT INTO "units_of_measure" ("id", "company_id", "code", "name", "precision", "active", "updated_at")
SELECT gen_random_uuid(), c."company_id", 'Crate', 'Crate (30 eggs)', 3, true, NOW()
FROM (SELECT DISTINCT "company_id" FROM "units_of_measure") c
WHERE NOT EXISTS (
  SELECT 1 FROM "units_of_measure" u WHERE u."company_id" = c."company_id" AND u."code" = 'Crate'
);

-- The eggs item created on 2026-09-25 before this unit existed was counted in
-- "Unit", one unit meaning one crate. Same quantities, now named for what
-- they are.
UPDATE "items" i
SET "unit_of_measure_id" = crate."id", "updated_at" = NOW()
FROM "units_of_measure" crate, "units_of_measure" unit
WHERE i."code" = 'EGG-CRATE'
  AND unit."id" = i."unit_of_measure_id" AND unit."code" = 'Unit'
  AND crate."company_id" = i."company_id" AND crate."code" = 'Crate';
