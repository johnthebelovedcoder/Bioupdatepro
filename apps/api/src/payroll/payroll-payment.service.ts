import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, PayrollPayableBucket, PayrollRunStatus, PaymentStatus, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { PayrollRunService } from './payroll-run.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

const BUCKET_PAYABLE_ACCOUNT: Record<PayrollPayableBucket, string> = {
  SALARY: 'salaryPayable',
  PAYE: 'payePayable',
  PENSION: 'pensionPayable',
  NHF: 'nhfPayable',
  NSITF: 'nsitfPayable',
  ITF: 'itfPayable',
};

const BUCKET_LABEL: Record<PayrollPayableBucket, string> = {
  SALARY: 'Net salary payable',
  PAYE: 'PAYE payable',
  PENSION: 'Pension payable',
  NHF: 'NHF payable',
  NSITF: 'NSITF payable',
  ITF: 'ITF payable',
};

/**
 * A payroll run's accrual posts correctly — Dr Salary/Employer Expense,
 * Cr Salary/PAYE/Pension/NHF/NSITF/ITF Payable — and nothing has ever
 * cleared those six balances since. This is the other half: US-897-024.
 *
 * Mirrors SupplierPaymentService's own shape deliberately rather than
 * inventing a new one — allocate against outstanding, submit through the
 * shared workflow engine, post Dr [bucket] Payable / Cr Bank on approval.
 * The difference is scope: a supplier payment allocates across many
 * invoices, a payroll payment clears one bucket of one run — the six
 * payable accounts a single accrual credits are typically remitted on
 * different days to different payees (staff, FIRS, a PFA, NHF, NSITF, ITF),
 * so one document per bucket per run is the natural shape, not a limitation.
 */
@Injectable()
export class PayrollPaymentService {
  private readonly logger = new Logger(PayrollPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly runs: PayrollRunService,
  ) {}

