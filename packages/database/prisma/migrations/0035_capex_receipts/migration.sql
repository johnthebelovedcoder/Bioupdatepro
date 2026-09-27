-- Capital items bought through purchasing (Test_Environment_Script step 24):
-- an item can carry an asset class and useful life, and receiving it creates
-- the asset card, linked to its goods receipt line, instead of stock.
ALTER TABLE "items" ADD COLUMN "fixed_asset_class" TEXT;
ALTER TABLE "items" ADD COLUMN "useful_life_months" INTEGER;
ALTER TABLE "fixed_assets" ADD COLUMN "goods_receipt_note_line_id" UUID;
