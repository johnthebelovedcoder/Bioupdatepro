-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'WHATSAPP';

-- CreateTable
CREATE TABLE "notification_policies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email_events" TEXT[],
    "whatsapp_events" TEXT[],
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_contacts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "whatsapp_number" TEXT,
    "whatsapp_verified_at" TIMESTAMP(3),
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMP(3),
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "consented_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_policies_company_id_key" ON "notification_policies"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_contacts_user_id_key" ON "notification_contacts"("user_id");

-- CreateIndex
CREATE INDEX "notification_contacts_company_id_idx" ON "notification_contacts"("company_id");


-- Every company keeps emailing the approval events it already did; WhatsApp
-- carries nothing until an administrator approves events for it.
INSERT INTO "notification_policies" ("id", "company_id", "email_events", "whatsapp_events", "updated_at", "created_at")
SELECT gen_random_uuid(), c."id",
  ARRAY['SUBMISSION', 'APPROVAL', 'REJECTION', 'RETURN', 'ESCALATION', 'REMINDER', 'CANCELLATION', 'POSTING'],
  ARRAY[]::TEXT[], now(), now()
FROM "companies" c;
