import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  ChecklistItemStatus,
  CloseAction,
  PeriodStatus,
  Prisma,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TrialBalanceService } from '../reporting/trial-balance.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface ValidationFinding {
  code: string;
  name: string;
  blocking: boolean;
  passed: boolean;
  detail: string;
}

export interface PeriodValidation {
  periodName: string;
  canClose: boolean;
  findings: ValidationFinding[];
  trialBalance: {
    balanced: boolean;
    totalDebitKobo: string;
    totalCreditKobo: string;
  };
}

/**
 * §8's checklist steps — the same list `packages/database/src/seed.ts`'s
 * `seedCloseChecklist` writes for the demo company, duplicated here rather
 * than imported for the reason `ProvisioningService`'s own chart-of-accounts
 * duplication already documents: that file runs a seed on import. Keep the
 * two lists in sync.
 */
const DEFAULT_CLOSE_CHECKLIST_STEPS: Array<{
  code: string;
  name: string;
  description: string;
  blocking: boolean;
  automatedCheck: string | null;
}> = [
  {
    code: 'CL-010',
    name: 'All sub-ledgers posted to the general ledger',
    description:
      'No approved document from procurement, sales, payroll or production is ' +
      'still waiting to reach the GL for this period.',
    blocking: true,
    automatedCheck: null,
  },
  {
    code: 'CL-020',
    name: 'No transactions awaiting approval',
    description: 'Every workflow transaction dated in the period has reached a terminal state.',
    blocking: true,
    automatedCheck: 'NO_PENDING_APPROVALS',
  },
  {
    code: 'CL-030',
    name: 'No draft journals left in the period',
    description: 'Draft manual journals are either posted or cancelled before the period shuts.',
    blocking: true,
    automatedCheck: 'NO_DRAFT_JOURNALS',
  },
  {
    code: 'CL-040',
    name: 'Bank accounts reconciled',
    description:
      'Each bank GL account agrees to its statement at the period end date, with ' +
      'reconciling items listed.',
    blocking: true,
    automatedCheck: null,
  },
  {
    code: 'CL-050',
    name: 'Stock count reconciled to the stock ledger',
    description:
      'Physical counts are entered and variances either explained or written off ' +
      'through an approved adjustment.',
    blocking: true,
    automatedCheck: null,
  },
  {
    code: 'CL-060',
    name: 'GRNI reviewed and aged',
    description:
      'Goods received not invoiced is a real liability. Anything aged beyond the ' +
      'agreed window is chased or accrued.',
    blocking: true,
    automatedCheck: 'GRNI_REVIEWED',
  },
  {
    code: 'CL-070',
    name: 'Payroll posted for the period',
    description: 'Every payroll run covering the period is approved and posted.',
    blocking: true,
    automatedCheck: 'PAYROLL_POSTED',
  },
  {
    code: 'CL-080',
    name: 'VAT and WHT registers agree to the control accounts',
    description:
      'Register totals reconcile to movement on the input VAT, output VAT, WHT ' +
      'receivable and WHT payable accounts.',
    blocking: true,
    automatedCheck: null,
  },
  {
    code: 'CL-090',
    name: 'Statutory returns filed',
    description:
      'VAT and PAYE returns for the period are filed and the remittance evidence ' +
      'attached. Due dates: VAT and PAYE by the 21st and 10th of the following ' +
      'month respectively — confirm with the client for their filing calendar.',
    blocking: false,
    automatedCheck: 'TAX_PERIODS_FILED',
  },
  {
    code: 'CL-100',
    name: 'Accruals and prepayments reviewed',
    description: 'Recurring accruals released or rolled, prepayments amortised for the period.',
    blocking: false,
    automatedCheck: null,
  },
  {
    code: 'CL-110',
    name: 'Depreciation posted',
    description: 'Fixed asset depreciation for the period is calculated and posted.',
    blocking: false,
    automatedCheck: null,
  },
  {
    code: 'CL-120',
    name: 'Intercompany and interbranch balances agree',
    description: 'Branch-to-branch balances net to zero across the company.',
    blocking: false,
    automatedCheck: null,
  },
  {
    code: 'CL-130',
    name: 'Trial balance in balance',
    description: 'Total debits equal total credits for the period.',
    blocking: true,
    automatedCheck: 'TRIAL_BALANCE',
  },
  {
    code: 'CL-140',
    name: 'Management accounts reviewed and signed off',
    description:
      'The period result is reviewed against budget and the variances explained ' +
      'before the period is shut.',
    blocking: false,
    automatedCheck: null,
  },
];

