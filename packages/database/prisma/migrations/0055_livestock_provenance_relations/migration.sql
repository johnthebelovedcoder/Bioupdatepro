ALTER TABLE "livestock_groups"
  ADD COLUMN "origin_parent_group_id" UUID,
  ADD COLUMN "origin_grn_line_id" UUID;

CREATE UNIQUE INDEX "livestock_groups_origin_grn_line_id_key" ON "livestock_groups"("origin_grn_line_id");
CREATE INDEX "livestock_groups_origin_parent_group_id_idx" ON "livestock_groups"("origin_parent_group_id");

ALTER TABLE "livestock_groups"
  ADD CONSTRAINT "livestock_groups_origin_parent_group_id_fkey"
  FOREIGN KEY ("origin_parent_group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "livestock_groups"
  ADD CONSTRAINT "livestock_groups_origin_grn_line_id_fkey"
  FOREIGN KEY ("origin_grn_line_id") REFERENCES "goods_receipt_note_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
