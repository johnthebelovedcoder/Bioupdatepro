-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FsCategory" AS ENUM ('CURRENT_ASSET', 'NON_CURRENT_ASSET', 'CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_SALES', 'OPERATING_EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('RAW_MATERIAL', 'WORK_IN_PROGRESS', 'FINISHED_GOODS', 'BY_PRODUCT', 'GENERAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'CANCEL', 'POST', 'REVERSE', 'PERIOD_OPEN', 'PERIOD_SOFT_CLOSE', 'PERIOD_CLOSE', 'PERIOD_REOPEN', 'LOGIN', 'CONFIG_CHANGE');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'POSTED', 'CLOSED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkflowActionType" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'RESUBMIT', 'CANCEL', 'DELEGATE', 'ESCALATE', 'REMIND', 'POST', 'CLOSE', 'COMMENT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('SUBMISSION', 'APPROVAL', 'REJECTION', 'RETURN', 'ESCALATION', 'REMINDER', 'CANCELLATION', 'POSTING');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('VAT', 'WHT');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "VatDirection" AS ENUM ('INPUT', 'OUTPUT');

-- CreateEnum
CREATE TYPE "WhtDirection" AS ENUM ('PAYABLE', 'RECEIVABLE');

-- CreateEnum
CREATE TYPE "TaxPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'FILED');

-- CreateEnum
CREATE TYPE "RoundingRule" AS ENUM ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP');

-- CreateEnum
CREATE TYPE "WhtBasis" AS ENUM ('NET_OF_VAT', 'GROSS_INCLUDING_VAT');

-- CreateEnum
CREATE TYPE "PriceBasis" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('INVENTORY', 'EXPENSE', 'SERVICE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'CASUAL', 'INTERN');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PROBATION', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'RETIRED');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "SalaryComponentType" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "SalaryComponentBasis" AS ENUM ('FIXED', 'PERCENTAGE_OF_BASE');

-- CreateEnum
CREATE TYPE "RecipeVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RoutingResourceType" AS ENUM ('LABOUR', 'MACHINE');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionOrderCycle" AS ENUM ('SNAILPRO', 'POULTRYPRO', 'FEED_MILL');

-- CreateEnum
CREATE TYPE "ProductionOrderOutputType" AS ENUM ('MAIN', 'BY_PRODUCT');

-- CreateEnum
CREATE TYPE "ProcessingLossClassification" AS ENUM ('NORMAL', 'ABNORMAL');