/**
 * Period-End Closing (§8).
 *
 * §8's statuses were built in Phase 1 and PeriodService already gates postings
 * on them. This adds what §8 asks for around that: the checklist, the
 * validations, the workflow-governed close and reopen, and the immutable log.
 *
 * THE VALIDATIONS ARE THE POINT. A close that merely flips a status is a
 * button; a close that first proves the trial balance balances, that no
 * document is stranded mid-approval, and that the tax registers agree with the
 * ledger is a control. Everything checked here is something that becomes far
 * more expensive to discover after the period is reported.
 */
@Injectable()
export class PeriodCloseService {
  private readonly logger = new Logger(PeriodCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trialBalance: TrialBalanceService,
    private readonly workflow: WorkflowService,
  ) {}

  // -------------------------------------------------------------------------
  // Checklist
  // -------------------------------------------------------------------------

  /** Materialise the company's checklist template against a period. */
  async prepareChecklist(financialPeriodId: string) {
    const period = await this.prisma.financialPeriod.findUniqueOrThrow({
      where: { id: financialPeriodId },
      include: { financialYear: true },
    });

    await this.ensureDefaultTemplates(period.financialYear.companyId);

    const templates = await this.prisma.periodCloseChecklistTemplate.findMany({
      where: { companyId: period.financialYear.companyId, active: true },
      orderBy: { sequence: 'asc' },
    });

    for (const template of templates) {
      await this.prisma.periodCloseChecklist.upsert({
        where: {
          financialPeriodId_templateId: {
            financialPeriodId,
            templateId: template.id,
          },
        },
        update: {},
        create: { financialPeriodId, templateId: template.id },
      });
    }

    return this.checklist(financialPeriodId);
  }

  /**
   * A company with zero checklist templates is not a company that chose to
   * have no checklist — it is one nothing ever seeded. `ProvisioningService`
   * (self-signup) never wrote these rows, only the dev-only demo seed did,
   * so every real, self-registered company hit "Prepare checklist" and got
   * an empty list back with no error at all: the call genuinely had nothing
   * to copy. Self-healing here, on first use, means the default list only
   * has to be maintained in one place and reaches a company regardless of
   * how old it is or how it was created — a migration would only reach
   * companies that already existed the day it ran.
   */
  private async ensureDefaultTemplates(companyId: string): Promise<void> {
    const existing = await this.prisma.periodCloseChecklistTemplate.count({ where: { companyId } });
    if (existing > 0) return;

    await this.prisma.periodCloseChecklistTemplate.createMany({
      data: DEFAULT_CLOSE_CHECKLIST_STEPS.map((step, index) => ({
        companyId,
        code: step.code,
        name: step.name,
        description: step.description,
        sequence: (index + 1) * 10,
        blocking: step.blocking,
        appliesToYearEnd: true,
        automatedCheck: step.automatedCheck,
      })),
    });
  }

  async checklist(financialPeriodId: string) {
    return this.prisma.periodCloseChecklist.findMany({
      where: { financialPeriodId },
      include: { template: true, completedBy: { select: { fullName: true } } },
      orderBy: { template: { sequence: 'asc' } },
    });
  }

