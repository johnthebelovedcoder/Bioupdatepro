-- Live animals bought on a purchase order (Test_Environment_Script steps 5
-- and 12): an item can be marked as livestock of a species, and its goods
-- receipt line carries the batch it places.
ALTER TABLE "items" ADD COLUMN "livestock_species_key" TEXT;
ALTER TABLE "goods_receipt_note_lines" ADD COLUMN "livestock_placement" JSONB;
ALTER TABLE "goods_receipt_note_lines" ADD COLUMN "livestock_group_id" UUID;