-- CreateEnum
CREATE TYPE "InventoryTransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ManualJournalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'POSTED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ManualJournalKind" AS ENUM ('GENERAL', 'CUSTOMER_ADJUSTMENT', 'SUPPLIER_ADJUSTMENT', 'OPENING_BALANCE', 'RECURRING', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "RecurringJournalBasis" AS ENUM ('STRAIGHT_LINE', 'USAGE_BASED', 'MANUAL');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PensionFundingModel" AS ENUM ('SPLIT_8_10', 'EMPLOYER_PAYS_ALL_18');

-- CreateEnum
CREATE TYPE "PayrollPayableBucket" AS ENUM ('SALARY', 'PAYE', 'PENSION', 'NHF', 'NSITF', 'ITF');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_DELIVERED', 'FULLY_DELIVERED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'DISPATCHED', 'DELIVERED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReceiptMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'POS', 'CHEQUE');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditNoteReason" AS ENUM ('PRICING_ERROR', 'RETURNED_GOODS', 'PROMOTIONAL_DISCOUNT', 'INVOICE_CANCELLATION', 'AUDIT_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('RESALEABLE', 'DAMAGED', 'EXPIRED', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "StockDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "CogsRecognitionPoint" AS ENUM ('DELIVERY', 'INVOICE');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CONVERTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'ISSUED', 'EVALUATED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GrnStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QualityStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('NOT_MATCHED', 'MATCHED', 'EXCEPTION', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('PENDING', 'COMPLETE', 'WAIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "CloseAction" AS ENUM ('OPEN', 'SOFT_CLOSE', 'CLOSE', 'REOPEN', 'YEAR_END_CLOSE', 'ROLL_FORWARD');

-- CreateEnum
CREATE TYPE "LivestockGroupStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "HealthEventStatus" AS ENUM ('DUE', 'OVERDUE', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IncubationBatchStatus" AS ENUM ('SET', 'HATCHED');

-- CreateEnum
CREATE TYPE "PostingKeySide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerFlag" AS ENUM ('CONTROL', 'GENERAL', 'NO_JOURNAL');

-- CreateEnum
CREATE TYPE "PostingRuleStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "MortalityClassification" AS ENUM ('NORMAL', 'ABNORMAL');

-- CreateEnum
CREATE TYPE "ValuationDirection" AS ENUM ('GAIN', 'LOSS');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "company_id" UUID,
    "roles" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL DEFAULT 'Private',
    "free_trade_zone" BOOLEAN NOT NULL DEFAULT false,
    "base_currency_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centres" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "manager_name" TEXT,
    "department_id" UUID,
    "branch_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effective_date" DATE NOT NULL,
    "closing_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "parent_id" UUID,
    "is_posting_account" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requires_cost_centre" BOOLEAN NOT NULL DEFAULT false,
    "requires_department" BOOLEAN NOT NULL DEFAULT false,
    "requires_farm" BOOLEAN NOT NULL DEFAULT false,
    "requires_project" BOOLEAN NOT NULL DEFAULT false,
    "fs_category" "FsCategory",
    "fs_category_set_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minor_unit_scale" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "from_currency_id" UUID NOT NULL,
    "to_currency_id" UUID NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_years" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_periods" (
    "id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pen_houses" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pen_houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL DEFAULT 'GENERAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_number" TEXT NOT NULL,
    "journal_date" DATE NOT NULL,
    "narration" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "source_module" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL,
    "reversal_of_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_by_id" UUID,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "debit_kobo" BIGINT NOT NULL DEFAULT 0,
    "credit_kobo" BIGINT NOT NULL DEFAULT 0,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "farm_id" UUID,
    "pen_house_id" UUID,
    "project_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" UUID,
    "supplier_id" UUID,
    "employee_id" UUID,
    "item_id" UUID,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "result_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_records" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "transaction_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "device" TEXT,
    "comments" TEXT,
    "metadata" JSONB,
    "old_value_json" JSONB,
    "new_value_json" JSONB,

    CONSTRAINT "audit_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_section_access" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_section_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "overrides" JSONB NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "branch_id" UUID,
    "farm_id" UUID,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "currency_id" UUID,
    "auto_post_on_approval" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "role_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_amount_kobo" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transactions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "document_reference" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "currency_id" UUID NOT NULL,
    "branch_id" UUID,
    "farm_id" UUID,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "definition_id" UUID NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "current_level" INTEGER,
    "maker_id" UUID NOT NULL,
    "posting_payload" JSONB,
    "journal_entry_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "level_entered_at" TIMESTAMP(3),
    "last_reminder_at" TIMESTAMP(3),
    "manager_notified_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transaction_steps" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "role_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_amount_kobo" BIGINT,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "acted_by_id" UUID,
    "acted_at" TIMESTAMP(3),
    "comments" TEXT,
    "acted_on_behalf_of_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_transaction_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_history" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "action" "WorkflowActionType" NOT NULL,
    "from_status" "WorkflowStatus",
    "to_status" "WorkflowStatus" NOT NULL,
    "level" INTEGER,
    "user_id" UUID NOT NULL,
    "on_behalf_of_id" UUID,
    "comments" TEXT,
    "ip_address" TEXT,
    "device" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_delegations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "delegator_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "transaction_type" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_escalation_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transaction_type" TEXT,
    "remind_after_hours" INTEGER NOT NULL DEFAULT 24,
    "notify_manager_after_hours" INTEGER NOT NULL DEFAULT 48,
    "escalate_after_hours" INTEGER NOT NULL DEFAULT 72,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_comments" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_notifications" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_attachments" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "treatment" "TaxTreatment" NOT NULL DEFAULT 'STANDARD',
    "price_basis" "PriceBasis" NOT NULL DEFAULT 'EXCLUSIVE',
    "recoverable" BOOLEAN NOT NULL DEFAULT true,
    "wht_category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "rate" DECIMAL(9,8) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_configurations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "rounding" "RoundingRule" NOT NULL DEFAULT 'HALF_UP',
    "wht_basis" "WhtBasis" NOT NULL,
    "wht_basis_authority" TEXT,
    "vat_registration_number" TEXT,
    "tin" TEXT,
    "vat_filing_interval_months" INTEGER NOT NULL DEFAULT 1,
    "vat_filing_due_day_of_month" INTEGER NOT NULL DEFAULT 21,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_gl_mappings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_gl_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_periods" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "year" INTEGER NOT NULL,
    "period_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "TaxPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "filed_at" TIMESTAMP(3),
    "filed_by_id" UUID,
    "filing_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_register_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "tax_period_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "direction" "VatDirection" NOT NULL,
    "treatment" "TaxTreatment" NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT,
    "document_reference" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "counterparty_name" TEXT,
    "counterparty_tin" TEXT,
    "taxable_base_kobo" BIGINT NOT NULL,
    "tax_kobo" BIGINT NOT NULL,
    "applied_rate" DECIMAL(9,8) NOT NULL,
    "recoverable" BOOLEAN NOT NULL DEFAULT true,
    "journal_entry_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vat_register_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wht_register_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "tax_period_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "direction" "WhtDirection" NOT NULL,
    "wht_category" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT,
    "document_reference" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "counterparty_name" TEXT,
    "counterparty_tin" TEXT,
    "gross_amount_kobo" BIGINT NOT NULL,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "taxable_base_kobo" BIGINT NOT NULL,
    "tax_kobo" BIGINT NOT NULL,
    "applied_rate" DECIMAL(9,8) NOT NULL,
    "credit_note_reference" TEXT,
    "credit_note_date" DATE,
    "journal_entry_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wht_register_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_adjustments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "tax_period_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "taxable_base_kobo" BIGINT NOT NULL,
    "tax_kobo" BIGINT NOT NULL,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "net_days" INTEGER NOT NULL,
    "discount_percent" DECIMAL(5,2),
    "discount_days" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "tin" TEXT,
    "vat_registration_number" TEXT,
    "wht_tax_code_id" UUID,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "payment_term_id" UUID,
    "credit_limit_kobo" BIGINT NOT NULL DEFAULT 0,
    "credit_limit_set" BOOLEAN NOT NULL DEFAULT false,
    "default_currency_id" UUID NOT NULL,
    "branch_id" UUID,
    "default_cost_centre_id" UUID,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "tin" TEXT,
    "vat_registration_number" TEXT,
    "wht_tax_code_id" UUID,
    "contact_person" TEXT,
    "telephone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'Nigeria',
    "payment_term_id" UUID,
    "credit_limit_kobo" BIGINT NOT NULL DEFAULT 0,
    "credit_limit_set" BOOLEAN NOT NULL DEFAULT false,
    "currency_id" UUID NOT NULL,
    "default_branch_id" UUID,
    "default_cost_centre_id" UUID,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_reason" TEXT,
    "customer_since" DATE,
    "risk_rating" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "item_type" "ItemType" NOT NULL DEFAULT 'INVENTORY',
    "is_biological_feed" BOOLEAN NOT NULL DEFAULT false,
    "is_manufactured" BOOLEAN NOT NULL DEFAULT false,
    "unit_of_measure_id" UUID NOT NULL,
    "vat_tax_code_id" UUID,
    "preferred_supplier_id" UUID,
    "reorder_level" DECIMAL(18,6),
    "economic_order_quantity" DECIMAL(18,6),
    "inventory_gl_account_id" UUID,
    "expense_gl_account_id" UUID,
    "revenue_gl_account_id" UUID,
    "default_warehouse_id" UUID,
    "weighted_average_cost_kobo" BIGINT,
    "weighted_average_cost_set_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_standard_costs" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "standard_cost_kobo" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_standard_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_operations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recipe_version_id" UUID NOT NULL,
    "cost_centre_id" UUID NOT NULL,
    "cost_pool_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "operation_name" TEXT NOT NULL,
    "resource_type" "RoutingResourceType" NOT NULL,
    "setup_hours" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "run_hours_per_unit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_routing_lines" (
    "id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "routing_operation_id" UUID NOT NULL,
    "standard_hours" DECIMAL(18,6) NOT NULL,
    "rate_per_hour_kobo" BIGINT NOT NULL,
    "standard_cost_kobo" BIGINT NOT NULL,

    CONSTRAINT "production_order_routing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_pools" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driver_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_pool_rates" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "pool_cost_kobo" BIGINT NOT NULL,
    "practical_capacity" DECIMAL(18,6) NOT NULL,
    "rate_per_unit_kobo" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_pool_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_number" TEXT NOT NULL,
    "title" TEXT,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "surname" TEXT NOT NULL,
    "gender" TEXT,
    "date_of_birth" DATE,
    "marital_status" "MaritalStatus",
    "nationality" TEXT,
    "state_of_origin" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'PROBATION',
    "employment_date" DATE NOT NULL,
    "confirmation_date" DATE,
    "exit_date" DATE,
    "department_id" UUID,
    "branch_id" UUID,
    "cost_centre_id" UUID,
    "designation" TEXT,
    "grade" TEXT,
    "job_category" TEXT,
    "reporting_manager_id" UUID,
    "bank_name" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "tin" TEXT,
    "nhf_number" TEXT,
    "pension_rsa_number" TEXT,
    "pension_administrator" TEXT,
    "tax_state" TEXT,
    "pension_enrolled" BOOLEAN NOT NULL DEFAULT false,
    "nhf_enrolled" BOOLEAN NOT NULL DEFAULT false,
    "next_of_kin_name" TEXT,
    "next_of_kin_relationship" TEXT,
    "next_of_kin_phone" TEXT,
    "next_of_kin_address" TEXT,
    "payroll_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SalaryComponentType" NOT NULL,
    "basis" "SalaryComponentBasis" NOT NULL DEFAULT 'FIXED',
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "is_pensionable" BOOLEAN NOT NULL DEFAULT false,
    "is_nhf_base" BOOLEAN NOT NULL DEFAULT false,
    "is_gross_pay_component" BOOLEAN NOT NULL DEFAULT true,
    "default_rate" DECIMAL(9,8),
    "expense_gl_account_id" UUID,
    "payable_gl_account_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salary_components" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "salary_component_id" UUID NOT NULL,
    "amount_kobo" BIGINT,
    "rate" DECIMAL(9,8),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_recipes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "output_item_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_recipe_versions" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RecipeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "batch_size" DECIMAL(18,6) NOT NULL,
    "expected_yield_percent" DECIMAL(9,6),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_recipe_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_recipe_components" (
    "id" UUID NOT NULL,
    "recipe_version_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "component_item_id" UUID NOT NULL,
    "quantity_per_batch" DECIMAL(18,6) NOT NULL,
    "unit_of_measure_id" UUID NOT NULL,
    "wastage_percent" DECIMAL(9,6),
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_recipe_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "recipe_version_id" UUID NOT NULL,
    "source_group_id" UUID,
    "harvest_record_id" UUID,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "processing_cycle" "ProductionOrderCycle" NOT NULL DEFAULT 'SNAILPRO',
    "planned_output_quantity" DECIMAL(18,6) NOT NULL,
    "biological_input_value_kobo" BIGINT NOT NULL DEFAULT 0,
    "packaging_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "standard_conversion_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "actual_labour_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "actual_overhead_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "finished_goods_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "abnormal_loss_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "workflow_transaction_id" UUID,
    "issue_journal_entry_id" UUID,
    "conversion_journal_entry_id" UUID,
    "completion_journal_entry_id" UUID,
    "settlement_journal_entry_id" UUID,
    "released_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_components" (
    "id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "component_item_id" UUID NOT NULL,
    "planned_quantity" DECIMAL(18,6) NOT NULL,
    "planned_cost_kobo" BIGINT NOT NULL,
    "issued_quantity" DECIMAL(18,6),
    "issued_cost_kobo" BIGINT,
    "stock_movement_id" UUID,

    CONSTRAINT "production_order_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_outputs" (
    "id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "output_type" "ProductionOrderOutputType" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "allocation_weight_kobo" BIGINT NOT NULL,
    "allocated_cost_kobo" BIGINT NOT NULL,
    "stock_movement_id" UUID,

    CONSTRAINT "production_order_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_loss_events" (
    "id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "classification" "ProcessingLossClassification" NOT NULL,
    "cost_kobo" BIGINT NOT NULL,
    "reason" TEXT,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_order_loss_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transfers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "value_kobo" BIGINT NOT NULL,
    "status" "InventoryTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_journal_entry_id" UUID,
    "receipt_journal_entry_id" UUID,
    "issued_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_write_offs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "value_kobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_write_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_types" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ManualJournalKind" NOT NULL DEFAULT 'GENERAL',
    "requires_reason_code" BOOLEAN NOT NULL DEFAULT true,
    "requires_attachment" BOOLEAN NOT NULL DEFAULT false,
    "auto_reverse" BOOLEAN NOT NULL DEFAULT false,
    "workflow_transaction_type" TEXT NOT NULL DEFAULT 'GL_JOURNAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reason_codes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "journal_type_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reason_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_journals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_type_id" UUID NOT NULL,
    "reason_code_id" UUID,
    "reference" TEXT NOT NULL,
    "journal_date" DATE NOT NULL,
    "narration" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL,
    "customer_id" UUID,
    "supplier_id" UUID,
    "status" "ManualJournalStatus" NOT NULL DEFAULT 'DRAFT',
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "reversal_of_id" UUID,
    "scheduled_reversal_date" DATE,
    "recurring_journal_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_journal_lines" (
    "id" UUID NOT NULL,
    "manual_journal_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "debit_kobo" BIGINT NOT NULL DEFAULT 0,
    "credit_kobo" BIGINT NOT NULL DEFAULT 0,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "farm_id" UUID,
    "pen_house_id" UUID,
    "project_id" UUID,
    "customer_id" UUID,
    "supplier_id" UUID,
    "employee_id" UUID,
    "item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_journal_attachments" (
    "id" UUID NOT NULL,
    "manual_journal_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_journal_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_type_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "narration" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "customer_id" UUID,
    "supplier_id" UUID,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "day_of_month" INTEGER NOT NULL DEFAULT 1,
    "basis" "RecurringJournalBasis" NOT NULL DEFAULT 'MANUAL',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "next_run_date" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journal_lines" (
    "id" UUID NOT NULL,
    "recurring_journal_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "debit_kobo" BIGINT NOT NULL DEFAULT 0,
    "credit_kobo" BIGINT NOT NULL DEFAULT 0,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "farm_id" UUID,
    "project_id" UUID,
    "customer_id" UUID,
    "supplier_id" UUID,
    "employee_id" UUID,
    "item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paye_bands" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "band_order" INTEGER NOT NULL,
    "lower_limit_kobo" BIGINT NOT NULL,
    "upper_limit_kobo" BIGINT,
    "band_width_kobo" BIGINT,
    "rate" DECIMAL(9,8) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paye_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paye_configurations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "minimum_wage_monthly_kobo" BIGINT NOT NULL,
    "rent_relief_rate" DECIMAL(9,8) NOT NULL,
    "rent_relief_cap_kobo" BIGINT NOT NULL,
    "pension_relief_rate" DECIMAL(9,8) NOT NULL,
    "rounding" "RoundingRule" NOT NULL DEFAULT 'HALF_UP',
    "rule_version" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paye_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_configurations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pension_funding" "PensionFundingModel" NOT NULL DEFAULT 'SPLIT_8_10',
    "pension_employee_rate" DECIMAL(9,8) NOT NULL,
    "pension_employer_rate" DECIMAL(9,8) NOT NULL,
    "pension_combined_rate" DECIMAL(9,8) NOT NULL,
    "pension_min_employees" INTEGER NOT NULL DEFAULT 3,
    "nhf_rate" DECIMAL(9,8) NOT NULL,
    "nhf_company_participation" BOOLEAN NOT NULL DEFAULT false,
    "nsitf_rate" DECIMAL(9,8) NOT NULL,
    "itf_rate" DECIMAL(9,8) NOT NULL,
    "itf_min_employees" INTEGER NOT NULL DEFAULT 25,
    "minimum_wage_monthly_kobo" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statutory_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_tax_reliefs" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "annual_rent_kobo" BIGINT NOT NULL DEFAULT 0,
    "nhf_annual_kobo" BIGINT NOT NULL DEFAULT 0,
    "nhis_annual_kobo" BIGINT NOT NULL DEFAULT 0,
    "life_assurance_annual_kobo" BIGINT NOT NULL DEFAULT 0,
    "mortgage_interest_annual_kobo" BIGINT NOT NULL DEFAULT 0,
    "annual_bonus_kobo" BIGINT NOT NULL DEFAULT 0,
    "documents_complete" BOOLEAN NOT NULL DEFAULT false,
    "evidence_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_tax_reliefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "payroll_date" DATE NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "total_gross_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_paye_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_employee_pension_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_employer_pension_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_nhf_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_nsitf_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_itf_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_other_deductions_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_net_pay_kobo" BIGINT NOT NULL DEFAULT 0,
    "paye_rule_version" TEXT,
    "total_salary_settled_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_paye_settled_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_pension_settled_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_nhf_settled_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_nsitf_settled_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_itf_settled_kobo" BIGINT NOT NULL DEFAULT 0,
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "calculated_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "bucket" "PayrollPayableBucket" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "payment_date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "bank_gl_account_id" UUID NOT NULL,
    "reference" TEXT,
    "narration" TEXT,
    "branch_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_lines" (
    "id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "branch_id" UUID,
    "tax_state" TEXT,
    "monthly_gross_kobo" BIGINT NOT NULL,
    "taxable_gross_kobo" BIGINT NOT NULL,
    "pensionable_emoluments_kobo" BIGINT NOT NULL,
    "annual_gross_kobo" BIGINT NOT NULL,
    "annual_pension_relief_kobo" BIGINT NOT NULL,
    "annual_nhf_relief_kobo" BIGINT NOT NULL,
    "annual_nhis_relief_kobo" BIGINT NOT NULL,
    "annual_life_assurance_kobo" BIGINT NOT NULL,
    "annual_mortgage_interest_kobo" BIGINT NOT NULL,
    "rent_relief_kobo" BIGINT NOT NULL,
    "total_reliefs_kobo" BIGINT NOT NULL,
    "chargeable_income_kobo" BIGINT NOT NULL,
    "annual_paye_kobo" BIGINT NOT NULL,
    "monthly_paye_kobo" BIGINT NOT NULL,
    "minimum_wage_exempt" BOOLEAN NOT NULL DEFAULT false,
    "employee_pension_kobo" BIGINT NOT NULL,
    "employer_pension_kobo" BIGINT NOT NULL,
    "nhf_kobo" BIGINT NOT NULL,
    "nsitf_kobo" BIGINT NOT NULL,
    "itf_kobo" BIGINT NOT NULL,
    "other_deductions_kobo" BIGINT NOT NULL DEFAULT 0,
    "net_pay_kobo" BIGINT NOT NULL,
    "calculation_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_configurations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "cogs_recognition_point" "CogsRecognitionPoint" NOT NULL DEFAULT 'DELIVERY',
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT true,
    "sales_order_transaction_type" TEXT NOT NULL DEFAULT 'SALES_ORDER',
    "credit_override_transaction_type" TEXT NOT NULL DEFAULT 'SALES_ORDER_CREDIT_OVERRIDE',
    "receivable_gl_account_id" UUID NOT NULL,
    "revenue_gl_account_id" UUID NOT NULL,
    "cost_of_sales_gl_account_id" UUID NOT NULL,
    "inventory_gl_account_id" UUID NOT NULL,
    "wht_receivable_gl_account_id" UUID,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "direction" "StockDirection" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost_kobo" BIGINT NOT NULL,
    "value_kobo" BIGINT NOT NULL,
    "batch_reference" TEXT,
    "source_module" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "document_reference" TEXT NOT NULL,
    "movement_date" DATE NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quotations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "quote_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "quote_date" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "currency_id" UUID NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL,
    "branch_id" UUID NOT NULL,
    "farm_id" UUID,
    "cost_centre_id" UUID,
    "salesperson_id" UUID,
    "remarks" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "net_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "gross_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "workflow_transaction_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quotation_lines" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "tax_code_id" UUID,
    "net_amount_kobo" BIGINT NOT NULL,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "quotation_id" UUID,
    "order_date" DATE NOT NULL,
    "delivery_date" DATE,
    "currency_id" UUID NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "farm_id" UUID,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "net_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "gross_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "credit_check_passed" BOOLEAN,
    "credit_check_reasons" TEXT,
    "credit_override" BOOLEAN NOT NULL DEFAULT false,
    "workflow_transaction_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "delivered_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "invoiced_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unit_price_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "tax_code_id" UUID,
    "net_amount_kobo" BIGINT NOT NULL,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "batch_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "delivery_number" TEXT NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "driver_name" TEXT,
    "vehicle_number" TEXT,
    "received_by" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'DRAFT',
    "total_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_note_lines" (
    "id" UUID NOT NULL,
    "delivery_note_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "sales_order_line_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost_kobo" BIGINT NOT NULL,
    "cost_kobo" BIGINT NOT NULL,
    "batch_reference" TEXT,
    "cogs_posted_at" "CogsRecognitionPoint",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "sales_order_id" UUID,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "currency_id" UUID NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL,
    "branch_id" UUID NOT NULL,
    "farm_id" UUID,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "net_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "gross_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "settled_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "sales_order_line_id" UUID,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "tax_code_id" UUID,
    "net_amount_kobo" BIGINT NOT NULL,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "batch_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "receipt_date" DATE NOT NULL,
    "method" "ReceiptMethod" NOT NULL,
    "bank_gl_account_id" UUID NOT NULL,
    "reference" TEXT,
    "branch_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "wht_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "wht_credit_note_reference" TEXT,
    "wht_credit_note_date" DATE,
    "wht_tax_code_id" UUID,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_allocations" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "credit_note_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "invoice_id" UUID,
    "credit_note_date" DATE NOT NULL,
    "reason" "CreditNoteReason" NOT NULL,
    "narration" TEXT,
    "branch_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "net_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "gross_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "tax_code_id" UUID,
    "net_amount_kobo" BIGINT NOT NULL,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "return_date" DATE NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "total_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_lines" (
    "id" UUID NOT NULL,
    "sales_return_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "condition" "ReturnCondition" NOT NULL DEFAULT 'RESALEABLE',
    "reason" TEXT,
    "unit_cost_kobo" BIGINT NOT NULL,
    "cost_kobo" BIGINT NOT NULL,
    "batch_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_configurations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "grni_gl_account_id" UUID NOT NULL,
    "payables_gl_account_id" UUID NOT NULL,
    "wht_payable_gl_account_id" UUID,
    "quantity_tolerance_percent" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "price_tolerance_percent" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "over_receipt_tolerance_percent" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "invoice_transaction_type" TEXT NOT NULL DEFAULT 'SUPPLIER_INVOICE',
    "match_exception_transaction_type" TEXT NOT NULL DEFAULT 'SUPPLIER_INVOICE_EXCEPTION',
    "grn_transaction_type" TEXT NOT NULL DEFAULT 'GOODS_RECEIPT',
    "grn_exception_transaction_type" TEXT NOT NULL DEFAULT 'GOODS_RECEIPT_EXCEPTION',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "requisition_number" TEXT NOT NULL,
    "request_date" DATE NOT NULL,
    "required_date" DATE,
    "requester_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "farm_id" UUID,
    "justification" TEXT,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "estimated_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "currency_id" UUID NOT NULL,
    "workflow_transaction_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition_lines" (
    "id" UUID NOT NULL,
    "requisition_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "estimated_unit_cost_kobo" BIGINT NOT NULL,
    "ordered_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisition_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfqs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "rfq_number" TEXT NOT NULL,
    "requisition_id" UUID,
    "issue_date" DATE NOT NULL,
    "validity_date" DATE,
    "delivery_terms" TEXT,
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "awarded_quotation_id" UUID,
    "award_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotations" (
    "id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "quotation_reference" TEXT NOT NULL,
    "quotation_date" DATE NOT NULL,
    "valid_until" DATE,
    "total_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "lead_time_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotation_lines" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "requisition_id" UUID,
    "rfq_id" UUID,
    "order_date" DATE NOT NULL,
    "expected_delivery_date" DATE,
    "currency_id" UUID NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL,
    "payment_term_id" UUID,
    "delivery_address" TEXT,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "farm_id" UUID,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "net_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "gross_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "workflow_transaction_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "requisition_line_id" UUID,
    "quantity" DECIMAL(18,6) NOT NULL,
    "received_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "invoiced_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unit_price_kobo" BIGINT NOT NULL,
    "tax_code_id" UUID,
    "net_amount_kobo" BIGINT NOT NULL,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "grn_number" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "receipt_date" DATE NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "delivery_note_reference" TEXT,
    "quality_status" "QualityStatus" NOT NULL DEFAULT 'PENDING',
    "inspected_by_id" UUID,
    "status" "GrnStatus" NOT NULL DEFAULT 'DRAFT',
    "over_tolerance" BOOLEAN NOT NULL DEFAULT false,
    "tolerance_note" TEXT,
    "total_value_kobo" BIGINT NOT NULL DEFAULT 0,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_note_lines" (
    "id" UUID NOT NULL,
    "goods_receipt_note_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "ordered_quantity" DECIMAL(18,6) NOT NULL,
    "received_quantity" DECIMAL(18,6) NOT NULL,
    "rejected_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "accepted_quantity" DECIMAL(18,6) NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "value_kobo" BIGINT NOT NULL,
    "batch_reference" TEXT,
    "expiry_date" DATE,
    "warehouse_id" UUID,
    "invoiced_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "supplier_invoice_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "currency_id" UUID NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL,
    "branch_id" UUID NOT NULL,
    "farm_id" UUID,
    "department_id" UUID,
    "cost_centre_id" UUID,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "wht_tax_code_id" UUID,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "match_status" "MatchStatus" NOT NULL DEFAULT 'NOT_MATCHED',
    "match_result" JSONB,
    "net_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "gross_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "settled_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "purchase_order_line_id" UUID,
    "goods_receipt_note_line_id" UUID,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "tax_code_id" UUID,
    "net_amount_kobo" BIGINT NOT NULL,
    "vat_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "cost_gl_account_id" UUID NOT NULL,
    "clears_grni" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "bank_gl_account_id" UUID NOT NULL,
    "reference" TEXT,
    "narration" TEXT,
    "branch_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "wht_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "wht_tax_code_id" UUID,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_close_checklist_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "applies_to_year_end" BOOLEAN NOT NULL DEFAULT false,
    "automated_check" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "period_close_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_close_checklists" (
    "id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "check_result" JSONB,
    "completed_by_id" UUID,
    "completed_at" TIMESTAMP(3),
    "comments" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "period_close_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_close_logs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "financial_period_id" UUID,
    "action" "CloseAction" NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "total_debit_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_credit_kobo" BIGINT NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "reason" TEXT,
    "performed_by_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "device" TEXT,
    "workflow_transaction_id" UUID,

    CONSTRAINT "period_close_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_balances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "is_opening" BOOLEAN NOT NULL,
    "total_debit_kobo" BIGINT NOT NULL,
    "total_credit_kobo" BIGINT NOT NULL,
    "balance_kobo" BIGINT NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_reopen_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workflow_transaction_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "reopened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "period_reopen_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "species_breeds" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "species_key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classification" TEXT,
    "opening_stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "control_note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "species_breeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "species_breed_stages" (
    "id" UUID NOT NULL,
    "species_breed_id" UUID NOT NULL,
    "stage_name" TEXT NOT NULL,
    "min_day" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "species_breed_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_groups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "pen_house_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "species_key" TEXT NOT NULL,
    "breed" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "opening_population" INTEGER NOT NULL,
    "population" INTEGER NOT NULL,
    "started_on" DATE NOT NULL,
    "closed_on" DATE,
    "expected_transfer_date" DATE,
    "expected_harvest_date" DATE,
    "current_weight_kg" DECIMAL(18,6),
    "status" "LivestockGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "acquisition_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "current_fvlcts_per_unit_kobo" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "livestock_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_group_disposals" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "fvlcts_per_unit_kobo" BIGINT NOT NULL,
    "carrying_amount_kobo" BIGINT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livestock_group_disposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "recorded_on" DATE NOT NULL,
    "carried_over" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lines" (
    "id" UUID NOT NULL,
    "daily_record_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_issues" (
    "id" UUID NOT NULL,
    "daily_record_id" UUID NOT NULL,
    "item_id" UUID,
    "feed_name" TEXT NOT NULL,
    "quantity_kg" DECIMAL(18,6) NOT NULL,
    "unit_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "value_kobo" BIGINT NOT NULL DEFAULT 0,
    "journal_entry_id" UUID,

    CONSTRAINT "feed_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mortality_records" (
    "id" UUID NOT NULL,
    "daily_record_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "causes" TEXT[],
    "classification" "MortalityClassification" NOT NULL DEFAULT 'NORMAL',
    "journal_entry_id" UUID,
    "notes" TEXT,

    CONSTRAINT "mortality_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mortality_photos" (
    "id" UUID NOT NULL,
    "mortality_record_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "data" TEXT,
    "storage_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mortality_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "due_on" DATE NOT NULL,
    "status" "HealthEventStatus" NOT NULL DEFAULT 'DUE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "health_event_id" UUID,
    "name" TEXT NOT NULL,
    "given_on" DATE NOT NULL,
    "route" TEXT NOT NULL,
    "given_by" TEXT NOT NULL,
    "treated_count" INTEGER NOT NULL,
    "population_at_time" INTEGER NOT NULL,
    "product_batch" TEXT,
    "withdrawal_days" INTEGER NOT NULL DEFAULT 0,
    "safe_to_sell_from" DATE,
    "cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "journal_entry_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treatment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvest_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "harvested_on" DATE NOT NULL,
    "grade" TEXT NOT NULL,
    "weight_kg" DECIMAL(18,6) NOT NULL,
    "count" INTEGER NOT NULL,
    "population_at_time" INTEGER NOT NULL,
    "destination" TEXT NOT NULL,
    "moved_to_group_id" UUID,
    "notes" TEXT,
    "journal_entry_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harvest_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "egg_collection_batches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "source_group_id" UUID NOT NULL,
    "farm_id" UUID,
    "pen_house_id" UUID,
    "code" TEXT NOT NULL,
    "collected_on" DATE NOT NULL,
    "total_count" INTEGER NOT NULL,
    "hatching_count" INTEGER NOT NULL,
    "table_count" INTEGER NOT NULL,
    "reject_count" INTEGER NOT NULL,
    "hatching_remaining" INTEGER NOT NULL,
    "notes" TEXT,
    "journal_entry_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "egg_collection_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incubation_batches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "egg_batch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "set_on" DATE NOT NULL,
    "set_quantity" INTEGER NOT NULL,
    "incubator" TEXT,
    "status" "IncubationBatchStatus" NOT NULL DEFAULT 'SET',
    "notes" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incubation_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hatch_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "incubation_batch_id" UUID NOT NULL,
    "hatched_on" DATE NOT NULL,
    "hatched_count" INTEGER NOT NULL,
    "unhatched_count" INTEGER NOT NULL,
    "damaged_count" INTEGER NOT NULL,
    "chick_group_id" UUID,
    "journal_entry_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hatch_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_changes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "changed_on" DATE NOT NULL,
    "from_stage" TEXT NOT NULL,
    "to_stage" TEXT NOT NULL,
    "from_pen_house_id" UUID NOT NULL,
    "to_pen_house_id" UUID NOT NULL,
    "population" INTEGER NOT NULL,
    "mortality_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "mortality_record_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roles" TEXT[],
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_user_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_keys" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "gl_account_code" TEXT,
    "gl_account_name" TEXT NOT NULL,
    "gl_account_id" UUID,
    "atomic" BOOLEAN NOT NULL DEFAULT false,
    "dynamic_resolution" TEXT,
    "allowed_module" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "side" "PostingKeySide" NOT NULL,
    "ledger_flag" "LedgerFlag" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL,
    "source_document" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "debit_key" TEXT NOT NULL,
    "credit_key" TEXT NOT NULL,
    "measurement_basis" TEXT NOT NULL,
    "required_dimensions" TEXT NOT NULL,
    "maker_role" TEXT NOT NULL,
    "approver_role" TEXT NOT NULL,
    "blocking_control" TEXT NOT NULL,
    "reversal_method" TEXT NOT NULL,
    "report_impact" TEXT NOT NULL,
    "status" "PostingRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biological_asset_stage_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "species_key" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "biological_asset_stage_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biological_asset_configurations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "abnormal_mortality_threshold_percent" DECIMAL(9,6) NOT NULL DEFAULT 2,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biological_asset_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biological_asset_valuations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "valuation_date" DATE NOT NULL,
    "opening_quantity" INTEGER NOT NULL,
    "closing_quantity" INTEGER NOT NULL,
    "prior_fvlcts_per_unit_kobo" BIGINT NOT NULL,
    "market_price_per_unit_kobo" BIGINT NOT NULL,
    "costs_to_sell_per_unit_kobo" BIGINT NOT NULL,
    "current_fvlcts_per_unit_kobo" BIGINT NOT NULL,
    "direction" "ValuationDirection" NOT NULL,
    "gain_loss_kobo" BIGINT NOT NULL,
    "evidence_reference" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "prepared_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biological_asset_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_price_lists" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "species_key" TEXT NOT NULL,
    "breed" TEXT NOT NULL,
    "market_price_per_unit_kobo" BIGINT NOT NULL,
    "costs_to_sell_per_unit_kobo" BIGINT NOT NULL DEFAULT 0,
    "evidence_reference" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "asset_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_class" TEXT NOT NULL,
    "acquisition_date" DATE NOT NULL,
    "cost_kobo" BIGINT NOT NULL,
    "useful_life_months" INTEGER NOT NULL,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "cost_centre_id" UUID,
    "accumulated_depreciation_kobo" BIGINT NOT NULL DEFAULT 0,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "disposed_on" DATE,
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount_kobo" BIGINT NOT NULL DEFAULT 0,
    "workflow_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),

    CONSTRAINT "depreciation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_entries" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,

    CONSTRAINT "depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_definitions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "numerator" TEXT NOT NULL,
    "denominator" TEXT,
    "formula" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dimensions" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "filters" TEXT[],
    "measures" TEXT[],
    "web_path" TEXT NOT NULL,
    "api_endpoint" TEXT NOT NULL,
    "export_supported" BOOLEAN NOT NULL DEFAULT false,
    "drill_through_supported" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "implementation_phases" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "exit_evidence" TEXT NOT NULL,
    "dependency_codes" TEXT[],
    "evidence_sheet" TEXT NOT NULL,
    "web_path" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "implementation_phases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_code_key" ON "companies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_company_id_code_key" ON "branches"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_company_id_code_key" ON "departments"("company_id", "code");

-- CreateIndex
CREATE INDEX "cost_centres_parent_id_idx" ON "cost_centres"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_company_id_code_key" ON "cost_centres"("company_id", "code");

-- CreateIndex
CREATE INDEX "gl_accounts_parent_id_idx" ON "gl_accounts"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_accounts_company_id_account_number_key" ON "gl_accounts"("company_id", "account_number");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- CreateIndex
CREATE INDEX "exchange_rates_company_id_from_currency_id_to_currency_id_e_idx" ON "exchange_rates"("company_id", "from_currency_id", "to_currency_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_company_id_code_key" ON "financial_years"("company_id", "code");

-- CreateIndex
CREATE INDEX "financial_periods_start_date_end_date_idx" ON "financial_periods"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "financial_periods_financial_year_id_period_number_key" ON "financial_periods"("financial_year_id", "period_number");

-- CreateIndex
CREATE UNIQUE INDEX "farms_company_id_code_key" ON "farms"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "pen_houses_farm_id_code_key" ON "pen_houses"("farm_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "projects_company_id_code_key" ON "projects"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_company_id_code_key" ON "warehouses"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversal_of_id_key" ON "journal_entries"("reversal_of_id");

-- CreateIndex
CREATE INDEX "journal_entries_company_id_financial_period_id_status_idx" ON "journal_entries"("company_id", "financial_period_id", "status");

-- CreateIndex
CREATE INDEX "journal_entries_source_module_source_document_type_source_d_idx" ON "journal_entries"("source_module", "source_document_type", "source_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_company_id_journal_number_key" ON "journal_entries"("company_id", "journal_number");

-- CreateIndex
CREATE INDEX "journal_lines_company_id_financial_period_id_gl_account_id_idx" ON "journal_lines"("company_id", "financial_period_id", "gl_account_id");

-- CreateIndex
CREATE INDEX "journal_lines_company_id_cost_centre_id_financial_period_id_idx" ON "journal_lines"("company_id", "cost_centre_id", "financial_period_id");

-- CreateIndex
CREATE INDEX "journal_lines_company_id_farm_id_financial_period_id_idx" ON "journal_lines"("company_id", "farm_id", "financial_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journal_entry_id_line_number_key" ON "journal_lines"("journal_entry_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "audit_records_transaction_id_idx" ON "audit_records"("transaction_id");

-- CreateIndex
CREATE INDEX "audit_records_module_entity_type_entity_id_idx" ON "audit_records"("module", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_records_occurred_at_idx" ON "audit_records"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_records_company_id_occurred_at_idx" ON "audit_records"("company_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "role_section_access_company_id_role_section_key" ON "role_section_access"("company_id", "role", "section");

-- CreateIndex
CREATE UNIQUE INDEX "company_configs_company_id_key" ON "company_configs"("company_id");

-- CreateIndex
CREATE INDEX "workflow_definitions_company_id_transaction_type_active_idx" ON "workflow_definitions"("company_id", "transaction_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_definition_id_level_key" ON "workflow_steps"("definition_id", "level");

-- CreateIndex
CREATE INDEX "workflow_transactions_company_id_status_idx" ON "workflow_transactions"("company_id", "status");

-- CreateIndex
CREATE INDEX "workflow_transactions_status_current_level_idx" ON "workflow_transactions"("status", "current_level");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transactions_module_document_type_document_id_key" ON "workflow_transactions"("module", "document_type", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transaction_steps_transaction_id_level_key" ON "workflow_transaction_steps"("transaction_id", "level");

-- CreateIndex
CREATE INDEX "workflow_history_transaction_id_occurred_at_idx" ON "workflow_history"("transaction_id", "occurred_at");

-- CreateIndex
CREATE INDEX "workflow_delegations_company_id_delegate_id_active_idx" ON "workflow_delegations"("company_id", "delegate_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_escalation_rules_company_id_transaction_type_key" ON "workflow_escalation_rules"("company_id", "transaction_type");

-- CreateIndex
CREATE INDEX "workflow_comments_transaction_id_created_at_idx" ON "workflow_comments"("transaction_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_notifications_recipient_id_status_idx" ON "workflow_notifications"("recipient_id", "status");

-- CreateIndex
CREATE INDEX "workflow_notifications_status_created_at_idx" ON "workflow_notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "workflow_attachments_transaction_id_idx" ON "workflow_attachments"("transaction_id");

-- CreateIndex
CREATE INDEX "tax_codes_company_id_tax_type_active_idx" ON "tax_codes"("company_id", "tax_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_company_id_code_key" ON "tax_codes"("company_id", "code");

-- CreateIndex
CREATE INDEX "tax_rates_tax_code_id_effective_from_idx" ON "tax_rates"("tax_code_id", "effective_from");

-- CreateIndex
CREATE INDEX "tax_configurations_company_id_effective_from_idx" ON "tax_configurations"("company_id", "effective_from");

-- CreateIndex
CREATE INDEX "tax_gl_mappings_company_id_tax_code_id_direction_effective__idx" ON "tax_gl_mappings"("company_id", "tax_code_id", "direction", "effective_from");

-- CreateIndex
CREATE INDEX "tax_periods_company_id_tax_type_status_idx" ON "tax_periods"("company_id", "tax_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_periods_company_id_tax_type_year_period_number_key" ON "tax_periods"("company_id", "tax_type", "year", "period_number");

-- CreateIndex
CREATE INDEX "vat_register_entries_company_id_tax_period_id_direction_idx" ON "vat_register_entries"("company_id", "tax_period_id", "direction");

-- CreateIndex
CREATE INDEX "vat_register_entries_journal_entry_id_idx" ON "vat_register_entries"("journal_entry_id");

-- CreateIndex
CREATE INDEX "wht_register_entries_company_id_tax_period_id_direction_idx" ON "wht_register_entries"("company_id", "tax_period_id", "direction");

-- CreateIndex
CREATE INDEX "wht_register_entries_journal_entry_id_idx" ON "wht_register_entries"("journal_entry_id");

-- CreateIndex
CREATE INDEX "tax_adjustments_company_id_tax_period_id_idx" ON "tax_adjustments"("company_id", "tax_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_terms_company_id_code_key" ON "payment_terms"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_company_id_code_key" ON "units_of_measure"("company_id", "code");

-- CreateIndex
CREATE INDEX "suppliers_company_id_status_idx" ON "suppliers"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_code_key" ON "suppliers"("company_id", "code");

-- CreateIndex
CREATE INDEX "customers_company_id_status_idx" ON "customers"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_code_key" ON "customers"("company_id", "code");

-- CreateIndex
CREATE INDEX "items_company_id_item_type_active_idx" ON "items"("company_id", "item_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "items_company_id_code_key" ON "items"("company_id", "code");

-- CreateIndex
CREATE INDEX "item_standard_costs_item_id_effective_from_idx" ON "item_standard_costs"("item_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "routing_operations_recipe_version_id_sequence_key" ON "routing_operations"("recipe_version_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_routing_lines_production_order_id_routing__key" ON "production_order_routing_lines"("production_order_id", "routing_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_pools_company_id_code_key" ON "cost_pools"("company_id", "code");

-- CreateIndex
CREATE INDEX "cost_pool_rates_pool_id_effective_from_idx" ON "cost_pool_rates"("pool_id", "effective_from");

-- CreateIndex
CREATE INDEX "employees_company_id_employment_status_idx" ON "employees"("company_id", "employment_status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_employee_number_key" ON "employees"("company_id", "employee_number");

-- CreateIndex
CREATE INDEX "employee_documents_employee_id_document_type_idx" ON "employee_documents"("employee_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_company_id_code_key" ON "salary_components"("company_id", "code");

-- CreateIndex
CREATE INDEX "employee_salary_components_employee_id_effective_from_idx" ON "employee_salary_components"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "product_recipes_company_id_output_item_id_active_idx" ON "product_recipes"("company_id", "output_item_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipes_company_id_code_key" ON "product_recipes"("company_id", "code");

-- CreateIndex
CREATE INDEX "product_recipe_versions_recipe_id_status_idx" ON "product_recipe_versions"("recipe_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipe_versions_recipe_id_version_key" ON "product_recipe_versions"("recipe_id", "version");

-- CreateIndex
CREATE INDEX "product_recipe_components_component_item_id_idx" ON "product_recipe_components"("component_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipe_components_recipe_version_id_line_number_key" ON "product_recipe_components"("recipe_version_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_harvest_record_id_key" ON "production_orders"("harvest_record_id");

-- CreateIndex
CREATE INDEX "production_orders_company_id_status_idx" ON "production_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_company_id_order_number_key" ON "production_orders"("company_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_components_production_order_id_line_number_key" ON "production_order_components"("production_order_id", "line_number");

-- CreateIndex
CREATE INDEX "production_order_outputs_production_order_id_idx" ON "production_order_outputs"("production_order_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_company_id_status_idx" ON "inventory_transfers"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfers_company_id_transfer_number_key" ON "inventory_transfers"("company_id", "transfer_number");

-- CreateIndex
CREATE INDEX "inventory_write_offs_company_id_item_id_idx" ON "inventory_write_offs"("company_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_types_company_id_code_key" ON "journal_types"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "reason_codes_company_id_code_key" ON "reason_codes"("company_id", "code");

-- CreateIndex
CREATE INDEX "manual_journals_company_id_status_idx" ON "manual_journals"("company_id", "status");

-- CreateIndex
CREATE INDEX "manual_journals_company_id_journal_date_idx" ON "manual_journals"("company_id", "journal_date");

-- CreateIndex
CREATE UNIQUE INDEX "manual_journals_company_id_reference_key" ON "manual_journals"("company_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "manual_journal_lines_manual_journal_id_line_number_key" ON "manual_journal_lines"("manual_journal_id", "line_number");

-- CreateIndex
CREATE INDEX "manual_journal_attachments_manual_journal_id_idx" ON "manual_journal_attachments"("manual_journal_id");

-- CreateIndex
CREATE INDEX "recurring_journals_company_id_active_next_run_date_idx" ON "recurring_journals"("company_id", "active", "next_run_date");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_journals_company_id_code_key" ON "recurring_journals"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_journal_lines_recurring_journal_id_line_number_key" ON "recurring_journal_lines"("recurring_journal_id", "line_number");

-- CreateIndex
CREATE INDEX "paye_bands_company_id_effective_from_idx" ON "paye_bands"("company_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "paye_bands_company_id_band_order_effective_from_key" ON "paye_bands"("company_id", "band_order", "effective_from");

-- CreateIndex
CREATE INDEX "paye_configurations_company_id_effective_from_idx" ON "paye_configurations"("company_id", "effective_from");

-- CreateIndex
CREATE INDEX "statutory_configurations_company_id_effective_from_idx" ON "statutory_configurations"("company_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tax_reliefs_employee_id_tax_year_key" ON "employee_tax_reliefs"("employee_id", "tax_year");

-- CreateIndex
CREATE INDEX "payroll_runs_company_id_status_idx" ON "payroll_runs"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_company_id_year_month_key" ON "payroll_runs"("company_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_company_id_reference_key" ON "payroll_runs"("company_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_payments_company_id_payment_number_key" ON "payroll_payments"("company_id", "payment_number");

-- CreateIndex
CREATE INDEX "payroll_run_lines_payroll_run_id_tax_state_idx" ON "payroll_run_lines"("payroll_run_id", "tax_state");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_lines_payroll_run_id_employee_id_key" ON "payroll_run_lines"("payroll_run_id", "employee_id");

-- CreateIndex
CREATE INDEX "sales_configurations_company_id_effective_from_idx" ON "sales_configurations"("company_id", "effective_from");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_item_id_warehouse_id_idx" ON "stock_movements"("company_id", "item_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movements_source_document_type_source_document_id_idx" ON "stock_movements"("source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "sales_quotations_company_id_status_idx" ON "sales_quotations"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotations_company_id_quote_number_key" ON "sales_quotations"("company_id", "quote_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotation_lines_quotation_id_line_number_key" ON "sales_quotation_lines"("quotation_id", "line_number");

-- CreateIndex
CREATE INDEX "sales_orders_company_id_status_idx" ON "sales_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_company_id_order_number_key" ON "sales_orders"("company_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_lines_sales_order_id_line_number_key" ON "sales_order_lines"("sales_order_id", "line_number");

-- CreateIndex
CREATE INDEX "delivery_notes_company_id_status_idx" ON "delivery_notes"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_company_id_delivery_number_key" ON "delivery_notes"("company_id", "delivery_number");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_note_lines_delivery_note_id_line_number_key" ON "delivery_note_lines"("delivery_note_id", "line_number");

-- CreateIndex
CREATE INDEX "sales_invoices_company_id_status_idx" ON "sales_invoices"("company_id", "status");

-- CreateIndex
CREATE INDEX "sales_invoices_customer_id_status_idx" ON "sales_invoices"("customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_company_id_invoice_number_key" ON "sales_invoices"("company_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_lines_invoice_id_line_number_key" ON "sales_invoice_lines"("invoice_id", "line_number");

-- CreateIndex
CREATE INDEX "customer_receipts_company_id_status_idx" ON "customer_receipts"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_receipts_company_id_receipt_number_key" ON "customer_receipts"("company_id", "receipt_number");

-- CreateIndex
CREATE INDEX "receipt_allocations_invoice_id_idx" ON "receipt_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_allocations_receipt_id_invoice_id_key" ON "receipt_allocations"("receipt_id", "invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_company_id_status_idx" ON "credit_notes"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_company_id_credit_note_number_key" ON "credit_notes"("company_id", "credit_note_number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_lines_credit_note_id_line_number_key" ON "credit_note_lines"("credit_note_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_credit_note_id_key" ON "sales_returns"("credit_note_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_company_id_return_number_key" ON "sales_returns"("company_id", "return_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_return_lines_sales_return_id_line_number_key" ON "sales_return_lines"("sales_return_id", "line_number");

-- CreateIndex
CREATE INDEX "procurement_configurations_company_id_effective_from_idx" ON "procurement_configurations"("company_id", "effective_from");

-- CreateIndex
CREATE INDEX "purchase_requisitions_company_id_status_idx" ON "purchase_requisitions"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_company_id_requisition_number_key" ON "purchase_requisitions"("company_id", "requisition_number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_lines_requisition_id_line_number_key" ON "purchase_requisition_lines"("requisition_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_awarded_quotation_id_key" ON "rfqs"("awarded_quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_company_id_rfq_number_key" ON "rfqs"("company_id", "rfq_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotations_rfq_id_supplier_id_key" ON "supplier_quotations"("rfq_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotation_lines_quotation_id_line_number_key" ON "supplier_quotation_lines"("quotation_id", "line_number");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_status_idx" ON "purchase_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_order_number_key" ON "purchase_orders"("company_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_number_key" ON "purchase_order_lines"("purchase_order_id", "line_number");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_company_id_status_idx" ON "goods_receipt_notes"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_notes_company_id_grn_number_key" ON "goods_receipt_notes"("company_id", "grn_number");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_note_lines_goods_receipt_note_id_line_number_key" ON "goods_receipt_note_lines"("goods_receipt_note_id", "line_number");

-- CreateIndex
CREATE INDEX "supplier_invoices_company_id_status_idx" ON "supplier_invoices"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_company_id_supplier_id_supplier_invoice_n_key" ON "supplier_invoices"("company_id", "supplier_id", "supplier_invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_company_id_invoice_number_key" ON "supplier_invoices"("company_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_lines_invoice_id_line_number_key" ON "supplier_invoice_lines"("invoice_id", "line_number");

-- CreateIndex
CREATE INDEX "supplier_payments_company_id_status_idx" ON "supplier_payments"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_company_id_payment_number_key" ON "supplier_payments"("company_id", "payment_number");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_invoice_id_key" ON "payment_allocations"("payment_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "period_close_checklist_templates_company_id_code_key" ON "period_close_checklist_templates"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "period_close_checklists_financial_period_id_template_id_key" ON "period_close_checklists"("financial_period_id", "template_id");

-- CreateIndex
CREATE INDEX "period_close_logs_company_id_occurred_at_idx" ON "period_close_logs"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "period_close_logs_financial_year_id_action_idx" ON "period_close_logs"("financial_year_id", "action");

-- CreateIndex
CREATE INDEX "account_balances_company_id_financial_year_id_idx" ON "account_balances"("company_id", "financial_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_balances_financial_year_id_gl_account_id_is_opening_key" ON "account_balances"("financial_year_id", "gl_account_id", "is_opening");

-- CreateIndex
CREATE INDEX "period_reopen_requests_company_id_financial_period_id_idx" ON "period_reopen_requests"("company_id", "financial_period_id");

-- CreateIndex
CREATE INDEX "species_breeds_company_id_species_key_idx" ON "species_breeds"("company_id", "species_key");

-- CreateIndex
CREATE UNIQUE INDEX "species_breeds_company_id_species_key_code_key" ON "species_breeds"("company_id", "species_key", "code");

-- CreateIndex
CREATE UNIQUE INDEX "species_breed_stages_species_breed_id_stage_name_key" ON "species_breed_stages"("species_breed_id", "stage_name");

-- CreateIndex
CREATE INDEX "livestock_groups_company_id_species_key_status_idx" ON "livestock_groups"("company_id", "species_key", "status");

-- CreateIndex
CREATE INDEX "livestock_groups_pen_house_id_idx" ON "livestock_groups"("pen_house_id");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_groups_company_id_code_key" ON "livestock_groups"("company_id", "code");

-- CreateIndex
CREATE INDEX "livestock_group_disposals_group_id_idx" ON "livestock_group_disposals"("group_id");

-- CreateIndex
CREATE INDEX "daily_records_company_id_recorded_on_idx" ON "daily_records"("company_id", "recorded_on");

-- CreateIndex
CREATE UNIQUE INDEX "daily_records_group_id_recorded_on_key" ON "daily_records"("group_id", "recorded_on");

-- CreateIndex
CREATE UNIQUE INDEX "production_lines_daily_record_id_field_key_key" ON "production_lines"("daily_record_id", "field_key");

-- CreateIndex
CREATE INDEX "feed_issues_daily_record_id_idx" ON "feed_issues"("daily_record_id");

-- CreateIndex
CREATE INDEX "mortality_records_daily_record_id_idx" ON "mortality_records"("daily_record_id");

-- CreateIndex
CREATE INDEX "mortality_photos_mortality_record_id_idx" ON "mortality_photos"("mortality_record_id");

-- CreateIndex
CREATE INDEX "health_events_company_id_status_due_on_idx" ON "health_events"("company_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "health_events_group_id_due_on_idx" ON "health_events"("group_id", "due_on");

-- CreateIndex
CREATE INDEX "treatment_records_company_id_given_on_idx" ON "treatment_records"("company_id", "given_on");

-- CreateIndex
CREATE INDEX "treatment_records_group_id_given_on_idx" ON "treatment_records"("group_id", "given_on");

-- CreateIndex
CREATE INDEX "harvest_records_company_id_harvested_on_idx" ON "harvest_records"("company_id", "harvested_on");

-- CreateIndex
CREATE INDEX "harvest_records_group_id_harvested_on_idx" ON "harvest_records"("group_id", "harvested_on");

-- CreateIndex
CREATE INDEX "egg_collection_batches_company_id_collected_on_idx" ON "egg_collection_batches"("company_id", "collected_on");

-- CreateIndex
CREATE UNIQUE INDEX "egg_collection_batches_company_id_code_key" ON "egg_collection_batches"("company_id", "code");

-- CreateIndex
CREATE INDEX "incubation_batches_company_id_set_on_idx" ON "incubation_batches"("company_id", "set_on");

-- CreateIndex
CREATE UNIQUE INDEX "incubation_batches_company_id_code_key" ON "incubation_batches"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hatch_events_incubation_batch_id_key" ON "hatch_events"("incubation_batch_id");

-- CreateIndex
CREATE INDEX "hatch_events_company_id_hatched_on_idx" ON "hatch_events"("company_id", "hatched_on");

-- CreateIndex
CREATE UNIQUE INDEX "stage_changes_mortality_record_id_key" ON "stage_changes"("mortality_record_id");

-- CreateIndex
CREATE INDEX "stage_changes_company_id_changed_on_idx" ON "stage_changes"("company_id", "changed_on");

-- CreateIndex
CREATE INDEX "stage_changes_group_id_changed_on_idx" ON "stage_changes"("group_id", "changed_on");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_company_id_email_idx" ON "invitations"("company_id", "email");

-- CreateIndex
CREATE INDEX "invitations_expires_at_idx" ON "invitations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "posting_keys_company_id_active_idx" ON "posting_keys"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "posting_keys_company_id_key_key" ON "posting_keys"("company_id", "key");

-- CreateIndex
CREATE INDEX "posting_rules_company_id_status_effective_from_idx" ON "posting_rules"("company_id", "status", "effective_from");

-- CreateIndex
CREATE INDEX "posting_rules_company_id_module_cycle_idx" ON "posting_rules"("company_id", "module", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "posting_rules_company_id_rule_id_version_key" ON "posting_rules"("company_id", "rule_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "biological_asset_stage_accounts_company_id_species_key_stag_key" ON "biological_asset_stage_accounts"("company_id", "species_key", "stage");

-- CreateIndex
CREATE INDEX "biological_asset_valuations_company_id_group_id_valuation_d_idx" ON "biological_asset_valuations"("company_id", "group_id", "valuation_date");

-- CreateIndex
CREATE INDEX "market_price_lists_company_id_species_key_breed_effective_f_idx" ON "market_price_lists"("company_id", "species_key", "breed", "effective_from");

-- CreateIndex
CREATE INDEX "fixed_assets_company_id_status_idx" ON "fixed_assets"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_company_id_asset_number_key" ON "fixed_assets"("company_id", "asset_number");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_company_id_financial_period_id_key" ON "depreciation_runs"("company_id", "financial_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_entries_run_id_asset_id_key" ON "depreciation_entries"("run_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_definitions_company_id_key_key" ON "kpi_definitions"("company_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "report_definitions_company_id_key_key" ON "report_definitions"("company_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "implementation_phases_company_id_code_key" ON "implementation_phases"("company_id", "code");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_base_currency_id_fkey" FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_from_currency_id_fkey" FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_to_currency_id_fkey" FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pen_houses" ADD CONSTRAINT "pen_houses_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_pen_house_id_fkey" FOREIGN KEY ("pen_house_id") REFERENCES "pen_houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_section_access" ADD CONSTRAINT "role_section_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_section_access" ADD CONSTRAINT "role_section_access_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_configs" ADD CONSTRAINT "company_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_configs" ADD CONSTRAINT "company_configs_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_maker_id_fkey" FOREIGN KEY ("maker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transactions" ADD CONSTRAINT "workflow_transactions_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transaction_steps" ADD CONSTRAINT "workflow_transaction_steps_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "workflow_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transaction_steps" ADD CONSTRAINT "workflow_transaction_steps_acted_by_id_fkey" FOREIGN KEY ("acted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transaction_steps" ADD CONSTRAINT "workflow_transaction_steps_acted_on_behalf_of_id_fkey" FOREIGN KEY ("acted_on_behalf_of_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_history" ADD CONSTRAINT "workflow_history_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "workflow_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_history" ADD CONSTRAINT "workflow_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_history" ADD CONSTRAINT "workflow_history_on_behalf_of_id_fkey" FOREIGN KEY ("on_behalf_of_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_delegator_id_fkey" FOREIGN KEY ("delegator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_escalation_rules" ADD CONSTRAINT "workflow_escalation_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "workflow_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_notifications" ADD CONSTRAINT "workflow_notifications_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "workflow_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_notifications" ADD CONSTRAINT "workflow_notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_attachments" ADD CONSTRAINT "workflow_attachments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "workflow_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_attachments" ADD CONSTRAINT "workflow_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_configurations" ADD CONSTRAINT "tax_configurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_gl_mappings" ADD CONSTRAINT "tax_gl_mappings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_gl_mappings" ADD CONSTRAINT "tax_gl_mappings_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_gl_mappings" ADD CONSTRAINT "tax_gl_mappings_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_periods" ADD CONSTRAINT "tax_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_periods" ADD CONSTRAINT "tax_periods_filed_by_id_fkey" FOREIGN KEY ("filed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_register_entries" ADD CONSTRAINT "vat_register_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_register_entries" ADD CONSTRAINT "vat_register_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_register_entries" ADD CONSTRAINT "vat_register_entries_tax_period_id_fkey" FOREIGN KEY ("tax_period_id") REFERENCES "tax_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_register_entries" ADD CONSTRAINT "vat_register_entries_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_register_entries" ADD CONSTRAINT "vat_register_entries_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_register_entries" ADD CONSTRAINT "wht_register_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_register_entries" ADD CONSTRAINT "wht_register_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_register_entries" ADD CONSTRAINT "wht_register_entries_tax_period_id_fkey" FOREIGN KEY ("tax_period_id") REFERENCES "tax_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_register_entries" ADD CONSTRAINT "wht_register_entries_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_register_entries" ADD CONSTRAINT "wht_register_entries_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_tax_period_id_fkey" FOREIGN KEY ("tax_period_id") REFERENCES "tax_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_wht_tax_code_id_fkey" FOREIGN KEY ("wht_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_default_currency_id_fkey" FOREIGN KEY ("default_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_default_cost_centre_id_fkey" FOREIGN KEY ("default_cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_wht_tax_code_id_fkey" FOREIGN KEY ("wht_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_default_branch_id_fkey" FOREIGN KEY ("default_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_default_cost_centre_id_fkey" FOREIGN KEY ("default_cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_unit_of_measure_id_fkey" FOREIGN KEY ("unit_of_measure_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_vat_tax_code_id_fkey" FOREIGN KEY ("vat_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_inventory_gl_account_id_fkey" FOREIGN KEY ("inventory_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_expense_gl_account_id_fkey" FOREIGN KEY ("expense_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_revenue_gl_account_id_fkey" FOREIGN KEY ("revenue_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_default_warehouse_id_fkey" FOREIGN KEY ("default_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_standard_costs" ADD CONSTRAINT "item_standard_costs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "product_recipe_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_cost_pool_id_fkey" FOREIGN KEY ("cost_pool_id") REFERENCES "cost_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_routing_lines" ADD CONSTRAINT "production_order_routing_lines_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_routing_lines" ADD CONSTRAINT "production_order_routing_lines_routing_operation_id_fkey" FOREIGN KEY ("routing_operation_id") REFERENCES "routing_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_pools" ADD CONSTRAINT "cost_pools_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_pool_rates" ADD CONSTRAINT "cost_pool_rates_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "cost_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_reporting_manager_id_fkey" FOREIGN KEY ("reporting_manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_expense_gl_account_id_fkey" FOREIGN KEY ("expense_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_payable_gl_account_id_fkey" FOREIGN KEY ("payable_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary_components" ADD CONSTRAINT "employee_salary_components_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary_components" ADD CONSTRAINT "employee_salary_components_salary_component_id_fkey" FOREIGN KEY ("salary_component_id") REFERENCES "salary_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_output_item_id_fkey" FOREIGN KEY ("output_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_versions" ADD CONSTRAINT "product_recipe_versions_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "product_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_versions" ADD CONSTRAINT "product_recipe_versions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "product_recipe_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_component_item_id_fkey" FOREIGN KEY ("component_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_unit_of_measure_id_fkey" FOREIGN KEY ("unit_of_measure_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "product_recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_source_group_id_fkey" FOREIGN KEY ("source_group_id") REFERENCES "livestock_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_harvest_record_id_fkey" FOREIGN KEY ("harvest_record_id") REFERENCES "harvest_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_issue_journal_entry_id_fkey" FOREIGN KEY ("issue_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_conversion_journal_entry_id_fkey" FOREIGN KEY ("conversion_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_completion_journal_entry_id_fkey" FOREIGN KEY ("completion_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_settlement_journal_entry_id_fkey" FOREIGN KEY ("settlement_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_components" ADD CONSTRAINT "production_order_components_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_components" ADD CONSTRAINT "production_order_components_component_item_id_fkey" FOREIGN KEY ("component_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_components" ADD CONSTRAINT "production_order_components_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_outputs" ADD CONSTRAINT "production_order_outputs_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_outputs" ADD CONSTRAINT "production_order_outputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_outputs" ADD CONSTRAINT "production_order_outputs_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_loss_events" ADD CONSTRAINT "production_order_loss_events_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_loss_events" ADD CONSTRAINT "production_order_loss_events_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_issue_journal_entry_id_fkey" FOREIGN KEY ("issue_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_receipt_journal_entry_id_fkey" FOREIGN KEY ("receipt_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_write_offs" ADD CONSTRAINT "inventory_write_offs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_write_offs" ADD CONSTRAINT "inventory_write_offs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_write_offs" ADD CONSTRAINT "inventory_write_offs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_write_offs" ADD CONSTRAINT "inventory_write_offs_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_write_offs" ADD CONSTRAINT "inventory_write_offs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_write_offs" ADD CONSTRAINT "inventory_write_offs_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_types" ADD CONSTRAINT "journal_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_journal_type_id_fkey" FOREIGN KEY ("journal_type_id") REFERENCES "journal_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_journal_type_id_fkey" FOREIGN KEY ("journal_type_id") REFERENCES "journal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_reason_code_id_fkey" FOREIGN KEY ("reason_code_id") REFERENCES "reason_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "manual_journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_recurring_journal_id_fkey" FOREIGN KEY ("recurring_journal_id") REFERENCES "recurring_journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journals" ADD CONSTRAINT "manual_journals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_manual_journal_id_fkey" FOREIGN KEY ("manual_journal_id") REFERENCES "manual_journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_pen_house_id_fkey" FOREIGN KEY ("pen_house_id") REFERENCES "pen_houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT "manual_journal_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_attachments" ADD CONSTRAINT "manual_journal_attachments_manual_journal_id_fkey" FOREIGN KEY ("manual_journal_id") REFERENCES "manual_journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_journal_attachments" ADD CONSTRAINT "manual_journal_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_journal_type_id_fkey" FOREIGN KEY ("journal_type_id") REFERENCES "journal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_lines" ADD CONSTRAINT "recurring_journal_lines_recurring_journal_id_fkey" FOREIGN KEY ("recurring_journal_id") REFERENCES "recurring_journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_lines" ADD CONSTRAINT "recurring_journal_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paye_bands" ADD CONSTRAINT "paye_bands_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paye_configurations" ADD CONSTRAINT "paye_configurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_configurations" ADD CONSTRAINT "statutory_configurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_tax_reliefs" ADD CONSTRAINT "employee_tax_reliefs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_bank_gl_account_id_fkey" FOREIGN KEY ("bank_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_configurations" ADD CONSTRAINT "sales_configurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_configurations" ADD CONSTRAINT "sales_configurations_receivable_gl_account_id_fkey" FOREIGN KEY ("receivable_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_configurations" ADD CONSTRAINT "sales_configurations_revenue_gl_account_id_fkey" FOREIGN KEY ("revenue_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_configurations" ADD CONSTRAINT "sales_configurations_cost_of_sales_gl_account_id_fkey" FOREIGN KEY ("cost_of_sales_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_configurations" ADD CONSTRAINT "sales_configurations_inventory_gl_account_id_fkey" FOREIGN KEY ("inventory_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_configurations" ADD CONSTRAINT "sales_configurations_wht_receivable_gl_account_id_fkey" FOREIGN KEY ("wht_receivable_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "sales_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "sales_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_bank_gl_account_id_fkey" FOREIGN KEY ("bank_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_wht_tax_code_id_fkey" FOREIGN KEY ("wht_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "customer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_configurations" ADD CONSTRAINT "procurement_configurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_configurations" ADD CONSTRAINT "procurement_configurations_grni_gl_account_id_fkey" FOREIGN KEY ("grni_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_configurations" ADD CONSTRAINT "procurement_configurations_payables_gl_account_id_fkey" FOREIGN KEY ("payables_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_configurations" ADD CONSTRAINT "procurement_configurations_wht_payable_gl_account_id_fkey" FOREIGN KEY ("wht_payable_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awarded_quotation_id_fkey" FOREIGN KEY ("awarded_quotation_id") REFERENCES "supplier_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotation_lines" ADD CONSTRAINT "supplier_quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "supplier_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotation_lines" ADD CONSTRAINT "supplier_quotation_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_inspected_by_id_fkey" FOREIGN KEY ("inspected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_goods_receipt_note_id_fkey" FOREIGN KEY ("goods_receipt_note_id") REFERENCES "goods_receipt_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_wht_tax_code_id_fkey" FOREIGN KEY ("wht_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_goods_receipt_note_line_id_fkey" FOREIGN KEY ("goods_receipt_note_line_id") REFERENCES "goods_receipt_note_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_cost_gl_account_id_fkey" FOREIGN KEY ("cost_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_bank_gl_account_id_fkey" FOREIGN KEY ("bank_gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_wht_tax_code_id_fkey" FOREIGN KEY ("wht_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_checklist_templates" ADD CONSTRAINT "period_close_checklist_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_checklists" ADD CONSTRAINT "period_close_checklists_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_checklists" ADD CONSTRAINT "period_close_checklists_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "period_close_checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_checklists" ADD CONSTRAINT "period_close_checklists_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_logs" ADD CONSTRAINT "period_close_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_logs" ADD CONSTRAINT "period_close_logs_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_logs" ADD CONSTRAINT "period_close_logs_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_logs" ADD CONSTRAINT "period_close_logs_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_reopen_requests" ADD CONSTRAINT "period_reopen_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_reopen_requests" ADD CONSTRAINT "period_reopen_requests_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_reopen_requests" ADD CONSTRAINT "period_reopen_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_reopen_requests" ADD CONSTRAINT "period_reopen_requests_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "species_breeds" ADD CONSTRAINT "species_breeds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "species_breed_stages" ADD CONSTRAINT "species_breed_stages_species_breed_id_fkey" FOREIGN KEY ("species_breed_id") REFERENCES "species_breeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_groups" ADD CONSTRAINT "livestock_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_groups" ADD CONSTRAINT "livestock_groups_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_groups" ADD CONSTRAINT "livestock_groups_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_groups" ADD CONSTRAINT "livestock_groups_pen_house_id_fkey" FOREIGN KEY ("pen_house_id") REFERENCES "pen_houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_group_disposals" ADD CONSTRAINT "livestock_group_disposals_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_group_disposals" ADD CONSTRAINT "livestock_group_disposals_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_records" ADD CONSTRAINT "daily_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_records" ADD CONSTRAINT "daily_records_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_records" ADD CONSTRAINT "daily_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "daily_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_issues" ADD CONSTRAINT "feed_issues_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "daily_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_issues" ADD CONSTRAINT "feed_issues_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_issues" ADD CONSTRAINT "feed_issues_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortality_records" ADD CONSTRAINT "mortality_records_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "daily_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortality_records" ADD CONSTRAINT "mortality_records_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortality_photos" ADD CONSTRAINT "mortality_photos_mortality_record_id_fkey" FOREIGN KEY ("mortality_record_id") REFERENCES "mortality_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_health_event_id_fkey" FOREIGN KEY ("health_event_id") REFERENCES "health_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_moved_to_group_id_fkey" FOREIGN KEY ("moved_to_group_id") REFERENCES "livestock_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collection_batches" ADD CONSTRAINT "egg_collection_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collection_batches" ADD CONSTRAINT "egg_collection_batches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collection_batches" ADD CONSTRAINT "egg_collection_batches_source_group_id_fkey" FOREIGN KEY ("source_group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collection_batches" ADD CONSTRAINT "egg_collection_batches_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collection_batches" ADD CONSTRAINT "egg_collection_batches_pen_house_id_fkey" FOREIGN KEY ("pen_house_id") REFERENCES "pen_houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collection_batches" ADD CONSTRAINT "egg_collection_batches_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_collection_batches" ADD CONSTRAINT "egg_collection_batches_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incubation_batches" ADD CONSTRAINT "incubation_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incubation_batches" ADD CONSTRAINT "incubation_batches_egg_batch_id_fkey" FOREIGN KEY ("egg_batch_id") REFERENCES "egg_collection_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incubation_batches" ADD CONSTRAINT "incubation_batches_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hatch_events" ADD CONSTRAINT "hatch_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hatch_events" ADD CONSTRAINT "hatch_events_incubation_batch_id_fkey" FOREIGN KEY ("incubation_batch_id") REFERENCES "incubation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hatch_events" ADD CONSTRAINT "hatch_events_chick_group_id_fkey" FOREIGN KEY ("chick_group_id") REFERENCES "livestock_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hatch_events" ADD CONSTRAINT "hatch_events_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hatch_events" ADD CONSTRAINT "hatch_events_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_from_pen_house_id_fkey" FOREIGN KEY ("from_pen_house_id") REFERENCES "pen_houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_to_pen_house_id_fkey" FOREIGN KEY ("to_pen_house_id") REFERENCES "pen_houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_mortality_record_id_fkey" FOREIGN KEY ("mortality_record_id") REFERENCES "mortality_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_keys" ADD CONSTRAINT "posting_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_keys" ADD CONSTRAINT "posting_keys_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_rules" ADD CONSTRAINT "posting_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biological_asset_stage_accounts" ADD CONSTRAINT "biological_asset_stage_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biological_asset_stage_accounts" ADD CONSTRAINT "biological_asset_stage_accounts_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biological_asset_configurations" ADD CONSTRAINT "biological_asset_configurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biological_asset_valuations" ADD CONSTRAINT "biological_asset_valuations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biological_asset_valuations" ADD CONSTRAINT "biological_asset_valuations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biological_asset_valuations" ADD CONSTRAINT "biological_asset_valuations_workflow_transaction_id_fkey" FOREIGN KEY ("workflow_transaction_id") REFERENCES "workflow_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biological_asset_valuations" ADD CONSTRAINT "biological_asset_valuations_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biological_asset_valuations" ADD CONSTRAINT "biological_asset_valuations_prepared_by_id_fkey" FOREIGN KEY ("prepared_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price_lists" ADD CONSTRAINT "market_price_lists_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price_lists" ADD CONSTRAINT "market_price_lists_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "depreciation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_definitions" ADD CONSTRAINT "kpi_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_phases" ADD CONSTRAINT "implementation_phases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

