import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, JournalStatus, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PeriodService } from '../periods/period.service';
import { DimensionValidatorService } from '../enterprise-dimensions/dimension-validator.service';
import {
  AccountingRuleViolation,
  PostedTransactionImmutableError,
  UnbalancedJournalError,
} from '../common/errors';
import { PostingRequest, PostingResult } from './posting.types';
import { kobo } from '../common/money';

const IDEMPOTENCY_SCOPE = 'gl.posting';

/**
 * THE POSTING SERVICE.
 *
 * Every General Ledger entry in BioAssetPro comes through here. Not most of
 * them — all of them. Procurement, Sales, Payroll, Processing and Period Close
 * build a PostingRequest and call post(); none of them touch journal tables
 * directly. That is what makes the accounting invariants provable: there is one
 * place to prove them about.
 *
 * Order of checks is deliberate — cheapest and most-likely-to-fail first, so a
 * malformed request is rejected before it costs a database round trip:
 *
 *   1. Structural   — lines exist, amounts are sane, exactly one side per line
 *   2. Balance      — debits equal credits, exactly, in integer kobo
 *   3. Idempotency  — has this exact work already been done?
 *   4. Period       — is the target period open to this user?
 *   5. Dimensions   — mandatory six present, conditionals per account config
 *   6. Reversal     — if reversing, does the target exist and is it posted?
 *   7. Write        — journal, lines, idempotency record and audit record, all
 *                     in ONE database transaction
 *
 * The deferred constraint trigger re-checks the balance at COMMIT. If the
 * service and the database ever disagree, the database wins and the transaction
 * aborts.
 */
@Injectable()
export class PostingService {
  private readonly logger = new Logger(PostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly periods: PeriodService,
    private readonly dimensions: DimensionValidatorService,
  ) {}

  /**
   * Post a journal.
   *
   * `externalTx` lets a caller that is already inside a database transaction —
   * the Workflow Engine posting on final approval, for instance — have the
   * posting commit or roll back together with its own work. Without it the
   * posting would open a second connection and, under a single-connection pool,
   * deadlock against the caller. When it is omitted this opens its own
   * transaction exactly as before.
   */
  async post(
    request: PostingRequest,
    externalTx?: Prisma.TransactionClient,
  ): Promise<PostingResult> {
    this.assertStructure(request);
    const { totalDebit, totalCredit } = this.assertBalanced(request);

    await this.periods.assertPostingAllowed(
      request.financialPeriodId,
      request.actor.roles,
      externalTx,
      request.isClosingEntry ?? false,
    );

    await this.dimensions.validate(
      request.lines.map((line, index) => ({
        lineNumber: index + 1,
        glAccountId: line.glAccountId,
        dimensions: line.dimensions,
      })),
      externalTx,
    );

    const run = async (tx: Prisma.TransactionClient): Promise<PostingResult> => {
      const reservation = await this.idempotency.reserve(
        IDEMPOTENCY_SCOPE,
        request.idempotencyKey,
        this.idempotencyPayload(request),
        tx,
      );

      if (reservation.replayed && reservation.resultRef) {
        const existing = await tx.journalEntry.findUnique({
          where: { id: reservation.resultRef },
          include: { lines: { select: { debitKobo: true, creditKobo: true } } },
        });
        if (existing) {
          this.logger.log(
            `Idempotent replay of ${request.idempotencyKey} -> ${existing.journalNumber}`,
          );
          return {
            journalEntryId: existing.id,
            journalNumber: existing.journalNumber,
            replayed: true,
            totalDebitKobo: existing.lines.reduce(
              (s, l) => s + l.debitKobo,
              0n,
            ),
            totalCreditKobo: existing.lines.reduce(
              (s, l) => s + l.creditKobo,
              0n,
            ),
          };
        }
      }

      await this.assertReversalTargetValid(request, tx);

      const entry = await tx.journalEntry.create({
        data: {
          companyId: request.companyId,
          journalNumber: request.journalNumber,
          journalDate: request.journalDate,
          narration: request.narration,
          status: JournalStatus.POSTED,
          sourceModule: request.sourceModule,
          sourceDocumentType: request.sourceDocumentType,
          sourceDocumentId: request.sourceDocumentId ?? null,
          branchId: request.branchId,
          financialYearId: request.financialYearId,
          financialPeriodId: request.financialPeriodId,
          currencyId: request.currencyId,
          exchangeRate: new Prisma.Decimal(request.exchangeRate),
          reversalOfId: request.reversalOfId ?? null,
          createdById: request.actor.userId,
          postedById: request.actor.userId,
          postedAt: new Date(),
          lines: {
            create: request.lines.map((line, index) => ({
              lineNumber: index + 1,
              glAccountId: line.glAccountId,
              description: line.description,
              debitKobo: line.debit ?? 0n,
              creditKobo: line.credit ?? 0n,
              companyId: line.dimensions.companyId,
              branchId: line.dimensions.branchId,
              financialYearId: line.dimensions.financialYearId,
              financialPeriodId: line.dimensions.financialPeriodId,
              currencyId: line.dimensions.currencyId,
              exchangeRate: new Prisma.Decimal(line.dimensions.exchangeRate),
              departmentId: line.dimensions.departmentId ?? null,
              costCentreId: line.dimensions.costCentreId ?? null,
              farmId: line.dimensions.farmId ?? null,
              penHouseId: line.dimensions.penHouseId ?? null,
              projectId: line.dimensions.projectId ?? null,
              // Business dimensions (§1.1). Nullable by nature; they are what
              // let the party ledgers be views over these very rows.
              customerId: line.dimensions.customerId ?? null,
              supplierId: line.dimensions.supplierId ?? null,
              employeeId: line.dimensions.employeeId ?? null,
              itemId: line.dimensions.itemId ?? null,
            })),
          },
        },
        select: { id: true, journalNumber: true },
      });

      await this.idempotency.commit(
        IDEMPOTENCY_SCOPE,
        request.idempotencyKey,
        this.idempotencyPayload(request),
        entry.id,
        tx,
      );

      // Same transaction as the posting. Rule 9 — if the posting survives, so
      // does its audit record, or neither does.
      await this.audit.write(
        {
          transactionId: entry.id,
          module: request.sourceModule,
          entityType: 'JournalEntry',
          entityId: entry.id,
          status: JournalStatus.POSTED,
          action: request.reversalOfId
            ? AuditAction.REVERSE
            : AuditAction.POST,
          userId: request.actor.userId,
          ipAddress: request.actor.ipAddress ?? null,
          device: request.actor.device ?? null,
          comments: request.narration,
          metadata: {
            journalNumber: entry.journalNumber,
            sourceDocumentType: request.sourceDocumentType,
            sourceDocumentId: request.sourceDocumentId ?? null,
            totalDebitKobo: totalDebit.toString(),
            totalCreditKobo: totalCredit.toString(),
            lineCount: request.lines.length,
            reversalOfId: request.reversalOfId ?? null,
            ...(request.isClosingEntry ? { isClosingEntry: true } : {}),
          },
        },
        tx,
      );

      return {
        journalEntryId: entry.id,
        journalNumber: entry.journalNumber,
        replayed: false,
        totalDebitKobo: totalDebit,
        totalCreditKobo: totalCredit,
      };
    };

    return externalTx ? run(externalTx) : this.prisma.$transaction(run);
  }

