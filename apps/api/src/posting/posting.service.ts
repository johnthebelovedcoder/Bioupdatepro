import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, JournalStatus, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { nextReference, siteOf } from '../numbering/numbering';
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
import { resolveApprovedMappedAccount } from '../posting-control/approved-account-map';
import { chartVersionOf } from '../chart/chart';

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
    if (request.actor.roles.includes('ADMINISTRATOR')) {
      throw new AccountingRuleViolation(
        'Accounting access policy — administrator posting',
        'Administrators may manage configuration but cannot post accounting entries.',
        {},
      );
    }
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: request.companyId },
      select: { baseCurrencyId: true, baseCurrency: { select: { code: true } } },
    });
    this.assertStructure(request);
    if (!request.approvedControl && await chartVersionOf(externalTx ?? this.prisma, request.companyId) === 'APPROVED') {
      const unboundApprovedChartEvents: Record<string, string> = {
        PayrollRun: 'Statutory payroll accrual needs Finance-approved liability mappings and a dedicated event contract.',
        PayrollPayment: 'Payroll settlement needs a Finance-approved payable and bank settlement contract.',
        REARING_COST_RELIEF: 'Cohort rearing-cost relief needs an approved mortality/disposal/harvest expense treatment and event contract.',
      };
      const reason = unboundApprovedChartEvents[request.sourceDocumentType];
      if (reason) {
        throw new AccountingRuleViolation(
          'Approved Posting Control — event contract required',
          reason,
          { sourceDocumentType: request.sourceDocumentType, sourceDocumentId: request.sourceDocumentId ?? null },
        );
      }
    }
    if (request.approvedControl) await this.assertApprovedControlContract(request, externalTx ?? this.prisma);
    if (company.baseCurrency.code !== 'NGN' || request.currencyId !== company.baseCurrencyId || !new Prisma.Decimal(request.exchangeRate).equals(1)) {
      throw new AccountingRuleViolation(
        'Pilot currency policy — NGN only',
        'The pilot accepts NGN transactions only, posted at the NGN base rate. Foreign-currency support is reserved for a later phase.',
        { baseCurrency: company.baseCurrency.code, transactionCurrencyId: request.currencyId },
      );
    }
    const { totalDebit, totalCredit } = this.assertBalanced(request);

    await this.periods.assertPostingAllowed(
      request.financialPeriodId,
      request.actor.roles,
      externalTx,
      request.isClosingEntry ?? false,
      request.sourceModule,
    );

    if (request.sourceModule !== 'feed-mill-costing') {
      const sourceAccountIds = [...new Set(request.lines.map((line) => line.glAccountId))];
      const run = await this.prisma.feedMillActualCostRun.findUnique({
        where: { companyId_financialPeriodId: { companyId: request.companyId, financialPeriodId: request.financialPeriodId } },
        select: { id: true },
      });
      const frozenPoolSource = run ? await this.prisma.feedMillActualCostAllocation.findFirst({
        where: { runId: run.id, sourceGlAccountId: { in: sourceAccountIds } },
        select: { id: true },
      }) : null;
      if (frozenPoolSource) {
        throw new AccountingRuleViolation(
          'Feed Mill actual-cost allocation — source period frozen',
          'This ledger source account is frozen into the period Feed Mill allocation. Reopen the period under CFO authority before adjusting it.',
          { financialPeriodId: request.financialPeriodId },
        );
      }
    }

    await this.dimensions.validate(
      request.lines.map((line, index) => ({
        lineNumber: index + 1,
        glAccountId: line.glAccountId,
        dimensions: line.dimensions,
        allowControlAccount: request.sourceModule !== 'journals',
        sourceDocumentId: request.sourceDocumentId,
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

      // The controlled journal-voucher reference (Numbering_Parameters), given
      // in this transaction: a journal that fails to post leaves no number
      // behind. The branch is the site — a journal's header has no farm.
      const voucherNumber = await nextReference(tx, {
        companyId: request.companyId,
        type: 'JV',
        site: await siteOf(tx, { branchId: request.branchId }),
        date: request.journalDate,
      });

      const entry = await tx.journalEntry.create({
        data: {
          companyId: request.companyId,
          journalNumber: voucherNumber,
          voucherNumber,
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
              speciesKey: line.dimensions.speciesKey ?? null,
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

  /** Enforce the workbook account/side and required cost-centre contract for a bound event. */
  private async assertApprovedControlContract(
    request: PostingRequest,
    client: Pick<Prisma.TransactionClient, 'approvedPostingControlLine' | 'approvedPostingMap' | 'postingGroupAssignment' | 'gLAccount'>,
  ): Promise<void> {
    const contract = request.approvedControl!;
    if (!request.sourceDocumentType.trim() || !request.sourceDocumentId?.trim()) {
      throw new AccountingRuleViolation('Approved Posting Control — source document', 'A workbook-controlled posting must identify its originating source document.', contract);
    }
    const applicationRuleIds = [contract.applicationRuleId, ...(contract.additionalApplicationRuleIds ?? [])];
    const controls = await client.approvedPostingControlLine.findMany({
      where: { companyId: request.companyId, application: contract.application, applicationRuleId: { in: applicationRuleIds } },
      orderBy: { lineNumber: 'asc' },
    });
    if (controls.length === 0) {
      throw new AccountingRuleViolation(
        'Approved Posting Control — event contract',
        `No workbook control lines exist for ${contract.application} / ${applicationRuleIds.join(', ')}; this event cannot post under an unverified contract.`,
        contract,
      );
    }
    const postingControls = controls.filter((line) => line.side === 'Debit' || line.side === 'Credit');
    if (postingControls.length === 0) {
      throw new AccountingRuleViolation('Approved Posting Control — no-journal event', `${applicationRuleIds.join(', ')} contains only no-journal events and must not create a GL journal.`, contract);
    }
    const expected = new Set<string>();
    const requiredCostCentrePairs = new Set<string>();
    const expectedAmounts = new Map<string, bigint>();
    const actualAmounts = new Map<string, bigint>();
    const missingExpectedAmounts: string[] = [];
    for (const line of postingControls) {
      const side = contract.reversedApplicationRuleIds?.includes(line.applicationRuleId)
        ? line.side === 'Debit' ? 'Credit' : 'Debit'
        : line.side;
      const dynamicAccountIds = contract.dynamicAccountIds?.[`${line.applicationRuleId}:${line.postingKey}`]
        ?? contract.dynamicAccountIds?.[line.postingKey];
      if (line.resolvedGl === 'ORIGINAL DOC' || line.postingKey === 'SOURCE_COST_REVERSAL' || dynamicAccountIds) {
        const sourceAccountIds = dynamicAccountIds ?? [];
        if (sourceAccountIds.length === 0) {
          throw new AccountingRuleViolation('Approved Posting Control — source-document account', `${line.applicationRuleId} requires the original document's account; no source accounts were supplied.`, { postingKey: line.postingKey });
        }
        const sourceAccounts = await client.gLAccount.findMany({ where: { companyId: request.companyId, id: { in: sourceAccountIds }, active: true, OR: [{ isPostingAccount: true }, { isControlAccount: true }] }, select: { id: true } });
        const activeMaps = await client.approvedPostingMap.findMany({
          where: {
            companyId: request.companyId,
            application: contract.dynamicMappingApplications?.length
              ? { in: contract.dynamicMappingApplications }
              : contract.application,
            status: 'Active',
            effectiveFrom: { lte: request.journalDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: request.journalDate } }],
            glAccountId: { in: sourceAccounts.map((account) => account.id) },
          },
          select: { glAccountId: true },
        });
        const allowedSourceIds = new Set(activeMaps.map((map) => map.glAccountId));
        if (allowedSourceIds.size !== new Set(sourceAccountIds).size) {
          throw new AccountingRuleViolation('Approved Posting Control — source-document account', `${line.applicationRuleId} includes an inactive or unmapped original account.`, { postingKey: line.postingKey, sourceAccountIds });
        }
        const dynamicAmount = contract.expectedLineAmountsKobo?.[`${line.applicationRuleId}:${line.lineNumber}`];
        if (contract.expectedLineAmountsKobo && dynamicAmount === undefined) {
          missingExpectedAmounts.push(`${line.applicationRuleId}:${line.lineNumber}`);
        } else if (dynamicAmount !== undefined) {
          if (allowedSourceIds.size !== 1) {
            throw new AccountingRuleViolation('Approved Posting Control — dynamic amount basis', `${line.applicationRuleId}:${line.lineNumber} has multiple source accounts, so its amount must be split by account before validation.`, { postingKey: line.postingKey });
          }
          const amountKobo = BigInt(dynamicAmount);
          if (amountKobo < 0n) throw new AccountingRuleViolation('Approved Posting Control — amount basis', 'Expected workbook amounts cannot be negative.', { line: `${line.applicationRuleId}:${line.lineNumber}` });
          if (amountKobo > 0n) {
            const pair = `${side}:${[...allowedSourceIds][0]}`;
            expected.add(pair);
            if (line.costCentreRequirement.toLowerCase() === 'required') requiredCostCentrePairs.add(pair);
            expectedAmounts.set(pair, (expectedAmounts.get(pair) ?? 0n) + amountKobo);
          }
        } else {
          for (const accountId of allowedSourceIds) {
            const pair = `${side}:${accountId}`;
            expected.add(pair);
            if (line.costCentreRequirement.toLowerCase() === 'required') requiredCostCentrePairs.add(pair);
          }
        }
        continue;
      }
      const account = await resolveApprovedMappedAccount(client, {
        companyId: request.companyId,
        application: line.application,
        postingGroup: line.postingGroup,
        postingKey: line.postingKey,
        on: request.journalDate,
      });
      const amount = contract.expectedLineAmountsKobo?.[`${line.applicationRuleId}:${line.lineNumber}`];
      if (contract.expectedLineAmountsKobo && amount === undefined) {
        missingExpectedAmounts.push(`${line.applicationRuleId}:${line.lineNumber}`);
      } else if (amount !== undefined) {
        const amountKobo = BigInt(amount);
        if (amountKobo < 0n) throw new AccountingRuleViolation('Approved Posting Control — amount basis', 'Expected workbook amounts cannot be negative.', { line: `${line.applicationRuleId}:${line.lineNumber}` });
        if (amountKobo > 0n) {
          const pair = `${side}:${account.glAccountId}`;
          expected.add(pair);
          if (line.costCentreRequirement.toLowerCase() === 'required') requiredCostCentrePairs.add(pair);
          expectedAmounts.set(pair, (expectedAmounts.get(pair) ?? 0n) + amountKobo);
        }
      } else {
        const pair = `${side}:${account.glAccountId}`;
        expected.add(pair);
        if (line.costCentreRequirement.toLowerCase() === 'required') requiredCostCentrePairs.add(pair);
      }
    }
    const actual = new Set<string>();
    for (const line of request.lines) {
      const side = (line.debit ?? 0n) > 0n ? 'Debit' : 'Credit';
      const pair = `${side}:${line.glAccountId}`;
      actual.add(pair);
      actualAmounts.set(pair, (actualAmounts.get(pair) ?? 0n) + (side === 'Debit' ? line.debit ?? 0n : line.credit ?? 0n));
    }
    for (const [pair, amount] of Object.entries(contract.expectedAccountSideAmountsKobo ?? {})) {
      const separator = pair.indexOf(':');
      if (separator < 0 || !['Debit', 'Credit'].includes(pair.slice(0, separator))) {
        throw new AccountingRuleViolation('Approved Posting Control — amount basis', `Invalid expected account-side key "${pair}".`, contract);
      }
      const amountKobo = BigInt(amount);
      if (amountKobo < 0n) throw new AccountingRuleViolation('Approved Posting Control — amount basis', 'Expected workbook amounts cannot be negative.', { pair });
      expected.add(pair);
      expectedAmounts.set(pair, (expectedAmounts.get(pair) ?? 0n) + amountKobo);
    }
    const missing = [...expected].filter((entry) => !actual.has(entry));
    let unexpected = [...actual].filter((entry) => !expected.has(entry));
    if (unexpected.length && contract.additionalMappedAccountSidePairs?.length) {
      const allowedPairs = new Set(contract.additionalMappedAccountSidePairs);
      const candidates = unexpected.filter((pair) => allowedPairs.has(pair));
      const unexpectedAccountIds = [...new Set(candidates.map((entry) => entry.slice(entry.indexOf(':') + 1)))];
      const mapped = await client.approvedPostingMap.findMany({
        where: {
          companyId: request.companyId,
          application: contract.application,
          status: 'Active',
          effectiveFrom: { lte: request.journalDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: request.journalDate } }],
          glAccountId: { in: unexpectedAccountIds },
        },
        select: { glAccountId: true, glAccount: { select: { active: true, isPostingAccount: true, isControlAccount: true } } },
      });
      const validMappedAccounts = new Set(mapped.filter((row) => row.glAccount?.active && (row.glAccount.isPostingAccount || row.glAccount.isControlAccount)).map((row) => row.glAccountId));
      const approvedPairs = new Set(candidates.filter((entry) => validMappedAccounts.has(entry.slice(entry.indexOf(':') + 1))));
      unexpected = unexpected.filter((entry) => !approvedPairs.has(entry));
    }
    const amountMismatches = [...expectedAmounts].flatMap(([pair, expectedKobo]) => {
      const actualKobo = actualAmounts.get(pair) ?? 0n;
      return expectedKobo === actualKobo ? [] : [{ pair, expectedKobo: expectedKobo.toString(), actualKobo: actualKobo.toString() }];
    });
    if (missing.length || unexpected.length || amountMismatches.length || missingExpectedAmounts.length) {
      throw new AccountingRuleViolation(
        'Approved Posting Control — journal lines',
        `${applicationRuleIds.join(', ')} journal accounts, sides or amounts do not match its approved workbook event contract.`,
        { ...contract, missing, unexpected, amountMismatches, missingExpectedAmounts },
      );
    }
    const missingCostCentre = request.lines.filter((line) => {
      const side = (line.debit ?? 0n) > 0n ? 'Debit' : 'Credit';
      return requiredCostCentrePairs.has(`${side}:${line.glAccountId}`) && !line.dimensions.costCentreId;
    });
    if (missingCostCentre.length > 0) {
      throw new AccountingRuleViolation(
        'Approved Posting Control — cost centre',
        `${applicationRuleIds.join(', ')} requires a cost centre on each line covered by a Required workbook control.`,
        { ...contract, missingCostCentre: missingCostCentre.map((line) => ({ glAccountId: line.glAccountId, description: line.description })) },
      );
    }
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
      approvedControl: request.approvedControl ?? null,
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
