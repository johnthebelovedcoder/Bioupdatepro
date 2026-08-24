import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  ManualJournalKind,
  ManualJournalStatus,
  Prisma,
  WorkflowStatus,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { PostingControlService } from '../posting-control/posting-control.service';
import { WorkflowActor } from '../workflow/workflow.types';
import {
  AccountingRuleViolation,
  UnbalancedJournalError,
} from '../common/errors';
import { Kobo, kobo } from '../common/money';

export interface ManualJournalLineInput {
  glAccountId: string;
  description: string;
  debit?: Kobo;
  credit?: Kobo;
  departmentId?: string | null;
  costCentreId?: string | null;
  farmId?: string | null;
  penHouseId?: string | null;
  projectId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  itemId?: string | null;
}

export interface CreateManualJournalInput {
  companyId: string;
  journalTypeCode: string;
  reasonCode?: string | null;
  reference: string;
  journalDate: Date;
  narration: string;
  branchId: string;
  financialYearId: string;
  financialPeriodId: string;
  currencyId: string;
  exchangeRate?: string;
  customerId?: string | null;
  supplierId?: string | null;
  lines: ManualJournalLineInput[];
  actor: WorkflowActor;
}

/**
 * The Accounting Adjustment Centre (§3).
 *
 * The lifecycle is: DRAFT -> submit -> [Phase 2 workflow] -> approve -> POSTED.
 * This service owns the document; it does not own the ledger. When the workflow
 * completes, the registered handler calls PostingService, which is the single
 * door into the GL for every module.
 *
 * §3's posting sequence reads "Validate → Workflow → Approval → Create GL →
 * Update Customer Ledger → Update Supplier Ledger → Update Trial Balance →
 * Update Audit Log". The last four are not steps here, and deliberately so:
 * the customer ledger, supplier ledger and trial balance are all VIEWS over
 * journal lines (see PartyLedgerService and TrialBalanceService). Maintaining
 * them as separate updates would create three more places a balance could live
 * and disagree with the accounts.
 */
@Injectable()
export class ManualJournalService {
  private readonly logger = new Logger(ManualJournalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly postingControl: PostingControlService,
  ) {}

  // -------------------------------------------------------------------------
  // Create & edit
  // -------------------------------------------------------------------------

