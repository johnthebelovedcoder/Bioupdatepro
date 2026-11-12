ALTER TABLE "livestock_groups"
  ADD COLUMN "responsible_supervisor_id" UUID;

CREATE INDEX "livestock_groups_responsible_supervisor_id_idx"
  ON "livestock_groups"("responsible_supervisor_id");

ALTER TABLE "livestock_groups"
  ADD CONSTRAINT "livestock_groups_responsible_supervisor_id_fkey"
  FOREIGN KEY ("responsible_supervisor_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