  /** Each bucket's total, what has been settled, and what remains. */
  async outstanding(payrollRunId: string) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: payrollRunId } });
    const totals: Record<PayrollPayableBucket, bigint> = {
      SALARY: run.totalNetPayKobo,
      PAYE: run.totalPayeKobo,
      PENSION: run.totalEmployeePensionKobo + run.totalEmployerPensionKobo,
      NHF: run.totalNhfKobo,
      NSITF: run.totalNsitfKobo,
      ITF: run.totalItfKobo,
    };
    const settled: Record<PayrollPayableBucket, bigint> = {
      SALARY: run.totalSalarySettledKobo,
      PAYE: run.totalPayeSettledKobo,
      PENSION: run.totalPensionSettledKobo,
      NHF: run.totalNhfSettledKobo,
      NSITF: run.totalNsitfSettledKobo,
      ITF: run.totalItfSettledKobo,
    };
    return (Object.keys(totals) as PayrollPayableBucket[]).map((bucket) => ({
      bucket,
      label: BUCKET_LABEL[bucket],
      totalKobo: totals[bucket].toString(),
      settledKobo: settled[bucket].toString(),
      outstandingKobo: (totals[bucket] - settled[bucket]).toString(),
    }));
  }

  async create(input: {
    companyId: string;
    payrollRunId: string;
    paymentNumber: string;
    bucket: PayrollPayableBucket;
    amountKobo: bigint;
    paymentDate: Date;
    method: Prisma.PayrollPaymentCreateInput['method'];
    bankGlAccountId: string;
    reference?: string | null;
    narration?: string | null;
    branchId: string;
    currencyId: string;
    financialYearId: string;
    financialPeriodId: string;
    actor: WorkflowActor;
  }) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({
      where: { id: input.payrollRunId },
    });

    if (run.status !== PayrollRunStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll payment',
        `Payroll run ${run.reference} is ${run.status}; only a posted run's accrual has a ` +
          `payable balance to clear.`,
        { reference: run.reference },
      );
    }

    if (input.amountKobo <= 0n) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll payment',
        'A payroll payment must be for a positive amount.',
        {},
      );
    }

    const outstanding = await this.bucketOutstanding(run, input.bucket);
    if (input.amountKobo > outstanding) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll payment',
        `Cannot pay ${input.amountKobo} kobo against ${BUCKET_LABEL[input.bucket]} on ` +
          `${run.reference}: only ${outstanding} kobo is outstanding. Over-allocation would ` +
          `overpay past what was accrued.`,
        { reference: run.reference, bucket: input.bucket, outstandingKobo: outstanding.toString() },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payrollPayment.create({
        data: {
          companyId: input.companyId,
          payrollRunId: input.payrollRunId,
          paymentNumber: input.paymentNumber,
          bucket: input.bucket,
          amountKobo: input.amountKobo,
          paymentDate: input.paymentDate,
          method: input.method,
          bankGlAccountId: input.bankGlAccountId,
          reference: input.reference ?? null,
          narration: input.narration ?? null,
          branchId: input.branchId,
          currencyId: input.currencyId,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          createdById: input.actor.userId,
        },
      });

      await this.audit.write(
        {
          transactionId: payment.id,
          module: 'payroll',
          entityType: 'PayrollPayment',
          entityId: payment.id,
          status: payment.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments: `Raised payment ${payment.paymentNumber} for ${BUCKET_LABEL[input.bucket]} on ${run.reference}.`,
          metadata: { bucket: input.bucket, amountKobo: input.amountKobo.toString() },
        },
        tx,
      );

      return payment;
    });
  }

  async submit(params: { paymentId: string; actor: WorkflowActor }) {
    const payment = await this.prisma.payrollPayment.findUniqueOrThrow({
      where: { id: params.paymentId },
    });

    if (payment.status !== PaymentStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll payment',
        `${payment.paymentNumber} is ${payment.status} and cannot be submitted.`,
        { paymentNumber: payment.paymentNumber },
      );
    }

    const result = await this.workflow.submit({
      companyId: payment.companyId,
      transactionType: 'PAYROLL_PAYMENT',
      module: 'payroll',
      documentType: 'PayrollPayment',
      documentId: payment.id,
      documentReference: payment.paymentNumber,
      amount: kobo(payment.amountKobo),
      currencyId: payment.currencyId,
      branchId: payment.branchId,
      actor: params.actor,
    });

    await this.prisma.payrollPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  async postApproved(params: {
    paymentId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const payment = await params.tx.payrollPayment.findUniqueOrThrow({
      where: { id: params.paymentId },
      include: { payrollRun: true },
    });

    if (payment.status === PaymentStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${payment.paymentNumber} is already posted.`,
        { paymentNumber: payment.paymentNumber },
      );
    }

    // Re-check outstanding at approval time, not just at submission — a
    // sibling payment against the same bucket could have posted in between.
    const outstanding = await this.bucketOutstanding(payment.payrollRun, payment.bucket, params.tx);
    if (payment.amountKobo > outstanding) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll payment',
        `${payment.paymentNumber} would settle more than remains outstanding on ` +
          `${BUCKET_LABEL[payment.bucket]} for ${payment.payrollRun.reference} — another ` +
          `payment against it must have posted first.`,
        { paymentNumber: payment.paymentNumber },
      );
    }

    const accounts = await this.runs.resolveAccounts(payment.companyId, params.tx);
    const payableAccountId = accounts[BUCKET_PAYABLE_ACCOUNT[payment.bucket] as keyof typeof accounts];

    const dimensions = {
      companyId: payment.companyId,
      branchId: payment.branchId,
      financialYearId: payment.financialYearId,
      financialPeriodId: payment.financialPeriodId,
      currencyId: payment.currencyId,
      exchangeRate: '1.00000000',
    };

    const result = await this.posting.post(
      {
        sourceModule: 'payroll',
        sourceDocumentType: 'PayrollPayment',
        sourceDocumentId: payment.id,
        journalNumber: payment.paymentNumber,
        journalDate: payment.paymentDate,
        narration: payment.narration ?? `Payroll payment ${payment.paymentNumber}`,
        ...dimensions,
        idempotencyKey: `payroll-payment:${payment.id}`,
        actor: params.actor,
        lines: [
          {
            glAccountId: payableAccountId,
            description: `${BUCKET_LABEL[payment.bucket]} settled — ${payment.paymentNumber}`,
            debit: kobo(payment.amountKobo),
            dimensions,
          },
          {
            glAccountId: payment.bankGlAccountId,
            description: `Payroll payment ${payment.paymentNumber}`,
            credit: kobo(payment.amountKobo),
            dimensions,
          },
        ],
      },
      params.tx,
    );

    const settledField = SETTLED_FIELD[payment.bucket];
    await params.tx.payrollRun.update({
      where: { id: payment.payrollRunId },
      data: { [settledField]: { increment: payment.amountKobo } },
    });

    await params.tx.payrollPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.POSTED,
        journalEntryId: result.journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(`Posted payroll payment ${payment.paymentNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  private async bucketOutstanding(
    run: { id: string },
    bucket: PayrollPayableBucket,
    tx?: Prisma.TransactionClient,
  ): Promise<bigint> {
    const client = tx ?? this.prisma;
    const fresh = await client.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    const totals: Record<PayrollPayableBucket, bigint> = {
      SALARY: fresh.totalNetPayKobo,
      PAYE: fresh.totalPayeKobo,
      PENSION: fresh.totalEmployeePensionKobo + fresh.totalEmployerPensionKobo,
      NHF: fresh.totalNhfKobo,
      NSITF: fresh.totalNsitfKobo,
      ITF: fresh.totalItfKobo,
    };
    const settled: Record<PayrollPayableBucket, bigint> = {
      SALARY: fresh.totalSalarySettledKobo,
      PAYE: fresh.totalPayeSettledKobo,
      PENSION: fresh.totalPensionSettledKobo,
      NHF: fresh.totalNhfSettledKobo,
      NSITF: fresh.totalNsitfSettledKobo,
      ITF: fresh.totalItfSettledKobo,
    };
    return totals[bucket] - settled[bucket];
  }
}

const SETTLED_FIELD: Record<PayrollPayableBucket, string> = {
  SALARY: 'totalSalarySettledKobo',
  PAYE: 'totalPayeSettledKobo',
  PENSION: 'totalPensionSettledKobo',
  NHF: 'totalNhfSettledKobo',
  NSITF: 'totalNsitfSettledKobo',
  ITF: 'totalItfSettledKobo',
};
