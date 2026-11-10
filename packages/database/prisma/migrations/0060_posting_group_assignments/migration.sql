CREATE TABLE "approved_posting_groups" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "application" TEXT NOT NULL,
  "posting_group" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "master_type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "tax_class" TEXT,
  "legal_entity" TEXT,
  "effective_from" DATE NOT NULL,
  "status" TEXT NOT NULL,
  "developer_use" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approved_posting_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approved_posting_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "approved_posting_groups_company_app_group_key"
  ON "approved_posting_groups"("company_id", "application", "posting_group");
CREATE INDEX "approved_posting_groups_company_app_master_status_idx"
  ON "approved_posting_groups"("company_id", "application", "master_type", "status");

CREATE TABLE "posting_group_assignments" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "approved_posting_group_id" UUID NOT NULL,
  "master_type" TEXT NOT NULL,
  "master_id" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL DEFAULT 'Active',
  "assigned_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "posting_group_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "posting_group_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "posting_group_assignments_group_id_fkey" FOREIGN KEY ("approved_posting_group_id") REFERENCES "approved_posting_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "posting_group_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "posting_group_assignments_date_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);

CREATE UNIQUE INDEX "posting_group_assignments_company_group_master_from_key"
  ON "posting_group_assignments"("company_id", "approved_posting_group_id", "master_type", "master_id", "effective_from");
CREATE INDEX "posting_group_assignments_company_master_date_idx"
  ON "posting_group_assignments"("company_id", "master_type", "master_id", "status", "effective_from", "effective_to");
