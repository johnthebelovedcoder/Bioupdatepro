-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "variance_reason" TEXT,
ADD COLUMN     "variance_reason_by_id" UUID;

