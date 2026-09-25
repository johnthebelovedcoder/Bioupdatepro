-- AlterTable
ALTER TABLE "pen_houses" ADD COLUMN     "capacity" INTEGER;


-- A capacity is a positive number of animals, or none.
ALTER TABLE "pen_houses" ADD CONSTRAINT "pen_houses_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0);
