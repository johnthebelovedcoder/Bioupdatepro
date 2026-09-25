-- AlterTable
ALTER TABLE "employee_salary_components" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" UUID,
ADD COLUMN     "prepared_by_id" UUID,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'APPROVED';

-- CreateTable
CREATE TABLE "employee_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "employment_status" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "branch_id" UUID,
    "farm_id" UUID,
    "designation" TEXT,
    "grade" TEXT,
    "reporting_manager_id" UUID,
    "shift" TEXT,
    "reason" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_verifications" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "check_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "verified_by_id" UUID NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_assignments_employee_id_effective_from_idx" ON "employee_assignments"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "employee_assignments_company_id_idx" ON "employee_assignments"("company_id");

-- CreateIndex
CREATE INDEX "employee_verifications_company_id_idx" ON "employee_verifications"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_verifications_employee_id_check_type_key" ON "employee_verifications"("employee_id", "check_type");

-- AddForeignKey
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_verifications" ADD CONSTRAINT "employee_verifications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "employee_salary_components" ADD CONSTRAINT "employee_salary_components_status_known" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE "employee_verifications" ADD CONSTRAINT "employee_verifications_status_known" CHECK ("status" IN ('VERIFIED', 'NOT_APPLICABLE', 'OUTSTANDING'));
ALTER TABLE "employee_verifications" ADD CONSTRAINT "employee_verifications_check_known"
  CHECK ("check_type" IN ('CONTRACT', 'BANK', 'TAX_ID', 'NIN', 'PENSION', 'ADDRESS', 'NHF', 'NHIA', 'EMERGENCY_CONTACT'));

-- Every employee's current job becomes the first entry of their history.
INSERT INTO "employee_assignments" ("id", "company_id", "employee_id", "effective_from", "employment_status", "employment_type",
  "department_id", "cost_centre_id", "branch_id", "designation", "grade", "reporting_manager_id", "reason", "recorded_by_id", "created_at")
SELECT gen_random_uuid(), e."company_id", e."id", e."employment_date", e."employment_status"::text, e."employment_type"::text,
  e."department_id", e."cost_centre_id", e."branch_id", e."designation", e."grade", e."reporting_manager_id",
  'Job held when assignment history began',
  (SELECT u."id" FROM "users" u WHERE u."company_id" = e."company_id" ORDER BY u."created_at" LIMIT 1),
  now()
FROM "employees" e
WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."company_id" = e."company_id");
