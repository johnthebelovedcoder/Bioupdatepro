import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ChecklistItemStatus,
  PeriodStatus,
  PrismaClient,
} from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { PeriodCloseService } from '../../src/closing/period-close.service';
import { YearEndService } from '../../src/closing/year-end.service';
import { WorkflowActor } from '../../src/workflow/workflow.types';
import { kobo } from '../../src/common/money';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Phase 11 — Period-End & Year-End Closing (§8).
 *
 * THE IDENTITY: after a year-end close, revenue and expense stand at zero, the
 * balance sheet carries forward intact, and the new year opens balanced. The
 * classic year-end error is carrying revenue forward, which makes every later
 * year's profit cumulative and stays invisible for months — so that is what
 * these tests attack hardest.
 *
 * §8's note 1 — "any validation failure rolls back completely, never partially
 * closes" — is tested by making the close fail mid-way and proving nothing
 * survived.
 */
describe('Period-End & Year-End Closing (§8)', () => {
  let prisma: PrismaService;
  let posting: PostingService;
  let trialBalance: TrialBalanceService;
  let periods: PeriodCloseService;
  let yearEnd: YearEndService;
  let workflow: WorkflowService;
  let fixture: TestFixture;

  let maker: WorkflowActor;
  let approver: WorkflowActor;
  let retainedEarningsId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const audit = new AuditService(prisma);
    const idempotency = new IdempotencyService(prisma);
    const periodService = new PeriodService(prisma);
    const dimensions = new DimensionValidatorService(prisma);
    posting = new PostingService(prisma, audit, idempotency, periodService, dimensions);
    trialBalance = new TrialBalanceService(prisma);

    const routing = new WorkflowRoutingService(prisma);
    const delegations = new DelegationService(prisma, audit);
    const notifications = new NotificationService(prisma);
    workflow = new WorkflowService(prisma, routing, delegations, notifications, audit);

    periods = new PeriodCloseService(prisma, audit, trialBalance, workflow);
    yearEnd = new YearEndService(prisma, audit, posting, trialBalance);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);

    maker = { userId: fixture.makerId, roles: ['ACCOUNTANT'] };
    const approverUser = await prisma.user.create({
      data: {
        email: 'controller@test',
        fullName: 'Finance Controller',
        passwordHash: 'x',
        roles: ['FINANCE_CONTROLLER'],
      },
    });
    approver = { userId: approverUser.id, roles: approverUser.roles };

    const retained = await prisma.gLAccount.create({
      data: {
        companyId: fixture.companyId,
        accountNumber: '3200',
        name: 'Retained Earnings',
        accountType: 'EQUITY',
        normalBalance: 'CREDIT',
      },
    });
    retainedEarningsId = retained.id;
    fixture.accounts['3200'] = retained.id;

    const expense = await prisma.gLAccount.create({
      data: {
        companyId: fixture.companyId,
        accountNumber: '5501',
        name: 'Administrative Expenses',
        accountType: 'EXPENSE',
        normalBalance: 'DEBIT',
      },
    });
    fixture.accounts['5501'] = expense.id;
  });

  // -- helpers --------------------------------------------------------------

  const dims = (periodIndex = 0) => ({
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[periodIndex]!,
    currencyId: fixture.currencyId,
    exchangeRate: '1.00000000',
  });

  /** Revenue of `revenue` and expense of `expense`, both settled to bank. */
  async function tradeInPeriod(
    periodIndex: number,
    revenue: bigint,
    expense: bigint,
    reference: string,
  ) {
    const d = dims(periodIndex);
    const date = new Date(Date.UTC(2026, periodIndex, 15));

    if (revenue > 0n) {
      await posting.post({
        sourceModule: 'test',
        sourceDocumentType: 'Trade',
        journalNumber: `REV-${reference}`,
        journalDate: date,
        narration: 'Revenue',
        ...d,
        idempotencyKey: `rev-${reference}`,
        actor: maker,
        lines: [
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Bank',
            debit: kobo(revenue),
            dimensions: d,
          },
          {
            glAccountId: fixture.accounts['4101']!,
            description: 'Revenue',
            credit: kobo(revenue),
            dimensions: d,
          },
        ],
      });
    }

    if (expense > 0n) {
      await posting.post({
        sourceModule: 'test',
        sourceDocumentType: 'Trade',
        journalNumber: `EXP-${reference}`,
        journalDate: date,
        narration: 'Expense',
        ...d,
        idempotencyKey: `exp-${reference}`,
        actor: maker,
        lines: [
          {
            glAccountId: fixture.accounts['5501']!,
            description: 'Administrative expenses',
            debit: kobo(expense),
            dimensions: d,
          },
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Bank',
            credit: kobo(expense),
            dimensions: d,
          },
        ],
      });
    }
  }

  async function closeAllPeriods() {
    for (const periodId of fixture.periodIds) {
      await prisma.financialPeriod.update({
        where: { id: periodId },
        data: { status: PeriodStatus.CLOSED },
      });
    }
  }

  async function accountBalance(
    accountNumber: string,
    financialYearId?: string,
  ): Promise<bigint> {
    const account = await prisma.gLAccount.findFirstOrThrow({
      where: { companyId: fixture.companyId, accountNumber },
    });
    const movement = await prisma.journalLine.aggregate({
      where: {
        glAccountId: account.id,
        journalEntry: { status: 'POSTED' },
        ...(financialYearId ? { financialYearId } : {}),
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (movement._sum.debitKobo ?? 0n) - (movement._sum.creditKobo ?? 0n);
  }

  // =========================================================================

  describe('period close validation (§8)', () => {
    it('closes a clean period', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 400_000_00n, 'JAN');

      const validation = await periods.validate(fixture.periodIds[0]!);
      expect(validation.canClose).toBe(true);
      expect(validation.trialBalance.balanced).toBe(true);

      const closed = await periods.close({
        financialPeriodId: fixture.periodIds[0]!,
        actor: approver,
        reason: 'January close',
      });
      expect(closed.status).toBe(PeriodStatus.CLOSED);
    });

    it('refuses to close over a document still awaiting approval', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 0n, 'JAN');

      // A document stuck mid-approval belongs to this period's results but is
      // not in them.
      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId,
          transactionType: 'MANUAL_JOURNAL',
          name: 'Journal route',
          effectiveFrom: new Date('2026-01-01'),
          steps: {
            create: [
              { level: 1, roleCode: 'FINANCE_CONTROLLER', name: 'Controller', maxAmountKobo: null },
            ],
          },
        },
      });
      await workflow.submit({
        companyId: fixture.companyId,
        transactionType: 'MANUAL_JOURNAL',
        module: 'test',
        documentType: 'Thing',
        documentId: 'doc-1',
        documentReference: 'DOC-1',
        amount: kobo(100_00),
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        actor: maker,
      });

      const validation = await periods.validate(fixture.periodIds[0]!);
      expect(validation.canClose).toBe(false);

      const finding = validation.findings.find((f) => f.code === 'NO_PENDING_APPROVALS')!;
      expect(finding.passed).toBe(false);

      await expect(
        periods.close({ financialPeriodId: fixture.periodIds[0]!, actor: approver }),
      ).rejects.toThrow(/will not close/i);
    });

    it('reports every finding, not just the first', async () => {
      const validation = await periods.validate(fixture.periodIds[0]!);
      expect(validation.findings.length).toBeGreaterThan(3);
      expect(validation.findings.map((f) => f.code)).toContain('TRIAL_BALANCE');
      expect(validation.findings.map((f) => f.code)).toContain('PAYROLL_POSTED');
    });

    it('blocks on an unposted payroll run for the period', async () => {
      await prisma.payrollRun.create({
        data: {
          companyId: fixture.companyId,
          year: 2026,
          month: 1,
          reference: 'PAY-2026-01',
          payrollDate: new Date('2026-01-31'),
          branchId: fixture.branchId,
          financialYearId: fixture.financialYearId,
          financialPeriodId: fixture.periodIds[0]!,
          currencyId: fixture.currencyId,
          createdById: fixture.makerId,
        },
      });

      const validation = await periods.validate(fixture.periodIds[0]!);
      const finding = validation.findings.find((f) => f.code === 'PAYROLL_POSTED')!;
      expect(finding.passed).toBe(false);
      expect(validation.canClose).toBe(false);
    });

    it('flags draft journals without blocking the close', async () => {
      await prisma.journalType.create({
        data: {
          companyId: fixture.companyId,
          code: 'GJ',
          name: 'General Journal',
          requiresReasonCode: false,
        },
      });
      const journalType = await prisma.journalType.findFirstOrThrow({
        where: { companyId: fixture.companyId },
      });
      await prisma.manualJournal.create({
        data: {
          companyId: fixture.companyId,
          journalTypeId: journalType.id,
          reference: 'MJ-DRAFT',
          journalDate: new Date('2026-01-15'),
          narration: 'Unfinished',
          branchId: fixture.branchId,
          financialYearId: fixture.financialYearId,
          financialPeriodId: fixture.periodIds[0]!,
          currencyId: fixture.currencyId,
          exchangeRate: '1.00000000',
          createdById: fixture.makerId,
        },
      });

      const validation = await periods.validate(fixture.periodIds[0]!);
      const finding = validation.findings.find((f) => f.code === 'NO_DRAFT_JOURNALS')!;
      expect(finding.passed).toBe(false);
      expect(finding.blocking).toBe(false);
      // A draft is somebody's unfinished work, not a stranded transaction.
      expect(validation.canClose).toBe(true);
    });
  });

  describe('the close checklist (§8)', () => {
    async function seedChecklist() {
      await prisma.periodCloseChecklistTemplate.createMany({
        data: [
          {
            companyId: fixture.companyId,
            code: 'BANK-REC',
            name: 'Bank reconciliation complete',
            sequence: 1,
            blocking: true,
          },
          {
            companyId: fixture.companyId,
            code: 'STOCK-COUNT',
            name: 'Stock count reconciled',
            sequence: 2,
            blocking: false,
          },
        ],
      });
    }

    it('blocks a close until every blocking step is settled', async () => {
      await seedChecklist();
      await periods.prepareChecklist(fixture.periodIds[0]!);

      let validation = await periods.validate(fixture.periodIds[0]!);
      expect(validation.canClose).toBe(false);

      const items = await periods.checklist(fixture.periodIds[0]!);
      const banking = items.find((i) => i.template.code === 'BANK-REC')!;
      await periods.settleChecklistItem({
        checklistId: banking.id,
        status: ChecklistItemStatus.COMPLETE,
        actorId: fixture.makerId,
      });

      validation = await periods.validate(fixture.periodIds[0]!);
      // The non-blocking stock count is still pending and does not stop us.
      expect(validation.canClose).toBe(true);
    });

    it('requires a reason to waive a step', async () => {
      await seedChecklist();
      await periods.prepareChecklist(fixture.periodIds[0]!);
      const items = await periods.checklist(fixture.periodIds[0]!);

      await expect(
        periods.settleChecklistItem({
          checklistId: items[0]!.id,
          status: ChecklistItemStatus.WAIVED,
          actorId: fixture.makerId,
        }),
      ).rejects.toThrow(/requires a reason/i);

      const waived = await periods.settleChecklistItem({
        checklistId: items[0]!.id,
        status: ChecklistItemStatus.WAIVED,
        comments: 'Bank statement not yet received; immaterial balance.',
        actorId: fixture.makerId,
      });
      expect(waived.status).toBe(ChecklistItemStatus.WAIVED);
    });

    it('refuses a waiver with no reason at the database too', async () => {
      await seedChecklist();
      await periods.prepareChecklist(fixture.periodIds[0]!);
      const items = await periods.checklist(fixture.periodIds[0]!);

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE period_close_checklists SET status = 'WAIVED' WHERE id = $1::uuid`,
          items[0]!.id,
        ),
      ).rejects.toThrow();
    });
  });

  describe('close, soft close and reopen (§8)', () => {
    it('soft closes without requiring the validations', async () => {
      const soft = await periods.softClose({
        financialPeriodId: fixture.periodIds[0]!,
        actor: approver,
        reason: 'Management review',
      });
      expect(soft.status).toBe(PeriodStatus.SOFT_CLOSED);
    });

    it('writes an append-only log entry for every transition', async () => {
      await periods.softClose({
        financialPeriodId: fixture.periodIds[0]!,
        actor: approver,
      });
      await periods.close({
        financialPeriodId: fixture.periodIds[0]!,
        actor: approver,
        reason: 'January close',
      });

      const log = await periods.closeLog(fixture.companyId);
      expect(log).toHaveLength(2);
      expect(log.map((l) => l.action)).toEqual(['CLOSE', 'SOFT_CLOSE']);

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE period_close_logs SET reason = 'rewritten' WHERE id = $1::uuid`,
          log[0]!.id,
        ),
      ).rejects.toThrow(/append-only/i);
    });

    it('captures the trial balance at the moment of close', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 400_000_00n, 'JAN');
      await periods.close({
        financialPeriodId: fixture.periodIds[0]!,
        actor: approver,
      });

      const log = await prisma.periodCloseLog.findFirstOrThrow({
        where: { action: 'CLOSE' },
      });
      // Revenue 1,000,000 + expense 400,000 both hit bank, so debits total
      // 1,400,000 across the period.
      expect(log.totalDebitKobo).toBe(log.totalCreditKobo);
      expect(log.totalDebitKobo).toBe(140_000_000n);
    });

    it('refuses to reopen without an approved request', async () => {
      await periods.close({
        financialPeriodId: fixture.periodIds[0]!,
        actor: approver,
      });

      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId,
          transactionType: 'PERIOD_REOPEN',
          name: 'Reopen route',
          effectiveFrom: new Date('2026-01-01'),
          steps: {
            create: [
              { level: 1, roleCode: 'FINANCE_CONTROLLER', name: 'Controller', maxAmountKobo: null },
            ],
          },
        },
      });

      const { request } = await periods.requestReopen({
        financialPeriodId: fixture.periodIds[0]!,
        reason: 'Late supplier invoice',
        actor: maker,
      });

      await expect(
        periods.reopen({ reopenRequestId: request.id, actor: approver }),
      ).rejects.toThrow(/has not been approved/i);

      await periods.approveReopenRequest({
        reopenRequestId: request.id,
        actor: approver,
      });
      const reopened = await periods.reopen({
        reopenRequestId: request.id,
        actor: approver,
      });
      expect(reopened.status).toBe(PeriodStatus.OPEN);
    });

    it('refuses the requester approving their own reopen (Rule 4)', async () => {
      await periods.close({
        financialPeriodId: fixture.periodIds[0]!,
        actor: approver,
      });
      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId,
          transactionType: 'PERIOD_REOPEN',
          name: 'Reopen route',
          effectiveFrom: new Date('2026-01-01'),
          steps: {
            create: [
              { level: 1, roleCode: 'FINANCE_CONTROLLER', name: 'Controller', maxAmountKobo: null },
            ],
          },
        },
      });

      const { request } = await periods.requestReopen({
        financialPeriodId: fixture.periodIds[0]!,
        reason: 'Correction needed',
        actor: maker,
      });

      await expect(
        periods.approveReopenRequest({ reopenRequestId: request.id, actor: maker }),
      ).rejects.toThrow(/cannot also approve/i);
    });

    it('requires a reason to request a reopen', async () => {
      await periods.close({
        financialPeriodId: fixture.periodIds[0]!,
        actor: approver,
      });

      await expect(
        periods.requestReopen({
          financialPeriodId: fixture.periodIds[0]!,
          reason: '   ',
          actor: maker,
        }),
      ).rejects.toThrow(/must state why/i);
    });
  });

  // =========================================================================

  describe('THE IDENTITY: year end sweeps revenue and carries the balance sheet', () => {
    it('refuses to close a year with periods still open', async () => {
      const validation = await yearEnd.validate(fixture.financialYearId);
      expect(validation.canClose).toBe(false);
      const finding = validation.findings.find((f) => f.code === 'ALL_PERIODS_CLOSED')!;
      expect(finding.passed).toBe(false);
    });

    it('sweeps revenue and expense to zero and carries assets forward', async () => {
      // Revenue ₦1,000,000, expenses ₦400,000 — a ₦600,000 profit.
      await tradeInPeriod(0, 1_000_000_00n, 400_000_00n, 'JAN');
      await closeAllPeriods();

      const result = await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      // The result reads as a positive profit.
      expect(result.retainedEarningsKobo).toBe('60000000');
      expect(result.closingJournalId).toBeTruthy();
      expect(result.openingJournalId).toBeTruthy();
      expect(result.nextYearCode).toBe('FY2027');

      // Revenue and expense stand at zero across all time.
      expect(await accountBalance('4101')).toBe(0n);
      expect(await accountBalance('5501')).toBe(0n);

      // Retained earnings holds the profit (credit balance = negative net).
      expect(await accountBalance('3200')).toBe(-60_000_000n);

      // The bank balance carried forward: 1,000,000 - 400,000 = 600,000.
      expect(await accountBalance('1101')).toBe(60_000_000n);
    });

    it('opens the new year balanced, with revenue at zero', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 400_000_00n, 'JAN');
      await closeAllPeriods();
      await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      const nextYear = await prisma.financialYear.findFirstOrThrow({
        where: { companyId: fixture.companyId, code: 'FY2027' },
      });

      const opening = await trialBalance.build({
        companyId: fixture.companyId,
        financialYearId: nextYear.id,
      });
      expect(opening.balanced).toBe(true);

      // THE classic year-end error: revenue carried forward. It must not be in
      // the opening position at all.
      const revenueRow = opening.rows.find((r) => r.accountNumber === '4101');
      expect(revenueRow).toBeUndefined();

      // The balance sheet did carry: bank ₦600,000 against retained earnings.
      const bankRow = opening.rows.find((r) => r.accountNumber === '1101')!;
      expect(bankRow.displayedBalanceKobo).toBe(60_000_000n);
      const retainedRow = opening.rows.find((r) => r.accountNumber === '3200')!;
      expect(retainedRow.displayedBalanceKobo).toBe(60_000_000n);
    });

    it('handles a loss as well as a profit', async () => {
      // Expenses exceed revenue by ₦250,000.
      await tradeInPeriod(0, 500_000_00n, 750_000_00n, 'JAN');
      await closeAllPeriods();

      const result = await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      expect(result.retainedEarningsKobo).toBe('-25000000');
      // Retained earnings carries a DEBIT balance — an accumulated loss.
      expect(await accountBalance('3200')).toBe(25_000_000n);
      expect(await accountBalance('4101')).toBe(0n);
      expect(await accountBalance('5501')).toBe(0n);
    });

    it('accumulates across two consecutive years', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 400_000_00n, 'YR1');
      await closeAllPeriods();
      await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      const nextYear = await prisma.financialYear.findFirstOrThrow({
        where: { companyId: fixture.companyId, code: 'FY2027' },
        include: { periods: { orderBy: { periodNumber: 'asc' } } },
      });

      // Trade again in the new year: ₦300,000 profit.
      const d = {
        companyId: fixture.companyId,
        branchId: fixture.branchId,
        financialYearId: nextYear.id,
        financialPeriodId: nextYear.periods[0]!.id,
        currencyId: fixture.currencyId,
        exchangeRate: '1.00000000',
      };
      await posting.post({
        sourceModule: 'test',
        sourceDocumentType: 'Trade',
        journalNumber: 'REV-YR2',
        journalDate: new Date('2027-01-15'),
        narration: 'Year two revenue',
        ...d,
        idempotencyKey: 'rev-yr2',
        actor: maker,
        lines: [
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Bank',
            debit: kobo(300_000_00),
            dimensions: d,
          },
          {
            glAccountId: fixture.accounts['4101']!,
            description: 'Revenue',
            credit: kobo(300_000_00),
            dimensions: d,
          },
        ],
      });

      // Year two's revenue is its own, not cumulative — the error this guards.
      const yearTwo = await trialBalance.build({
        companyId: fixture.companyId,
        financialYearId: nextYear.id,
      });
      const revenueRow = yearTwo.rows.find((r) => r.accountNumber === '4101')!;
      expect(revenueRow.displayedBalanceKobo).toBe(30_000_000n);

      // Retained earnings still holds only year one's result at this point.
      const retainedRow = yearTwo.rows.find((r) => r.accountNumber === '3200')!;
      expect(retainedRow.displayedBalanceKobo).toBe(60_000_000n);
    });

    it('records closing and opening balances for every account', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 400_000_00n, 'JAN');
      await closeAllPeriods();
      await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      const closing = await yearEnd.balances(fixture.financialYearId, false);
      // Bank, revenue and expense all moved this year.
      expect(closing.length).toBeGreaterThanOrEqual(3);

      const nextYear = await prisma.financialYear.findFirstOrThrow({
        where: { companyId: fixture.companyId, code: 'FY2027' },
      });
      const opening = await yearEnd.balances(nextYear.id, true);

      // Only permanent accounts open the new year.
      expect(opening.map((b) => b.accountNumber).sort()).toEqual(['1101', '3200']);
    });

    it('refuses to close the same year twice', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 0n, 'JAN');
      await closeAllPeriods();
      await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      await expect(
        yearEnd.close({ financialYearId: fixture.financialYearId, actor: approver }),
      ).rejects.toThrow(/already/i);
    });

    it('refuses to close without a retained earnings account', async () => {
      await prisma.gLAccount.delete({ where: { id: retainedEarningsId } });
      await closeAllPeriods();

      const validation = await yearEnd.validate(fixture.financialYearId);
      const finding = validation.findings.find(
        (f) => f.code === 'RETAINED_EARNINGS_ACCOUNT',
      )!;
      expect(finding.passed).toBe(false);

      await expect(
        yearEnd.close({ financialYearId: fixture.financialYearId, actor: approver }),
      ).rejects.toThrow(/will not close/i);
    });

    it('rolls back completely when the close fails part way (§8 note 1)', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 400_000_00n, 'JAN');
      await closeAllPeriods();

      // Make the OPENING posting fail by archiving the next year's target
      // period before it exists — instead, force failure by deactivating the
      // bank account, which the opening journal must post to.
      await prisma.gLAccount.update({
        where: { id: fixture.accounts['1101']! },
        data: { active: false },
      });

      await expect(
        yearEnd.close({ financialYearId: fixture.financialYearId, actor: approver }),
      ).rejects.toThrow();

      // NOTHING survived: no closing journal, no balances, no new year, and the
      // year is still open.
      const year = await prisma.financialYear.findUniqueOrThrow({
        where: { id: fixture.financialYearId },
      });
      expect(year.status).not.toBe(PeriodStatus.CLOSED);

      expect(await prisma.accountBalance.count()).toBe(0);
      expect(
        await prisma.financialYear.count({ where: { companyId: fixture.companyId } }),
      ).toBe(1);
      expect(
        await prisma.journalEntry.count({
          where: { sourceModule: 'closing' },
        }),
      ).toBe(0);
      expect(await prisma.periodCloseLog.count({ where: { action: 'YEAR_END_CLOSE' } })).toBe(0);
    });

    it('archives the closed year periods and logs the close', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 0n, 'JAN');
      await closeAllPeriods();
      await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      const periodsAfter = await prisma.financialPeriod.findMany({
        where: { financialYearId: fixture.financialYearId },
      });
      expect(periodsAfter.every((p) => p.status === PeriodStatus.ARCHIVED)).toBe(true);

      const log = await prisma.periodCloseLog.findFirstOrThrow({
        where: { action: 'YEAR_END_CLOSE' },
      });
      expect(log.totalDebitKobo).toBe(log.totalCreditKobo);

      const audit = await prisma.auditRecord.findMany({
        where: { entityType: 'FinancialYear' },
      });
      expect(audit).toHaveLength(1);
    });

    it('refuses to change an archived year, at the database', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 0n, 'JAN');
      await closeAllPeriods();
      await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      await prisma.$executeRawUnsafe(
        `UPDATE financial_years SET status = 'ARCHIVED' WHERE id = $1::uuid`,
        fixture.financialYearId,
      );

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE financial_years SET status = 'OPEN' WHERE id = $1::uuid`,
          fixture.financialYearId,
        ),
      ).rejects.toThrow(/archived and cannot change status/i);
    });

    it('refuses to overwrite a stored balance', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 0n, 'JAN');
      await closeAllPeriods();
      await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      const balance = await prisma.accountBalance.findFirstOrThrow({});
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE account_balances SET balance_kobo = 1 WHERE id = $1::uuid`,
          balance.id,
        ),
      ).rejects.toThrow(/cannot be updated/i);
    });

    it('creates the next year with the same period structure', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 0n, 'JAN');
      await closeAllPeriods();
      await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
      });

      const nextYear = await prisma.financialYear.findFirstOrThrow({
        where: { code: 'FY2027' },
        include: { periods: { orderBy: { periodNumber: 'asc' } } },
      });

      expect(nextYear.periods).toHaveLength(12);
      expect(nextYear.periods[0]!.name).toBe('January 2027');
      expect(nextYear.startDate.toISOString().slice(0, 10)).toBe('2027-01-01');
      // February 2028 is not a leap year target here; February 2027 has 28 days.
      expect(nextYear.periods[1]!.endDate.toISOString().slice(0, 10)).toBe('2027-02-28');
    });

    it('can close without rolling forward', async () => {
      await tradeInPeriod(0, 1_000_000_00n, 0n, 'JAN');
      await closeAllPeriods();

      const result = await yearEnd.close({
        financialYearId: fixture.financialYearId,
        actor: approver,
        rollForward: false,
      });

      expect(result.openingJournalId).toBeNull();
      expect(result.nextYearCode).toBeNull();
      expect(
        await prisma.financialYear.count({ where: { companyId: fixture.companyId } }),
      ).toBe(1);
      // The sweep still happened.
      expect(await accountBalance('4101')).toBe(0n);
    });
  });
});
