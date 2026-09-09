import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ManualJournalKind,
  ManualJournalStatus,
  PrismaClient,
  RecurrenceFrequency,
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
import { ManualJournalService } from '../../src/journals/manual-journal.service';
import { PostingControlService } from '../../src/posting-control/posting-control.service';
import { ManualJournalPostingHandler } from '../../src/journals/manual-journal.handler';
import { RecurringJournalService } from '../../src/journals/recurring-journal.service';
import { PartyLedgerService } from '../../src/journals/party-ledger.service';
import { PartyService } from '../../src/masters/party.service';
import { kobo } from '../../src/common/money';
import { WorkflowActor } from '../../src/workflow/workflow.types';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Phase 10 — Accounting Adjustment & Manual Journal (§3).
 *
 * The identity this phase must hold: an adjustment reaches the ledger ONLY
 * through the approval pipeline, and once there the trial balance still
 * balances and the party statement derived from journal lines agrees with the
 * accounts. A subsidiary ledger that can disagree with the GL is the classic
 * failure this design is built to make impossible.
 */
describe('Accounting Adjustment Centre (§3)', () => {
  let prisma: PrismaService;
  let journals: ManualJournalService;
  let recurring: RecurringJournalService;
  let ledgers: PartyLedgerService;
  let workflow: WorkflowService;
  let trialBalance: TrialBalanceService;
  let parties: PartyService;
  let fixture: TestFixture;

  let generalTypeId: string;
  let customerAdjTypeId: string;
  let customerId: string;
  let supplierId: string;

  let approver: WorkflowActor;
  let maker: WorkflowActor;

  const JAN = new Date('2026-01-15');

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const audit = new AuditService(prisma);
    const idempotency = new IdempotencyService(prisma);
    const periodService = new PeriodService(prisma);
    const dimensions = new DimensionValidatorService(prisma);
    const posting = new PostingService(prisma, audit, idempotency, periodService, dimensions);
    trialBalance = new TrialBalanceService(prisma);
    parties = new PartyService(prisma, audit);

    const routing = new WorkflowRoutingService(prisma);
    const delegations = new DelegationService(prisma, audit);
    const notifications = new NotificationService(prisma);
    workflow = new WorkflowService(prisma, routing, delegations, notifications, audit);

    const postingControl = new PostingControlService(prisma);
    journals = new ManualJournalService(prisma, audit, posting, workflow, postingControl);
    recurring = new RecurringJournalService(prisma, audit);
    ledgers = new PartyLedgerService(prisma);

    workflow.register(new ManualJournalPostingHandler(journals));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);

    maker = { userId: fixture.makerId, roles: ['PRODUCTION_SUPERVISOR'] };
    const approverUser = await prisma.user.create({
      data: {
        email: 'approver@test',
        fullName: 'Approver',
        passwordHash: 'x',
        roles: ['FARM_MANAGER'],
      },
    });
    approver = { userId: approverUser.id, roles: approverUser.roles };

    // A single-rung ladder that auto-posts on approval.
    await prisma.workflowDefinition.create({
      data: {
        companyId: fixture.companyId,
        transactionType: 'MANUAL_JOURNAL',
        name: 'Manual journal route',
        autoPostOnApproval: true,
        effectiveFrom: new Date('2026-01-01'),
        steps: {
          create: [
            {
              level: 1,
              roleCode: 'FARM_MANAGER',
              name: 'Farm Manager',
              maxAmountKobo: null,
            },
          ],
        },
      },
    });

    const general = await prisma.journalType.create({
      data: {
        companyId: fixture.companyId,
        code: 'GJ',
        name: 'General Journal',
        kind: ManualJournalKind.GENERAL,
        requiresReasonCode: false,
        workflowTransactionType: 'MANUAL_JOURNAL',
      },
    });
    generalTypeId = general.id;

    const customerAdj = await prisma.journalType.create({
      data: {
        companyId: fixture.companyId,
        code: 'CADJ',
        name: 'Customer Adjustment',
        kind: ManualJournalKind.CUSTOMER_ADJUSTMENT,
        requiresReasonCode: true,
        workflowTransactionType: 'MANUAL_JOURNAL',
      },
    });
    customerAdjTypeId = customerAdj.id;

    await prisma.reasonCode.create({
      data: {
        companyId: fixture.companyId,
        code: 'PRICE-ERR',
        name: 'Pricing error',
      },
    });

    const customer = await parties.createCustomer({
      companyId: fixture.companyId,
      code: 'CUS-001',
      name: 'Lagos Distributors',
      creditLimit: kobo(1_000_000_00),
      currencyId: fixture.currencyId,
      actorId: fixture.makerId,
    });
    customerId = customer.id;

    const supplier = await parties.createSupplier({
      companyId: fixture.companyId,
      code: 'SUP-001',
      name: 'Shell Supplies',
      defaultCurrencyId: fixture.currencyId,
      actorId: fixture.makerId,
    });
    supplierId = supplier.id;
  });

  const header = () => ({
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[0]!,
    currencyId: fixture.currencyId,
  });

  function twoLines(amount: bigint) {
    return [
      {
        glAccountId: fixture.accounts['1501']!,
        description: 'Work in progress',
        debit: kobo(amount),
        costCentreId: fixture.costCentreId,
        farmId: fixture.farmId,
      },
      {
        glAccountId: fixture.accounts['1301']!,
        description: 'Raw materials',
        credit: kobo(amount),
        farmId: fixture.farmId,
      },
    ];
  }

  async function makeJournal(
    overrides: Record<string, unknown> = {},
    amount = 195_500_00n,
  ) {
    return journals.create({
      ...header(),
      journalTypeCode: 'GJ',
      reference: `MJ-${Math.random().toString(36).slice(2, 8)}`,
      journalDate: JAN,
      narration: 'Reclassify materials to production',
      lines: twoLines(amount),
      actor: maker,
      ...overrides,
    } as never);
  }

  // -------------------------------------------------------------------------

  describe('the document only reaches the ledger through approval', () => {
    it('creates a draft that posts nothing', async () => {
      const journal = await makeJournal();
      expect(journal.status).toBe(ManualJournalStatus.DRAFT);
      expect(await prisma.journalEntry.count()).toBe(0);
    });

    it('posts on final approval and links both ways', async () => {
      const journal = await makeJournal();
      const submitted = await journals.submit({
        manualJournalId: journal.id,
        actor: maker,
      });

      const approved = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: approver,
      });
      expect(approved.status).toBe('POSTED');

      const posted = await prisma.manualJournal.findUniqueOrThrow({
        where: { id: journal.id },
      });
      expect(posted.status).toBe(ManualJournalStatus.POSTED);
      expect(posted.journalEntryId).toBe(approved.journalEntryId);

      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: approved.journalEntryId! },
        include: { lines: true },
      });
      expect(entry.sourceDocumentId).toBe(journal.id);
      expect(entry.lines).toHaveLength(2);

      const tb = await trialBalance.build({ companyId: fixture.companyId });
      expect(tb.balanced).toBe(true);
    });

    it('records the approver as the poster, not the maker (Rule 4)', async () => {
      const journal = await makeJournal();
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });
      const approved = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: approver,
      });

      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: approved.journalEntryId! },
      });
      expect(entry.postedById).toBe(approver.userId);
      expect(entry.postedById).not.toBe(maker.userId);
    });

    it('posts nothing when the approval is refused', async () => {
      const journal = await makeJournal();
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });

      await workflow.reject({
        transactionId: submitted.transactionId,
        actor: approver,
        comments: 'Wrong period',
      });

      expect(await prisma.journalEntry.count()).toBe(0);
      await journals.syncFromWorkflow(journal.id);
      const after = await prisma.manualJournal.findUniqueOrThrow({
        where: { id: journal.id },
      });
      expect(after.status).toBe(ManualJournalStatus.REJECTED);
    });

    it('refuses the maker approving their own adjustment', async () => {
      const selfApprover = await prisma.user.create({
        data: {
          email: 'self@test',
          fullName: 'Self',
          passwordHash: 'x',
          roles: ['FARM_MANAGER'],
        },
      });
      const journal = await makeJournal({
        actor: { userId: selfApprover.id, roles: selfApprover.roles },
      });
      const submitted = await journals.submit({
        manualJournalId: journal.id,
        actor: { userId: selfApprover.id, roles: selfApprover.roles },
      });

      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: selfApprover.id, roles: selfApprover.roles },
        }),
      ).rejects.toThrow(/cannot approve it/i);
      expect(await prisma.journalEntry.count()).toBe(0);
    });

    it('routes on total debits, not on a net of zero', async () => {
      await prisma.workflowStep.updateMany({
        where: {},
        data: { maxAmountKobo: 100_000_00n },
      });
      await prisma.workflowDefinition.updateMany({
        where: { companyId: fixture.companyId },
        data: { autoPostOnApproval: false },
      });
      await prisma.workflowStep.create({
        data: {
          definitionId: (
            await prisma.workflowDefinition.findFirstOrThrow({
              where: { companyId: fixture.companyId },
            })
          ).id,
          level: 2,
          roleCode: 'FINANCE_MANAGER',
          name: 'Finance Manager',
          maxAmountKobo: null,
        },
      });

      const journal = await makeJournal({}, 500_000_00n);
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });

      const steps = await prisma.workflowTransactionStep.findMany({
        where: { transactionId: submitted.transactionId },
      });
      // A balanced journal nets to zero; routing on that would collect one
      // signature for any amount.
      expect(steps).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------

  describe('validation at entry (§3)', () => {
    it('refuses an unbalanced journal', async () => {
      await expect(
        journals.create({
          ...header(),
          journalTypeCode: 'GJ',
          reference: 'MJ-UNBAL',
          journalDate: JAN,
          narration: 'Unbalanced',
          lines: [
            {
              glAccountId: fixture.accounts['1501']!,
              description: 'WIP',
              debit: kobo(100_00),
              costCentreId: fixture.costCentreId,
            },
            {
              glAccountId: fixture.accounts['1301']!,
              description: 'Raw',
              credit: kobo(99_00),
            },
          ],
          actor: maker,
        }),
      ).rejects.toThrow(/does not balance/i);
    });

    it('refuses a line carrying both sides', async () => {
      await expect(
        journals.create({
          ...header(),
          journalTypeCode: 'GJ',
          reference: 'MJ-BOTH',
          journalDate: JAN,
          narration: 'Both sides',
          lines: [
            {
              glAccountId: fixture.accounts['1501']!,
              description: 'WIP',
              debit: kobo(100_00),
              credit: kobo(100_00),
              costCentreId: fixture.costCentreId,
            },
            {
              glAccountId: fixture.accounts['1301']!,
              description: 'Raw',
              credit: kobo(100_00),
            },
          ],
          actor: maker,
        }),
      ).rejects.toThrow(/both a debit and a credit/i);
    });

    it('refuses a single-line journal', async () => {
      await expect(
        journals.create({
          ...header(),
          journalTypeCode: 'GJ',
          reference: 'MJ-ONE',
          journalDate: JAN,
          narration: 'One line',
          lines: [
            {
              glAccountId: fixture.accounts['1501']!,
              description: 'WIP',
              debit: kobo(100_00),
              costCentreId: fixture.costCentreId,
            },
          ],
          actor: maker,
        }),
      ).rejects.toThrow(/at least one debit and one credit/i);
    });

    it('requires a reason code where the journal type demands one', async () => {
      await expect(
        journals.create({
          ...header(),
          journalTypeCode: 'CADJ',
          reference: 'MJ-NOREASON',
          journalDate: JAN,
          narration: 'No reason',
          customerId,
          lines: twoLines(100_00n),
          actor: maker,
        }),
      ).rejects.toThrow(/requires a reason code/i);
    });

    it('requires a customer adjustment to name its customer', async () => {
      await expect(
        journals.create({
          ...header(),
          journalTypeCode: 'CADJ',
          reference: 'MJ-NOCUST',
          journalDate: JAN,
          narration: 'No customer',
          reasonCode: 'PRICE-ERR',
          lines: twoLines(100_00n),
          actor: maker,
        }),
      ).rejects.toThrow(/must name the customer/i);
    });

    it('refuses supporting-document-free submission where the type requires one', async () => {
      await prisma.journalType.update({
        where: { id: generalTypeId },
        data: { requiresAttachment: true },
      });
      const journal = await makeJournal();

      await expect(
        journals.submit({ manualJournalId: journal.id, actor: maker }),
      ).rejects.toThrow(/requires supporting documentation/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('§3: delete is disabled entirely', () => {
    it('refuses a delete at the database', async () => {
      const journal = await makeJournal();
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM manual_journals WHERE id = $1::uuid`,
          journal.id,
        ),
      ).rejects.toThrow(/cannot be deleted/i);
    });

    it('cancels a draft instead, leaving the record', async () => {
      const journal = await makeJournal();
      const cancelled = await journals.cancel({
        manualJournalId: journal.id,
        actor: maker,
        reason: 'Raised in error',
      });
      expect(cancelled.status).toBe(ManualJournalStatus.CANCELLED);
      expect(await prisma.manualJournal.count()).toBe(1);
    });

    it('refuses to cancel anything but a draft', async () => {
      const journal = await makeJournal();
      await journals.submit({ manualJournalId: journal.id, actor: maker });

      await expect(
        journals.cancel({
          manualJournalId: journal.id,
          actor: maker,
          reason: 'Changed my mind',
        }),
      ).rejects.toThrow(/only a draft may be cancelled/i);
    });

    it('refuses to edit lines once the document has left draft', async () => {
      const journal = await makeJournal();
      await journals.submit({ manualJournalId: journal.id, actor: maker });

      await expect(
        prisma.manualJournalLine.create({
          data: {
            manualJournalId: journal.id,
            lineNumber: 3,
            glAccountId: fixture.accounts['1301']!,
            description: 'Sneaky extra line',
            creditKobo: 1_00n,
          },
        }),
      ).rejects.toThrow(/lines cannot be changed/i);
    });

    it('refuses to edit a posted document, at the database', async () => {
      const journal = await makeJournal();
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE manual_journals SET narration = 'rewritten' WHERE id = $1::uuid`,
          journal.id,
        ),
      ).rejects.toThrow(/cannot be edited/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('reversal is the correction path (Rule 2)', () => {
    async function postJournal(amount = 195_500_00n) {
      const journal = await makeJournal({}, amount);
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
      return journal;
    }

    it('raises a mirror-image document for approval, not a posting', async () => {
      const original = await postJournal();

      const reversal = await journals.createReversal({
        manualJournalId: original.id,
        reference: 'MJ-REV-001',
        journalDate: new Date('2026-02-01'),
        actor: maker,
      });

      expect(reversal.status).toBe(ManualJournalStatus.DRAFT);
      expect(reversal.reversalOfId).toBe(original.id);
      // One posting so far: the original. A reversal must be approved too.
      expect(await prisma.journalEntry.count()).toBe(1);

      const lines = await prisma.manualJournalLine.findMany({
        where: { manualJournalId: reversal.id },
        orderBy: { lineNumber: 'asc' },
      });
      expect(lines[0]!.creditKobo).toBe(19_550_000n);
      expect(lines[0]!.debitKobo).toBe(0n);
      expect(lines[1]!.debitKobo).toBe(19_550_000n);
    });

    it('clears the ledger to zero once both sides are posted', async () => {
      const original = await postJournal();
      const reversal = await journals.createReversal({
        manualJournalId: original.id,
        reference: 'MJ-REV-002',
        journalDate: new Date('2026-02-01'),
        actor: maker,
      });

      const submitted = await journals.submit({
        manualJournalId: reversal.id,
        actor: maker,
      });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const tb = await trialBalance.build({ companyId: fixture.companyId });
      expect(tb.balanced).toBe(true);
      const wip = tb.rows.find((r) => r.accountNumber === '1501');
      expect(wip?.displayedBalanceKobo).toBe(0n);
    });

    it('refuses to reverse the same document twice', async () => {
      const original = await postJournal();
      await journals.createReversal({
        manualJournalId: original.id,
        reference: 'MJ-REV-003',
        journalDate: new Date('2026-02-01'),
        actor: maker,
      });

      await expect(
        journals.createReversal({
          manualJournalId: original.id,
          reference: 'MJ-REV-004',
          journalDate: new Date('2026-02-01'),
          actor: maker,
        }),
      ).rejects.toThrow(/already been reversed/i);
    });

    it('refuses to reverse an unposted document', async () => {
      const journal = await makeJournal();
      await expect(
        journals.createReversal({
          manualJournalId: journal.id,
          reference: 'MJ-REV-005',
          journalDate: JAN,
          actor: maker,
        }),
      ).rejects.toThrow(/Only a posted journal is reversed/i);
    });

    it('schedules a reversal date for an auto-reversing accrual', async () => {
      await prisma.journalType.update({
        where: { id: generalTypeId },
        data: { autoReverse: true },
      });
      const journal = await postJournal();

      const posted = await prisma.manualJournal.findUniqueOrThrow({
        where: { id: journal.id },
      });
      expect(posted.scheduledReversalDate?.toISOString().slice(0, 10)).toBe('2026-02-01');
    });
  });

  // -------------------------------------------------------------------------

  describe('party ledgers are views over the general ledger', () => {
    async function postCustomerAdjustment(amount: bigint, reference: string) {
      const journal = await journals.create({
        ...header(),
        journalTypeCode: 'CADJ',
        reasonCode: 'PRICE-ERR',
        reference,
        journalDate: JAN,
        narration: 'Pricing correction',
        customerId,
        lines: [
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Receivable',
            debit: kobo(amount),
          },
          {
            glAccountId: fixture.accounts['4101']!,
            description: 'Revenue',
            credit: kobo(amount),
          },
        ],
        actor: maker,
      });
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
      return journal;
    }

    it('stamps the header party onto every line', async () => {
      await postCustomerAdjustment(250_000_00n, 'CADJ-001');

      const lines = await prisma.journalLine.findMany({
        where: { customerId },
      });
      expect(lines).toHaveLength(2);
    });

    it('builds a statement whose closing balance matches the ledger', async () => {
      await postCustomerAdjustment(250_000_00n, 'CADJ-001');
      await postCustomerAdjustment(150_000_00n, 'CADJ-002');

      const statement = await ledgers.customerStatement({
        customerId,
        from: new Date('2026-01-01'),
        to: new Date('2026-01-31'),
      });

      expect(statement.lines).toHaveLength(4);
      // Two debits to receivable, two credits to revenue — the customer's own
      // net movement across the lines that name them.
      expect(statement.totalDebitKobo).toBe('40000000');
      expect(statement.totalCreditKobo).toBe('40000000');
      expect(statement.closingBalanceKobo).toBe('0');
    });

    it('carries an opening balance from before the statement window', async () => {
      await postCustomerAdjustment(250_000_00n, 'CADJ-001');

      const statement = await ledgers.customerStatement({
        customerId,
        from: new Date('2026-02-01'),
        to: new Date('2026-02-28'),
      });
      expect(statement.openingBalanceKobo).toBe('0');
      expect(statement.lines).toHaveLength(0);
    });

    it('feeds credit control from the customer dimension', async () => {
      // One-sided exposure: debit receivable, credit revenue WITHOUT the
      // customer stamp on the revenue line, so the customer nets to a debit.
      const journal = await journals.create({
        ...header(),
        journalTypeCode: 'GJ',
        reference: 'INV-001',
        journalDate: JAN,
        narration: 'Invoice',
        lines: [
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Receivable',
            debit: kobo(600_000_00),
            customerId,
          },
          {
            glAccountId: fixture.accounts['4101']!,
            description: 'Revenue',
            credit: kobo(600_000_00),
          },
        ],
        actor: maker,
      });
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const outstanding = await ledgers.customerOutstanding(customerId);
      expect(outstanding).toBe(60_000_000n);

      const withinLimit = await parties.creditCheck({
        customerId,
        proposedAmount: kobo(300_000_00),
      });
      expect(withinLimit.passed).toBe(true);
      expect(withinLimit.outstandingKobo).toBe('60000000');

      const overLimit = await parties.creditCheck({
        customerId,
        proposedAmount: kobo(500_000_00),
      });
      expect(overLimit.passed).toBe(false);
      expect(overLimit.reasons.join(' ')).toMatch(/Credit limit exceeded/i);
    });

    it('builds a supplier statement on the credit side', async () => {
      const journal = await journals.create({
        ...header(),
        journalTypeCode: 'GJ',
        reference: 'SADJ-001',
        journalDate: JAN,
        narration: 'Supplier accrual',
        supplierId,
        lines: [
          {
            glAccountId: fixture.accounts['1301']!,
            description: 'Inventory',
            debit: kobo(300_000_00),
          },
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Payable',
            credit: kobo(300_000_00),
          },
        ],
        actor: maker,
      });
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const statement = await ledgers.supplierStatement({
        supplierId,
        from: new Date('2026-01-01'),
        to: new Date('2026-01-31'),
      });
      expect(statement.partyType).toBe('SUPPLIER');
      expect(statement.lines).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------

  describe('recurring journals (§3)', () => {
    async function makeTemplate(overrides: Record<string, unknown> = {}) {
      return recurring.create({
        companyId: fixture.companyId,
        journalTypeCode: 'GJ',
        code: 'REC-RENT',
        name: 'Monthly rent accrual',
        narration: 'Rent accrual',
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 1,
        startDate: new Date('2026-01-01'),
        lines: [
          {
            glAccountId: fixture.accounts['5305']!,
            description: 'Rent expense',
            debitKobo: 500_000_00n,
            costCentreId: fixture.costCentreId,
          },
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Accrual',
            creditKobo: 500_000_00n,
          },
        ],
        actorId: fixture.makerId,
        ...overrides,
      } as never);
    }

    it('generates a draft, never a posting', async () => {
      await makeTemplate();
      const outcome = await recurring.generateDue({
        companyId: fixture.companyId,
        now: new Date('2026-01-05'),
        actorId: fixture.makerId,
      });

      expect(outcome.generated).toHaveLength(1);
      expect(outcome.generated[0]!.reference).toBe('REC-RENT-2026-01');

      const generated = await prisma.manualJournal.findFirstOrThrow({
        where: { reference: 'REC-RENT-2026-01' },
      });
      expect(generated.status).toBe(ManualJournalStatus.DRAFT);
      expect(await prisma.journalEntry.count()).toBe(0);
    });

    it('advances the schedule and does not regenerate', async () => {
      await makeTemplate();
      await recurring.generateDue({
        companyId: fixture.companyId,
        now: new Date('2026-01-05'),
        actorId: fixture.makerId,
      });

      const second = await recurring.generateDue({
        companyId: fixture.companyId,
        now: new Date('2026-01-20'),
        actorId: fixture.makerId,
      });
      expect(second.generated).toHaveLength(0);

      const third = await recurring.generateDue({
        companyId: fixture.companyId,
        now: new Date('2026-02-05'),
        actorId: fixture.makerId,
      });
      expect(third.generated[0]!.reference).toBe('REC-RENT-2026-02');
    });

    it('clamps a day-of-month that the target month does not have', async () => {
      await makeTemplate({ dayOfMonth: 31, startDate: new Date('2026-01-31') });
      await recurring.generateDue({
        companyId: fixture.companyId,
        now: new Date('2026-01-31'),
        actorId: fixture.makerId,
      });

      const template = await prisma.recurringJournal.findFirstOrThrow({
        where: { code: 'REC-RENT' },
      });
      // February has 28 days in 2026; the schedule must not skip the month.
      expect(template.nextRunDate.toISOString().slice(0, 10)).toBe('2026-02-28');
    });

    it('skips an unbalanced template rather than generating an unpostable draft', async () => {
      await makeTemplate();
      await prisma.recurringJournalLine.updateMany({
        where: { creditKobo: { gt: 0n } },
        data: { creditKobo: 400_000_00n },
      });

      const outcome = await recurring.generateDue({
        companyId: fixture.companyId,
        now: new Date('2026-01-05'),
        actorId: fixture.makerId,
      });
      expect(outcome.generated).toHaveLength(0);
      expect(outcome.skipped[0]!.reason).toMatch(/does not balance/i);
    });

    it('deactivates a template past its end date', async () => {
      await makeTemplate({ endDate: new Date('2026-01-15') });
      await recurring.generateDue({
        companyId: fixture.companyId,
        now: new Date('2026-01-05'),
        actorId: fixture.makerId,
      });
      await recurring.generateDue({
        companyId: fixture.companyId,
        now: new Date('2026-03-05'),
        actorId: fixture.makerId,
      });

      const template = await prisma.recurringJournal.findFirstOrThrow({
        where: { code: 'REC-RENT' },
      });
      expect(template.active).toBe(false);
    });
  });

  // -------------------------------------------------------------------------

  describe('the journal register (§3)', () => {
    it('reports totals, status and the reversal relationship', async () => {
      const journal = await makeJournal();
      const submitted = await journals.submit({ manualJournalId: journal.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      await journals.createReversal({
        manualJournalId: journal.id,
        reference: 'MJ-REV-REG',
        journalDate: new Date('2026-02-01'),
        actor: maker,
      });

      const register = await journals.register({ companyId: fixture.companyId });
      expect(register).toHaveLength(2);

      const original = register.find((r) => r.id === journal.id)!;
      expect(original.status).toBe(ManualJournalStatus.POSTED);
      expect(original.totalDebitKobo).toBe('19550000');
      expect(original.reversedBy).toBe('MJ-REV-REG');

      const reversal = register.find((r) => r.reference === 'MJ-REV-REG')!;
      expect(reversal.reversalOf).toBe(journal.reference);
    });

    it('filters by status', async () => {
      await makeJournal();
      const posted = await makeJournal();
      const submitted = await journals.submit({ manualJournalId: posted.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const drafts = await journals.register({
        companyId: fixture.companyId,
        status: ManualJournalStatus.DRAFT,
      });
      expect(drafts).toHaveLength(1);
    });
  });
});
