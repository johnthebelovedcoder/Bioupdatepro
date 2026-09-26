-- AlterTable
ALTER TABLE "payroll_run_lines" ADD COLUMN     "leave_deduction_kobo" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "leave_policies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "annual_days" INTEGER NOT NULL DEFAULT 6,
    "annual_service_months" INTEGER NOT NULL DEFAULT 12,
    "carry_over_years" INTEGER NOT NULL DEFAULT 1,
    "sick_days" INTEGER NOT NULL DEFAULT 12,
    "maternity_weeks" INTEGER NOT NULL DEFAULT 12,
    "maternity_pay_percent" INTEGER NOT NULL DEFAULT 50,
    "maternity_service_months" INTEGER NOT NULL DEFAULT 6,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "working_days" INTEGER NOT NULL,
    "pay_percent" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "handover" TEXT,
    "evidence_reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_policies_company_id_key" ON "leave_policies"("company_id");

-- CreateIndex
CREATE INDEX "leave_requests_company_id_employee_id_start_date_idx" ON "leave_requests"("company_id", "employee_id", "start_date");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_type_known" CHECK ("type" IN ('ANNUAL', 'SICK', 'MATERNITY', 'UNPAID'));
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_status_known" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_dates" CHECK ("end_date" >= "start_date" AND "working_days" >= 0);
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_pay" CHECK ("pay_percent" BETWEEN 0 AND 100);
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_ranges" CHECK (
  "annual_days" >= 0 AND "annual_service_months" >= 0 AND "carry_over_years" >= 0 AND "sick_days" >= 0
  AND "maternity_weeks" >= 0 AND "maternity_pay_percent" BETWEEN 0 AND 100 AND "maternity_service_months" >= 0);