  /**
   * Reverse a posted journal by creating a mirror-image document. The original
   * is never touched (Rule 2).
   */
  async reverse(
    journalEntryId: string,
    params: {
      journalNumber: string;
      journalDate: Date;
      narration: string;
      financialYearId: string;
      financialPeriodId: string;
      idempotencyKey: string;
      actor: PostingRequest['actor'];
    },
  ): Promise<PostingResult> {
    const original = await this.prisma.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    if (!original) {
      throw new AccountingRuleViolation(
        'Rule 2 — Reversal',
        `Journal ${journalEntryId} does not exist.`,
      );
    }
    if (original.status !== JournalStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Reversal',
        `Journal ${original.journalNumber} is not posted; there is nothing to reverse.`,
      );
    }

    const alreadyReversed = await this.prisma.journalEntry.findUnique({
      where: { reversalOfId: journalEntryId },
      select: { journalNumber: true },
    });
    if (alreadyReversed) {
      throw new AccountingRuleViolation(
        'Rule 2 — Reversal',
        `Journal ${original.journalNumber} was already reversed by ${alreadyReversed.journalNumber}.`,
      );
    }

    return this.post({
      sourceModule: original.sourceModule,
      sourceDocumentType: `${original.sourceDocumentType}.REVERSAL`,
      sourceDocumentId: original.sourceDocumentId,
      journalNumber: params.journalNumber,
      journalDate: params.journalDate,
      narration: params.narration,
      companyId: original.companyId,
      branchId: original.branchId,
      financialYearId: params.financialYearId,
      financialPeriodId: params.financialPeriodId,
      currencyId: original.currencyId,
      exchangeRate: original.exchangeRate.toString(),
      reversalOfId: original.id,
      idempotencyKey: params.idempotencyKey,
      actor: params.actor,
      // Debits become credits and vice versa; dimensions carry over untouched
      // so the reversal lands on exactly the same analytical coordinates.
      lines: original.lines.map((line) => ({
        glAccountId: line.glAccountId,
        description: `Reversal: ${line.description}`,
        debit: kobo(line.creditKobo),
        credit: kobo(line.debitKobo),
        dimensions: {
          companyId: line.companyId,
          branchId: line.branchId,
          financialYearId: params.financialYearId,
          financialPeriodId: params.financialPeriodId,
          currencyId: line.currencyId,
          exchangeRate: line.exchangeRate.toString(),
          departmentId: line.departmentId,
          costCentreId: line.costCentreId,
          farmId: line.farmId,
          penHouseId: line.penHouseId,
          projectId: line.projectId,
        },
      })),
    });
  }

  // -------------------------------------------------------------------------

  private assertStructure(request: PostingRequest): void {
    if (!request.idempotencyKey) {
      throw new AccountingRuleViolation(
        'Rule 6 — Idempotency',
        'An idempotency key is required on every posting.',
      );
    }

    if (request.lines.length < 2) {
      throw new AccountingRuleViolation(
        'GL: double entry',
        `A journal needs at least two lines; received ${request.lines.length}.`,
      );
    }

    request.lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const debit = line.debit ?? 0n;
      const credit = line.credit ?? 0n;

      if (debit < 0n || credit < 0n) {
        throw new AccountingRuleViolation(
          'GL: signed amounts',
          `Line ${lineNumber} has a negative amount. Post the opposite side instead of a negative.`,
        );
      }
      if (debit === 0n && credit === 0n) {
        throw new AccountingRuleViolation(
          'GL: empty line',
          `Line ${lineNumber} has neither a debit nor a credit.`,
        );
      }
      if (debit > 0n && credit > 0n) {
        throw new AccountingRuleViolation(
          'GL: single-sided lines',
          `Line ${lineNumber} carries both a debit and a credit. Split it into two lines.`,
        );
      }

      // The header is the authority on the mandatory six. A line that disagrees
      // is a caller bug, and silently preferring one over the other would make
      // the trial balance disagree with the journal register.
      const d = line.dimensions;
      const mismatches: string[] = [];
      if (d.companyId !== request.companyId) mismatches.push('Company');
      if (d.branchId !== request.branchId) mismatches.push('Branch');
      if (d.financialYearId !== request.financialYearId)
        mismatches.push('Financial Year');
      if (d.financialPeriodId !== request.financialPeriodId)
        mismatches.push('Financial Period');
      if (d.currencyId !== request.currencyId) mismatches.push('Currency');
      if (mismatches.length > 0) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §1.1 — Enterprise Dimensions',
          `Line ${lineNumber} contradicts the journal header on: ${mismatches.join(', ')}.`,
          { lineNumber, mismatches },
        );
      }
    });
  }

  private assertBalanced(request: PostingRequest): {
    totalDebit: bigint;
    totalCredit: bigint;
  } {
    let totalDebit = 0n;
    let totalCredit = 0n;
    for (const line of request.lines) {
      totalDebit += line.debit ?? 0n;
      totalCredit += line.credit ?? 0n;
    }
    // Exact integer equality. No epsilon — the workbooks use ABS(x) < 0.01
    // because Excel computes in floats. We compute in integer kobo and do not
    // inherit that tolerance.
    if (totalDebit !== totalCredit) {
      throw new UnbalancedJournalError(totalDebit, totalCredit);
    }
    if (totalDebit === 0n) {
      throw new AccountingRuleViolation(
        'GL: empty journal',
        'A journal with zero total value has nothing to post.',
      );
    }
    return { totalDebit, totalCredit };
  }

  private async assertReversalTargetValid(
    request: PostingRequest,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (!request.reversalOfId) return;

    const target = await tx.journalEntry.findUnique({
      where: { id: request.reversalOfId },
      select: { id: true, status: true, journalNumber: true },
    });

    if (!target) {
      throw new AccountingRuleViolation(
        'Rule 2 — Reversal',
        `Cannot reverse ${request.reversalOfId}: it does not exist.`,
      );
    }
    if (target.status !== JournalStatus.POSTED) {
      throw new PostedTransactionImmutableError(
        `Journal ${target.journalNumber} is not posted and cannot be reversed`,
      );
    }
  }

  /**
   * What the idempotency hash covers. Deliberately excludes the actor and any
   * clock reading: the same posting retried by the same caller is the same
   * work, and must not be defeated by a differing timestamp.
   */
  private idempotencyPayload(request: PostingRequest) {
    return {
      sourceModule: request.sourceModule,
      sourceDocumentType: request.sourceDocumentType,
      sourceDocumentId: request.sourceDocumentId ?? null,
      journalNumber: request.journalNumber,
      journalDate: request.journalDate.toISOString().slice(0, 10),
      companyId: request.companyId,
      financialPeriodId: request.financialPeriodId,
      reversalOfId: request.reversalOfId ?? null,
      lines: request.lines.map((l) => ({
        glAccountId: l.glAccountId,
        debit: (l.debit ?? 0n).toString(),
        credit: (l.credit ?? 0n).toString(),
        costCentreId: l.dimensions.costCentreId ?? null,
        farmId: l.dimensions.farmId ?? null,
        departmentId: l.dimensions.departmentId ?? null,
        projectId: l.dimensions.projectId ?? null,
        penHouseId: l.dimensions.penHouseId ?? null,
      })),
    };
  }
}
