-- AlterTable
ALTER TABLE "inventory_write_offs" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" UUID,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'POSTED';


ALTER TABLE "inventory_write_offs" ADD CONSTRAINT "inventory_write_offs_status_known" CHECK ("status" IN ('PENDING', 'POSTED', 'REJECTED'));
