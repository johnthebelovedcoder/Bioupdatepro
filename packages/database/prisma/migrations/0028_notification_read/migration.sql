-- In-app notifications record when they are read (the bell's unread count).

-- AlterTable
ALTER TABLE "workflow_notifications" ADD COLUMN     "read_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "workflow_notifications_recipient_id_read_at_idx" ON "workflow_notifications"("recipient_id", "read_at");


-- Notices older than a fortnight start read, so the bell opens on what is current.
UPDATE "workflow_notifications" SET "read_at" = "created_at" WHERE "channel" = 'IN_APP' AND "created_at" < now() - interval '14 days';