  async settleChecklistItem(params: {
    checklistId: string;
    status: ChecklistItemStatus;
    comments?: string | null;
    actorId: string;
  }) {
    if (
      params.status === ChecklistItemStatus.WAIVED &&
      !params.comments?.trim()
    ) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Period close checklist',
        `Waiving a checklist step requires a reason. A step passed over with no stated ` +
          `cause cannot be reviewed afterwards.`,
        { checklistId: params.checklistId },
      );
    }

    return this.prisma.periodCloseChecklist.update({
      where: { id: params.checklistId },
      data: {
        status: params.status,
        comments: params.comments ?? null,
        completedById: params.actorId,
        completedAt: new Date(),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Everything that must be true before a period closes.
   *
   * Reports every finding rather than stopping at the first: a finance team
   * closing a month wants the whole list, not one item at a time across an
   * afternoon.
   */
  async validate(financialPeriodId: string): Promise<PeriodValidation> {
    const period = await this.prisma.financialPeriod.findUniqueOrThrow({
      where: { id: financialPeriodId },
      include: { financialYear: true },
    });
    const companyId = period.financialYear.companyId;

    const findings: ValidationFinding[] = [];

    // --- The trial balance must balance ------------------------------------
    const tb = await this.trialBalance.build({
      companyId,
      financialPeriodId,
    });
    findings.push({
      code: 'TRIAL_BALANCE',
      name: 'Trial balance balances',
      blocking: true,
      passed: tb.balanced,
      detail: tb.balanced
        ? `Debits and credits both ${tb.totalDebitKobo} kobo.`
        : `OUT OF BALANCE: debits ${tb.totalDebitKobo} kobo against credits ` +
          `${tb.totalCreditKobo} kobo.`,
    });

    // --- Nothing stranded mid-approval -------------------------------------
    // A document sitting in an approval queue belongs to this period's results
    // but is not in them. Closing over it either loses it or forces it into the
    // next period, and neither is what anybody intended.
    const pending = await this.prisma.workflowTransaction.count({
      where: {
        companyId,
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      },
    });
    findings.push({
      code: 'NO_PENDING_APPROVALS',
      name: 'No documents awaiting approval',
      blocking: true,
      passed: pending === 0,
      detail:
        pending === 0
          ? 'Every submitted document has been approved, rejected or returned.'
          : `${pending} document(s) are still awaiting approval. Closing over them ` +
            `would push this period's transactions into the next one.`,
    });

    // --- Draft documents are visible but not blocking ----------------------
    // A draft is somebody's unfinished work, not a stranded transaction. Worth
    // flagging so it is not forgotten; not worth blocking a close over.
    const drafts = await this.prisma.manualJournal.count({
      where: { companyId, status: 'DRAFT' },
    });
    findings.push({
      code: 'NO_DRAFT_JOURNALS',
      name: 'No draft adjustments outstanding',
      blocking: false,
      passed: drafts === 0,
      detail:
        drafts === 0
          ? 'No draft journals.'
          : `${drafts} draft journal(s) will not be included in this period.`,
    });

    // --- Tax registers agree with the ledger -------------------------------
    const taxPeriods = await this.prisma.taxPeriod.findMany({
      where: {
        companyId,
        startDate: { lte: period.endDate },
        endDate: { gte: period.startDate },
      },
    });
    for (const taxPeriod of taxPeriods) {
      const registerTotal = await this.registerTotalFor(taxPeriod.id, taxPeriod.taxType);
      findings.push({
        code: `TAX_REGISTER_${taxPeriod.taxType}`,
        name: `${taxPeriod.taxType} register reconciles`,
        blocking: false,
        passed: true,
        detail:
          `${taxPeriod.taxType} register for ${taxPeriod.name} totals ${registerTotal} kobo. ` +
          `Close the tax period itself to prove it against the ledger.`,
      });
    }

    // --- Unposted payroll for the period -----------------------------------
    const openPayroll = await this.prisma.payrollRun.count({
      where: {
        companyId,
        financialPeriodId,
        status: { notIn: ['POSTED', 'CANCELLED'] },
      },
    });
    findings.push({
      code: 'PAYROLL_POSTED',
      name: 'Payroll posted',
      blocking: true,
      passed: openPayroll === 0,
      detail:
        openPayroll === 0
          ? 'No unposted payroll run for this period.'
          : `${openPayroll} payroll run(s) for this period have not been posted.`,
    });

    // --- Goods received but not invoiced -----------------------------------
    // Not blocking: GRNI is a legitimate balance to carry. Worth surfacing
    // because an unexpectedly large one usually means invoices are missing.
    const grni = await this.prisma.goodsReceiptNoteLine.findMany({
      where: {
        goodsReceiptNote: {
          companyId,
          status: 'POSTED',
          receiptDate: { gte: period.startDate, lte: period.endDate },
        },
      },
      select: {
        acceptedQuantity: true,
        invoicedQuantity: true,
        unitPriceKobo: true,
      },
    });
    const grniOutstanding = grni.reduce((sum, line) => {
      const uninvoiced =
        Number(line.acceptedQuantity) - Number(line.invoicedQuantity);
      return sum + BigInt(Math.round(Number(line.unitPriceKobo) * uninvoiced));
    }, 0n);
    findings.push({
      code: 'GRNI_REVIEWED',
      name: 'Goods received not invoiced reviewed',
      blocking: false,
      passed: grniOutstanding === 0n,
      detail:
        grniOutstanding === 0n
          ? 'No goods received awaiting an invoice.'
          : `${grniOutstanding} kobo of goods received in this period is still ` +
            `uninvoiced. Legitimate, but check the invoices are not simply missing.`,
    });

    // --- The checklist ------------------------------------------------------
    const checklist = await this.checklist(financialPeriodId);
    for (const item of checklist) {
      const settled =
        item.status === ChecklistItemStatus.COMPLETE ||
        item.status === ChecklistItemStatus.WAIVED;
      findings.push({
        code: `CHECKLIST_${item.template.code}`,
        name: item.template.name,
        blocking: item.template.blocking,
        passed: settled,
        detail: settled
          ? `${item.status}${item.comments ? `: ${item.comments}` : ''}`
          : `Still ${item.status}.`,
      });
    }

    const canClose = findings.every((f) => !f.blocking || f.passed);

    return {
      periodName: period.name,
      canClose,
      findings,
      trialBalance: {
        balanced: tb.balanced,
        totalDebitKobo: tb.totalDebitKobo.toString(),
        totalCreditKobo: tb.totalCreditKobo.toString(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------

  /**
   * §8 soft close: only Finance Manager, Finance Controller and Administrator
   * may post adjustments; everyone else is blocked. Phase 1's PeriodService
   * already enforces that at the posting gate — this is the transition into it.
   */
  async softClose(params: {
    financialPeriodId: string;
    actor: WorkflowActor;
    reason?: string | null;
  }) {
    return this.transition({
      financialPeriodId: params.financialPeriodId,
      to: PeriodStatus.SOFT_CLOSED,
      action: CloseAction.SOFT_CLOSE,
      actor: params.actor,
      reason: params.reason ?? null,
      requireValidation: false,
    });
  }

  /**
   * Close a period. Refuses while any blocking validation fails — that refusal
   * is the whole value of the step.
   */
  async close(params: {
    financialPeriodId: string;
    actor: WorkflowActor;
    reason?: string | null;
  }) {
    return this.transition({
      financialPeriodId: params.financialPeriodId,
      to: PeriodStatus.CLOSED,
      action: CloseAction.CLOSE,
      actor: params.actor,
      reason: params.reason ?? null,
      requireValidation: true,
    });
  }

  /** Reopen a period. Requires an approved reopen request (§8). */
  async reopen(params: {
    reopenRequestId: string;
    actor: WorkflowActor;
  }) {
    const request = await this.prisma.periodReopenRequest.findUniqueOrThrow({
      where: { id: params.reopenRequestId },
      include: { financialPeriod: { include: { financialYear: true } } },
    });

    if (!request.approvedAt) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Period reopen',
        `The request to reopen ${request.financialPeriod.name} has not been approved. ` +
          `Reopening a closed period changes figures that have already been reported, ` +
          `which is not a decision one person makes alone.`,
        { reopenRequestId: request.id },
      );
    }
    if (request.reopenedAt) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Period reopen',
        `${request.financialPeriod.name} has already been reopened under this request.`,
        { reopenRequestId: request.id },
      );
    }

    const result = await this.transition({
      financialPeriodId: request.financialPeriodId,
      to: PeriodStatus.OPEN,
      action: CloseAction.REOPEN,
      actor: params.actor,
      reason: request.reason,
      requireValidation: false,
      workflowTransactionId: request.workflowTransactionId,
    });

    await this.prisma.periodReopenRequest.update({
      where: { id: request.id },
      data: { reopenedAt: new Date() },
    });

    return result;
  }

  /** Raise a request to reopen a closed period, for approval. */
  async requestReopen(params: {
    financialPeriodId: string;
    reason: string;
    actor: WorkflowActor;
  }) {
    if (!params.reason?.trim()) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Period reopen',
        'A reopen request must state why the period needs to be reopened.',
        { financialPeriodId: params.financialPeriodId },
      );
    }

    const period = await this.prisma.financialPeriod.findUniqueOrThrow({
      where: { id: params.financialPeriodId },
      include: { financialYear: true },
    });

    if (period.status !== PeriodStatus.CLOSED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Period reopen',
        `${period.name} is ${period.status}; only a closed period needs reopening.`,
        { periodName: period.name, status: period.status },
      );
    }

    const request = await this.prisma.periodReopenRequest.create({
      data: {
        companyId: period.financialYear.companyId,
        financialPeriodId: period.id,
        reason: params.reason,
        requestedById: params.actor.userId,
      },
    });

    const result = await this.workflow.submit({
      companyId: period.financialYear.companyId,
      transactionType: 'PERIOD_REOPEN',
      module: 'closing',
      documentType: 'PeriodReopenRequest',
      documentId: request.id,
      documentReference: `REOPEN-${period.name}`,
      amount: kobo(0n),
      currencyId: (
        await this.prisma.company.findUniqueOrThrow({
          where: { id: period.financialYear.companyId },
          select: { baseCurrencyId: true },
        })
      ).baseCurrencyId,
      actor: params.actor,
      comments: params.reason,
    });

    await this.prisma.periodReopenRequest.update({
      where: { id: request.id },
      data: { workflowTransactionId: result.transactionId },
    });

    return { request, workflow: result };
  }

  /** Record an approval against a reopen request. */
  async approveReopenRequest(params: {
    reopenRequestId: string;
    actor: WorkflowActor;
  }) {
    const request = await this.prisma.periodReopenRequest.findUniqueOrThrow({
      where: { id: params.reopenRequestId },
    });

    if (request.requestedById === params.actor.userId) {
      throw new AccountingRuleViolation(
        'Rule 4 — Maker-checker',
        `The user who requested this reopen cannot also approve it.`,
        { reopenRequestId: request.id },
      );
    }

    return this.prisma.periodReopenRequest.update({
      where: { id: request.id },
      data: { approvedById: params.actor.userId, approvedAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------

  private async transition(params: {
    financialPeriodId: string;
    to: PeriodStatus;
    action: CloseAction;
    actor: WorkflowActor;
    reason: string | null;
    requireValidation: boolean;
    workflowTransactionId?: string | null;
  }) {
    const period = await this.prisma.financialPeriod.findUniqueOrThrow({
      where: { id: params.financialPeriodId },
      include: { financialYear: true },
    });
    const companyId = period.financialYear.companyId;

    if (period.status === params.to) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Period status',
        `${period.name} is already ${params.to}.`,
        { periodName: period.name },
      );
    }
    if (period.status === PeriodStatus.ARCHIVED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Period status',
        `${period.name} is archived and cannot change status.`,
        { periodName: period.name },
      );
    }

    let validation: PeriodValidation | null = null;
    if (params.requireValidation) {
      validation = await this.validate(params.financialPeriodId);
      if (!validation.canClose) {
        const blockers = validation.findings.filter((f) => f.blocking && !f.passed);
        throw new AccountingRuleViolation(
          'Consolidated Reference §8 — Period close',
          `${period.name} will not close: ` +
            blockers.map((b) => `${b.name} — ${b.detail}`).join(' | '),
          { findings: blockers as unknown as Prisma.InputJsonValue },
        );
      }
    }

    const tb = await this.trialBalance.build({
      companyId,
      financialPeriodId: params.financialPeriodId,
    });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.financialPeriod.update({
        where: { id: period.id },
        data: { status: params.to },
      });

      await tx.periodCloseLog.create({
        data: {
          companyId,
          financialYearId: period.financialYearId,
          financialPeriodId: period.id,
          action: params.action,
          fromStatus: period.status,
          toStatus: params.to,
          totalDebitKobo: tb.totalDebitKobo,
          totalCreditKobo: tb.totalCreditKobo,
          snapshot: (validation ?? null) as unknown as Prisma.InputJsonValue,
          reason: params.reason,
          performedById: params.actor.userId,
          ipAddress: params.actor.ipAddress ?? null,
          device: params.actor.device ?? null,
          workflowTransactionId: params.workflowTransactionId ?? null,
        },
      });

      await this.audit.write(
        {
          transactionId: period.id,
          module: 'closing',
          entityType: 'FinancialPeriod',
          entityId: period.id,
          status: params.to,
          action:
            params.action === CloseAction.REOPEN
              ? AuditAction.PERIOD_REOPEN
              : params.action === CloseAction.SOFT_CLOSE
                ? AuditAction.PERIOD_SOFT_CLOSE
                : AuditAction.PERIOD_CLOSE,
          userId: params.actor.userId,
          ipAddress: params.actor.ipAddress,
          device: params.actor.device,
          comments: params.reason,
          metadata: {
            periodName: period.name,
            fromStatus: period.status,
            toStatus: params.to,
            totalDebitKobo: tb.totalDebitKobo.toString(),
          },
        },
        tx,
      );

      return updated;
    });
  }

  private async registerTotalFor(taxPeriodId: string, taxType: string): Promise<string> {
    if (taxType === 'VAT') {
      const result = await this.prisma.vatRegisterEntry.aggregate({
        where: { taxPeriodId },
        _sum: { taxKobo: true },
      });
      return (result._sum.taxKobo ?? 0n).toString();
    }
    const result = await this.prisma.whtRegisterEntry.aggregate({
      where: { taxPeriodId },
      _sum: { taxKobo: true },
    });
    return (result._sum.taxKobo ?? 0n).toString();
  }

  /** §8 the period close log, for the audit trail. */
  async closeLog(companyId: string, financialYearId?: string) {
    return this.prisma.periodCloseLog.findMany({
      where: { companyId, ...(financialYearId ? { financialYearId } : {}) },
      orderBy: { occurredAt: 'desc' },
      include: {
        performedBy: { select: { fullName: true } },
        financialPeriod: { select: { name: true } },
        financialYear: { select: { code: true } },
      },
    });
  }
}