  async create(input: CreateManualJournalInput) {
    const journalType = await this.prisma.journalType.findUnique({
      where: {
        companyId_code: { companyId: input.companyId, code: input.journalTypeCode },
      },
    });
    if (!journalType) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Journal types',
        `Journal type "${input.journalTypeCode}" is not configured.`,
        { journalTypeCode: input.journalTypeCode },
      );
    }
    if (!journalType.active) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Journal types',
        `Journal type "${journalType.code}" is inactive.`,
        { journalTypeCode: journalType.code },
      );
    }

    let reasonCodeId: string | null = null;
    if (input.reasonCode) {
      const reason = await this.prisma.reasonCode.findUnique({
        where: { companyId_code: { companyId: input.companyId, code: input.reasonCode } },
      });
      if (!reason || !reason.active) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §3 — Reason codes',
          `Reason code "${input.reasonCode}" is not configured or is inactive.`,
          { reasonCode: input.reasonCode },
        );
      }
      if (reason.journalTypeId && reason.journalTypeId !== journalType.id) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §3 — Reason codes',
          `Reason code "${reason.code}" does not apply to journal type "${journalType.code}".`,
          { reasonCode: reason.code, journalTypeCode: journalType.code },
        );
      }
      reasonCodeId = reason.id;
    } else if (journalType.requiresReasonCode) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Reason codes',
        `Journal type "${journalType.code}" requires a reason code. An adjustment with ` +
          `no stated reason is the one an auditor asks about first.`,
        { journalTypeCode: journalType.code },
      );
    }

    this.assertLinesBalance(input.lines);

    /*
     * §66.3 — a manual journal may not touch a control account.
     *
     * GRNI, payables, receivables, inventory, WIP, the recovery accounts and
     * the payroll liabilities are all `CONTROL — subledger/system only`. They
     * are the accounts a subledger reconciles against, and hand-journalling one
     * destroys the reconciliation without leaving anything to reconcile: the
     * three-way match would agree with a GRNI balance somebody had simply typed
     * to zero.
     *
     * Checked at creation rather than at posting so a journal that can never be
     * approved is refused while the person is still looking at it.
     */
    await this.postingControl.assertManualJournalAllowed({
      companyId: input.companyId,
      glAccountIds: input.lines.map((line) => line.glAccountId),
    });
    this.assertPartyConsistency(journalType.kind, input);

    return this.prisma.$transaction(async (tx) => {
      const journal = await tx.manualJournal.create({
        data: {
          companyId: input.companyId,
          journalTypeId: journalType.id,
          reasonCodeId,
          reference: input.reference,
          journalDate: input.journalDate,
          narration: input.narration,
          branchId: input.branchId,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          currencyId: input.currencyId,
          exchangeRate: new Prisma.Decimal(input.exchangeRate ?? '1.00000000'),
          customerId: input.customerId ?? null,
          supplierId: input.supplierId ?? null,
          createdById: input.actor.userId,
          lines: {
            create: input.lines.map((line, index) => ({
              lineNumber: index + 1,
              glAccountId: line.glAccountId,
              description: line.description,
              debitKobo: line.debit ?? 0n,
              creditKobo: line.credit ?? 0n,
              departmentId: line.departmentId ?? null,
              costCentreId: line.costCentreId ?? null,
              farmId: line.farmId ?? null,
              penHouseId: line.penHouseId ?? null,
              projectId: line.projectId ?? null,
              // A party-scoped header stamps its party onto every line that does
              // not name one itself, so the statement is complete without the
              // preparer repeating it on each row.
              customerId: line.customerId ?? input.customerId ?? null,
              supplierId: line.supplierId ?? input.supplierId ?? null,
              employeeId: line.employeeId ?? null,
              itemId: line.itemId ?? null,
            })),
          },
        },
        include: { lines: true },
      });

      await this.audit.write(
        {
          transactionId: journal.id,
          module: 'journals',
          entityType: 'ManualJournal',
          entityId: journal.id,
          status: journal.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          ipAddress: input.actor.ipAddress,
          device: input.actor.device,
          comments: journal.narration,
          metadata: {
            reference: journal.reference,
            journalType: journalType.code,
            lineCount: journal.lines.length,
          },
        },
        tx,
      );

      return journal;
    });
  }

  // -------------------------------------------------------------------------
  // Submit for approval
  // -------------------------------------------------------------------------

  /**
   * Hand the document to the shared workflow engine (Rule 5).
   *
   * The routing amount is the journal's total debits. That is the figure an
   * approval ladder should be calibrated against — using a net (which is always
   * zero for a balanced journal) would route every adjustment to level one
   * however large it was.
   */
  async submit(params: { manualJournalId: string; actor: WorkflowActor; comments?: string }) {
    const journal = await this.prisma.manualJournal.findUniqueOrThrow({
      where: { id: params.manualJournalId },
      include: { lines: true, journalType: true, attachments: true },
    });

    const editable: ManualJournalStatus[] = [
      ManualJournalStatus.DRAFT,
      ManualJournalStatus.RETURNED,
    ];
    if (!editable.includes(journal.status)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Journal lifecycle',
        `${journal.reference} is ${journal.status} and cannot be submitted.`,
        { reference: journal.reference, status: journal.status },
      );
    }

    if (journal.lines.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Journal lifecycle',
        `${journal.reference} has no lines.`,
        { reference: journal.reference },
      );
    }

    if (journal.journalType.requiresAttachment && journal.attachments.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Journal types',
        `Journal type "${journal.journalType.code}" requires supporting documentation, ` +
          `and none is attached to ${journal.reference}.`,
        { reference: journal.reference },
      );
    }

    const totalDebit = journal.lines.reduce((s, l) => s + l.debitKobo, 0n);
    const totalCredit = journal.lines.reduce((s, l) => s + l.creditKobo, 0n);
    if (totalDebit !== totalCredit) {
      throw new UnbalancedJournalError(totalDebit, totalCredit);
    }

    const result = await this.workflow.submit({
      companyId: journal.companyId,
      transactionType: journal.journalType.workflowTransactionType,
      module: 'journals',
      documentType: 'ManualJournal',
      documentId: journal.id,
      documentReference: journal.reference,
      amount: kobo(totalDebit),
      currencyId: journal.currencyId,
      branchId: journal.branchId,
      actor: params.actor,
      comments: params.comments ?? null,
    });

    await this.prisma.manualJournal.update({
      where: { id: journal.id },
      data: {
        status: ManualJournalStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Post (called by the workflow handler on final approval)
  // -------------------------------------------------------------------------

  /**
   * Turn an approved document into a GL posting.
   *
   * Called from inside the workflow's approval transaction, so a failure here
   * un-approves the document too. The idempotency key is the document id, which
   * makes "one approved adjustment produces one journal" true by construction
   * rather than by care (Rule 6).
   */
  async postApproved(params: {
    manualJournalId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const journal = await params.tx.manualJournal.findUniqueOrThrow({
      where: { id: params.manualJournalId },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, journalType: true },
    });

    if (journal.status === ManualJournalStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${journal.reference} is already posted.`,
        { reference: journal.reference },
      );
    }

    const dimensions = {
      companyId: journal.companyId,
      branchId: journal.branchId,
      financialYearId: journal.financialYearId,
      financialPeriodId: journal.financialPeriodId,
      currencyId: journal.currencyId,
      exchangeRate: journal.exchangeRate.toString(),
    };

    const result = await this.posting.post(
      {
        sourceModule: 'journals',
        sourceDocumentType: 'ManualJournal',
        sourceDocumentId: journal.id,
        journalNumber: journal.reference,
        journalDate: journal.journalDate,
        narration: journal.narration,
        ...dimensions,
        idempotencyKey: `manual-journal:${journal.id}`,
        actor: params.actor,
        lines: journal.lines.map((line) => ({
          glAccountId: line.glAccountId,
          description: line.description,
          debit: line.debitKobo > 0n ? kobo(line.debitKobo) : undefined,
          credit: line.creditKobo > 0n ? kobo(line.creditKobo) : undefined,
          dimensions: {
            ...dimensions,
            departmentId: line.departmentId,
            costCentreId: line.costCentreId,
            farmId: line.farmId,
            penHouseId: line.penHouseId,
            projectId: line.projectId,
            customerId: line.customerId,
            supplierId: line.supplierId,
            employeeId: line.employeeId,
            itemId: line.itemId,
          },
        })),
      },
      params.tx,
    );

    await params.tx.manualJournal.update({
      where: { id: journal.id },
      data: {
        status: ManualJournalStatus.POSTED,
        journalEntryId: result.journalEntryId,
        postedAt: new Date(),
        // An auto-reversing accrual records WHEN it should reverse. The reversal
        // itself is still raised and approved as a document — an accrual that
        // silently unwinds itself is one nobody reviews.
        scheduledReversalDate: journal.journalType.autoReverse
          ? nextPeriodStart(journal.journalDate)
          : null,
      },
    });

    this.logger.log(`Posted ${journal.reference} -> journal ${result.journalNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  // -------------------------------------------------------------------------
  // Reverse
  // -------------------------------------------------------------------------

  /**
   * Raise a mirror-image document reversing a posted one.
   *
   * The reversal is a NEW document that goes through the full approval pipeline
   * (Rule 2: corrections are always reversal or adjustment documents). It is not
   * posted here — that would let a single user undo an approved posting on their
   * own authority.
   */
  async createReversal(params: {
    manualJournalId: string;
    reference: string;
    journalDate: Date;
    reasonCode?: string | null;
    actor: WorkflowActor;
  }) {
    const original = await this.prisma.manualJournal.findUniqueOrThrow({
      where: { id: params.manualJournalId },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, journalType: true },
    });

    if (original.status !== ManualJournalStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Reversals',
        `${original.reference} is ${original.status}. Only a posted journal is reversed; ` +
          `cancel it instead if it has not been posted.`,
        { reference: original.reference, status: original.status },
      );
    }

    const existing = await this.prisma.manualJournal.findFirst({
      where: { reversalOfId: original.id },
    });
    if (existing) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Reversals',
        `${original.reference} has already been reversed by ${existing.reference}.`,
        { reference: original.reference, reversalReference: existing.reference },
      );
    }

    const period = await this.resolvePeriodFor(original.companyId, params.journalDate);

    return this.prisma.$transaction(async (tx) => {
      const reversal = await tx.manualJournal.create({
        data: {
          companyId: original.companyId,
          journalTypeId: original.journalTypeId,
          reasonCodeId: original.reasonCodeId,
          reference: params.reference,
          journalDate: params.journalDate,
          narration: `Reversal of ${original.reference}: ${original.narration}`,
          branchId: original.branchId,
          financialYearId: period.financialYearId,
          financialPeriodId: period.id,
          currencyId: original.currencyId,
          exchangeRate: original.exchangeRate,
          customerId: original.customerId,
          supplierId: original.supplierId,
          reversalOfId: original.id,
          createdById: params.actor.userId,
          lines: {
            // Debits and credits swapped. Everything else — accounts,
            // dimensions, party — carries over, so the reversal lands on exactly
            // the same rows of every report the original touched.
            create: original.lines.map((line) => ({
              lineNumber: line.lineNumber,
              glAccountId: line.glAccountId,
              description: `Reversal: ${line.description}`,
              debitKobo: line.creditKobo,
              creditKobo: line.debitKobo,
              departmentId: line.departmentId,
              costCentreId: line.costCentreId,
              farmId: line.farmId,
              penHouseId: line.penHouseId,
              projectId: line.projectId,
              customerId: line.customerId,
              supplierId: line.supplierId,
              employeeId: line.employeeId,
              itemId: line.itemId,
            })),
          },
        },
        include: { lines: true },
      });

      await this.audit.write(
        {
          transactionId: reversal.id,
          module: 'journals',
          entityType: 'ManualJournal',
          entityId: reversal.id,
          status: reversal.status,
          action: AuditAction.REVERSE,
          userId: params.actor.userId,
          comments: `Reversal of ${original.reference} raised for approval.`,
          metadata: { reversalOf: original.reference, reference: reversal.reference },
        },
        tx,
      );

      return reversal;
    });
  }

  /** Cancel a draft. Never a delete (§3). */
  async cancel(params: { manualJournalId: string; actor: WorkflowActor; reason: string }) {
    const journal = await this.prisma.manualJournal.findUniqueOrThrow({
      where: { id: params.manualJournalId },
    });

    if (journal.status !== ManualJournalStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Journal lifecycle',
        `${journal.reference} is ${journal.status}; only a draft may be cancelled. ` +
          `A submitted journal is rejected by an approver, and a posted one is reversed.`,
        { reference: journal.reference, status: journal.status },
      );
    }
    if (journal.createdById !== params.actor.userId) {
      throw new AccountingRuleViolation(
        'Rule 4 — Maker-checker',
        `Only the user who raised ${journal.reference} may cancel it.`,
        { reference: journal.reference },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.manualJournal.update({
        where: { id: journal.id },
        data: { status: ManualJournalStatus.CANCELLED },
      });

      await this.audit.write(
        {
          transactionId: journal.id,
          module: 'journals',
          entityType: 'ManualJournal',
          entityId: journal.id,
          status: ManualJournalStatus.CANCELLED,
          action: AuditAction.CANCEL,
          userId: params.actor.userId,
          comments: params.reason,
        },
        tx,
      );

      return cancelled;
    });
  }

  /** Keep the document status in step with its workflow instance. */
  async syncFromWorkflow(manualJournalId: string): Promise<void> {
    const journal = await this.prisma.manualJournal.findUniqueOrThrow({
      where: { id: manualJournalId },
    });
    if (!journal.workflowTransactionId) return;

    const transaction = await this.prisma.workflowTransaction.findUnique({
      where: { id: journal.workflowTransactionId },
      select: { status: true },
    });
    if (!transaction) return;

    const mapped: Partial<Record<WorkflowStatus, ManualJournalStatus>> = {
      SUBMITTED: ManualJournalStatus.SUBMITTED,
      UNDER_REVIEW: ManualJournalStatus.UNDER_REVIEW,
      APPROVED: ManualJournalStatus.APPROVED,
      POSTED: ManualJournalStatus.POSTED,
      REJECTED: ManualJournalStatus.REJECTED,
      RETURNED: ManualJournalStatus.RETURNED,
      CANCELLED: ManualJournalStatus.CANCELLED,
    };

    const next = mapped[transaction.status];
    // Never walk a posted document backwards; the trigger would refuse it anyway.
    if (!next || journal.status === ManualJournalStatus.POSTED) return;

    await this.prisma.manualJournal.update({
      where: { id: journal.id },
      data: { status: next },
    });
  }

  // -------------------------------------------------------------------------
  // Register (§3)
  // -------------------------------------------------------------------------

  async register(params: {
    companyId: string;
    status?: ManualJournalStatus;
    from?: Date;
    to?: Date;
    journalTypeCode?: string;
  }) {
    const rows = await this.prisma.manualJournal.findMany({
      where: {
        companyId: params.companyId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.journalTypeCode
          ? { journalType: { code: params.journalTypeCode } }
          : {}),
        ...(params.from || params.to
          ? {
              journalDate: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ journalDate: 'desc' }, { reference: 'desc' }],
      include: {
        journalType: { select: { code: true, name: true } },
        reasonCode: { select: { code: true, name: true } },
        lines: { select: { debitKobo: true, creditKobo: true } },
        createdBy: { select: { fullName: true } },
        reversalOf: { select: { reference: true } },
        reversedBy: { select: { reference: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      journalDate: row.journalDate,
      narration: row.narration,
      status: row.status,
      journalType: row.journalType.code,
      reasonCode: row.reasonCode?.code ?? null,
      raisedBy: row.createdBy.fullName,
      totalDebitKobo: row.lines.reduce((s, l) => s + l.debitKobo, 0n).toString(),
      totalCreditKobo: row.lines.reduce((s, l) => s + l.creditKobo, 0n).toString(),
      journalEntryId: row.journalEntryId,
      reversalOf: row.reversalOf?.reference ?? null,
      reversedBy: row.reversedBy[0]?.reference ?? null,
      scheduledReversalDate: row.scheduledReversalDate,
    }));
  }

  // -------------------------------------------------------------------------

  private assertLinesBalance(lines: ManualJournalLineInput[]): void {
    if (lines.length < 2) {
      throw new AccountingRuleViolation(
        'GL: a journal needs at least two lines',
        `A journal must have at least one debit and one credit.`,
        { lineCount: lines.length },
      );
    }

    let totalDebit = 0n;
    let totalCredit = 0n;

    for (const [index, line] of lines.entries()) {
      const debit = (line.debit as bigint | undefined) ?? 0n;
      const credit = (line.credit as bigint | undefined) ?? 0n;

      if (debit < 0n || credit < 0n) {
        throw new AccountingRuleViolation(
          'GL: amounts are non-negative',
          `Line ${index + 1} carries a negative amount. A reduction is the other side ` +
            `of the entry, not a negative number.`,
          { lineNumber: index + 1 },
        );
      }
      if (debit > 0n && credit > 0n) {
        throw new AccountingRuleViolation(
          'GL: one side per line',
          `Line ${index + 1} carries both a debit and a credit.`,
          { lineNumber: index + 1 },
        );
      }
      if (debit === 0n && credit === 0n) {
        throw new AccountingRuleViolation(
          'GL: one side per line',
          `Line ${index + 1} carries neither a debit nor a credit.`,
          { lineNumber: index + 1 },
        );
      }

      totalDebit += debit;
      totalCredit += credit;
    }

    if (totalDebit !== totalCredit) {
      throw new UnbalancedJournalError(totalDebit, totalCredit);
    }
  }

  /**
   * A customer adjustment must name a customer, and a supplier adjustment a
   * supplier. Otherwise the document cannot reach the statement it exists to
   * correct, and §3's whole point — a dedicated adjustment centre — is lost.
   */
  private assertPartyConsistency(
    kind: ManualJournalKind,
    input: CreateManualJournalInput,
  ): void {
    if (kind === ManualJournalKind.CUSTOMER_ADJUSTMENT && !input.customerId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Customer adjustments',
        `A customer adjustment must name the customer it adjusts.`,
        { reference: input.reference },
      );
    }
    if (kind === ManualJournalKind.SUPPLIER_ADJUSTMENT && !input.supplierId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Supplier adjustments',
        `A supplier adjustment must name the supplier it adjusts.`,
        { reference: input.reference },
      );
    }
  }

  private async resolvePeriodFor(companyId: string, date: Date) {
    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        financialYear: { companyId },
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
    if (!period) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Financial calendar',
        `No financial period covers ${date.toISOString().slice(0, 10)}.`,
        { date: date.toISOString().slice(0, 10) },
      );
    }
    return period;
  }
}

/** The first day of the month after the given date. */
function nextPeriodStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
