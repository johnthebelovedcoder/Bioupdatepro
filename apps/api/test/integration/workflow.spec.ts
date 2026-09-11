import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  NotificationEvent,
  PrismaClient,
  WorkflowStatus,
  WorkflowStepStatus,
} from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { EscalationService } from '../../src/workflow/escalation.service';
import { GlPostingHandler } from '../../src/workflow/gl-posting.handler';
import { kobo } from '../../src/common/money';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Phase 2 — Workflow & Approval Engine (Consolidated Reference §2).
 *
 * These run against a real PostgreSQL. Maker-checker and the append-only
 * history are partly database triggers, so a suite that mocked the database
 * would prove nothing about the controls an auditor will actually test.
 */
describe('Workflow & Approval Engine (§2)', () => {
  let prisma: PrismaService;
  let workflow: WorkflowService;
  let delegations: DelegationService;
  let notifications: NotificationService;
  let escalation: EscalationService;
  let fixture: TestFixture;

  // The approval ladder used throughout: 250k / 2m / 10m / unlimited.
  const LADDER = [
    { level: 1, roleCode: 'FARM_MANAGER', name: 'Farm Manager', maxAmountKobo: 250_000_00n },
    { level: 2, roleCode: 'FINANCE_MANAGER', name: 'Finance Manager', maxAmountKobo: 2_000_000_00n },
    { level: 3, roleCode: 'FINANCE_CONTROLLER', name: 'Finance Controller', maxAmountKobo: 10_000_000_00n },
    { level: 4, roleCode: 'CFO', name: 'CFO', maxAmountKobo: null },
  ];

  interface TestUser {
    id: string;
    roles: string[];
  }
  let users: {
    maker: TestUser;
    farmManager: TestUser;
    financeManager: TestUser;
    controller: TestUser;
    md: TestUser;
    stranger: TestUser;
    admin: TestUser;
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const audit = new AuditService(prisma);
    const idempotency = new IdempotencyService(prisma);
    const periods = new PeriodService(prisma);
    const dimensions = new DimensionValidatorService(prisma);
    const posting = new PostingService(prisma, audit, idempotency, periods, dimensions);

    const routing = new WorkflowRoutingService(prisma);
    delegations = new DelegationService(prisma, audit);
    notifications = new NotificationService(prisma);
    escalation = new EscalationService(prisma, notifications, audit);
    workflow = new WorkflowService(prisma, routing, delegations, notifications, audit, [
      new GlPostingHandler(posting),
    ]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);

    users = {
      maker: await mkUser('maker@test', 'Maker', ['PRODUCTION_SUPERVISOR']),
      farmManager: await mkUser('farm@test', 'Farm Manager', ['FARM_MANAGER']),
      financeManager: await mkUser('finance@test', 'Finance Manager', ['FINANCE_MANAGER']),
      controller: await mkUser('controller@test', 'Controller', ['FINANCE_CONTROLLER']),
      md: await mkUser('md@test', 'CFO', ['CFO']),
      stranger: await mkUser('stranger@test', 'Stranger', ['WAREHOUSE_CLERK']),
      admin: await mkUser('admin@test', 'Administrator', ['ADMINISTRATOR']),
    };

    await defineWorkflow('GL_JOURNAL', true);
    await prisma.workflowEscalationRule.create({
      data: {
        companyId: fixture.companyId,
        transactionType: null,
        remindAfterHours: 24,
        notifyManagerAfterHours: 48,
        escalateAfterHours: 72,
      },
    });
  });

  async function mkUser(email: string, fullName: string, roles: string[]) {
    const user = await prisma.user.create({
      data: { email, fullName, passwordHash: 'x', roles },
    });
    return { id: user.id, roles: user.roles };
  }

  async function defineWorkflow(
    transactionType: string,
    autoPost: boolean,
    scope: Record<string, string | null> = {},
  ) {
    return prisma.workflowDefinition.create({
      data: {
        companyId: fixture.companyId,
        transactionType,
        name: `${transactionType} route`,
        autoPostOnApproval: autoPost,
        effectiveFrom: new Date('2026-01-01'),
        ...scope,
        steps: { create: LADDER },
      },
      include: { steps: true },
    });
  }

  function submitRequest(overrides: Record<string, unknown> = {}) {
    return {
      companyId: fixture.companyId,
      transactionType: 'GL_JOURNAL',
      module: 'finance',
      documentType: 'ManualJournal',
      documentId: `DOC-${Math.random().toString(36).slice(2, 10)}`,
      documentReference: 'MJ-0001',
      amount: kobo(180_000_00),
      currencyId: fixture.currencyId,
      branchId: fixture.branchId,
      actor: { userId: users.maker.id, roles: users.maker.roles },
      ...overrides,
    } as never;
  }

  function journalPayload() {
    const dims = {
      companyId: fixture.companyId,
      branchId: fixture.branchId,
      financialYearId: fixture.financialYearId,
      financialPeriodId: fixture.periodIds[0]!,
      currencyId: fixture.currencyId,
      exchangeRate: '1.00000000',
    };
    return {
      journalNumber: `JRN-WF-${Math.random().toString(36).slice(2, 8)}`,
      journalDate: '2026-01-15T00:00:00.000Z',
      narration: 'Approved manual journal',
      sourceModule: 'finance',
      sourceDocumentType: 'ManualJournal',
      ...dims,
      lines: [
        {
          glAccountId: fixture.accounts['1501']!,
          description: 'WIP',
          debit: '18000000',
          dimensions: { ...dims, costCentreId: fixture.costCentreId, farmId: fixture.farmId },
        },
        {
          glAccountId: fixture.accounts['1301']!,
          description: 'Raw materials',
          credit: '18000000',
          dimensions: { ...dims, farmId: fixture.farmId },
        },
      ],
    };
  }

  // -------------------------------------------------------------------------

  describe('routing — the approval ladder (§2 approval limits)', () => {
    it('requires one approval below the first ceiling', async () => {
      const result = await workflow.submit(submitRequest({ amount: kobo(180_000_00) }));
      const steps = await prisma.workflowTransactionStep.findMany({
        where: { transactionId: result.transactionId },
        orderBy: { level: 'asc' },
      });
      expect(steps.map((s) => s.roleCode)).toEqual(['FARM_MANAGER']);
    });

    it('requires three approvals for an amount in the controller band', async () => {
      const result = await workflow.submit(submitRequest({ amount: kobo(5_000_000_00) }));
      const steps = await prisma.workflowTransactionStep.findMany({
        where: { transactionId: result.transactionId },
        orderBy: { level: 'asc' },
      });
      expect(steps.map((s) => s.roleCode)).toEqual([
        'FARM_MANAGER',
        'FINANCE_MANAGER',
        'FINANCE_CONTROLLER',
      ]);
    });

    it('requires the whole ladder above every ceiling', async () => {
      const result = await workflow.submit(submitRequest({ amount: kobo(40_000_000_00) }));
      const steps = await prisma.workflowTransactionStep.findMany({
        where: { transactionId: result.transactionId },
        orderBy: { level: 'asc' },
      });
      expect(steps).toHaveLength(4);
      expect(steps[3]!.roleCode).toBe('CFO');
    });

    it('treats a ceiling as inclusive at the boundary', async () => {
      const result = await workflow.submit(submitRequest({ amount: kobo(250_000_00) }));
      const steps = await prisma.workflowTransactionStep.findMany({
        where: { transactionId: result.transactionId },
      });
      expect(steps).toHaveLength(1);

      const nextResult = await workflow.submit(
        submitRequest({ amount: kobo(250_000_01), documentId: 'DOC-BOUNDARY' }),
      );
      const nextSteps = await prisma.workflowTransactionStep.findMany({
        where: { transactionId: nextResult.transactionId },
      });
      expect(nextSteps).toHaveLength(2);
    });

    it('prefers the most specific matching definition', async () => {
      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId,
          transactionType: 'GL_JOURNAL',
          name: 'Branch-specific route',
          branchId: fixture.branchId,
          effectiveFrom: new Date('2026-01-01'),
          steps: {
            create: [
              { level: 1, roleCode: 'FINANCE_CONTROLLER', name: 'Controller only', maxAmountKobo: null },
            ],
          },
        },
      });

      const result = await workflow.submit(submitRequest());
      const steps = await prisma.workflowTransactionStep.findMany({
        where: { transactionId: result.transactionId },
      });
      expect(steps).toHaveLength(1);
      expect(steps[0]!.roleCode).toBe('FINANCE_CONTROLLER');
    });

    it('refuses to guess between two equally specific definitions', async () => {
      await defineWorkflow('GL_JOURNAL', false);
      await expect(workflow.submit(submitRequest())).rejects.toThrow(
        /equal specificity/i,
      );
    });

    it('refuses a transaction type with no route rather than skipping approval', async () => {
      await expect(
        workflow.submit(submitRequest({ transactionType: 'UNREGISTERED_TYPE' })),
      ).rejects.toThrow(/No active workflow definition/i);
    });

    it('ignores a definition that is not yet effective', async () => {
      await prisma.workflowDefinition.updateMany({
        where: { companyId: fixture.companyId },
        data: { effectiveFrom: new Date('2099-01-01') },
      });
      await expect(workflow.submit(submitRequest())).rejects.toThrow(
        /No active workflow definition/i,
      );
    });
  });

  // -------------------------------------------------------------------------

  describe('maker-checker (Rule 4)', () => {
    it('refuses an approval by the maker, even holding the required role', async () => {
      const selfApprover = await mkUser('self@test', 'Self', ['FARM_MANAGER']);
      const submitted = await workflow.submit(
        submitRequest({ actor: { userId: selfApprover.id, roles: selfApprover.roles } }),
      );

      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: selfApprover.id, roles: selfApprover.roles },
        }),
      ).rejects.toThrow(/cannot approve it/i);
    });

    it('refuses the maker even when they hold ADMINISTRATOR', async () => {
      const adminMaker = await mkUser('adminmaker@test', 'Admin Maker', [
        'ADMINISTRATOR',
        'FARM_MANAGER',
      ]);
      const submitted = await workflow.submit(
        submitRequest({ actor: { userId: adminMaker.id, roles: adminMaker.roles } }),
      );

      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: adminMaker.id, roles: adminMaker.roles },
        }),
      ).rejects.toThrow(/cannot approve it/i);
    });

    it('blocks a maker approval written straight to the database', async () => {
      const submitted = await workflow.submit(submitRequest());
      const step = await prisma.workflowTransactionStep.findFirstOrThrow({
        where: { transactionId: submitted.transactionId },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE workflow_transaction_steps SET acted_by_id = $1::uuid, status = 'APPROVED' WHERE id = $2::uuid`,
          users.maker.id,
          step.id,
        ),
      ).rejects.toThrow(/Maker-checker violation/i);
    });

    it('refuses an approver who lacks the required role', async () => {
      const submitted = await workflow.submit(submitRequest());
      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.stranger.id, roles: users.stranger.roles },
        }),
      ).rejects.toThrow(/may not approve/i);
    });

    it('refuses a higher approver jumping the queue', async () => {
      const submitted = await workflow.submit(submitRequest({ amount: kobo(5_000_000_00) }));
      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.controller.id, roles: users.controller.roles },
        }),
      ).rejects.toThrow(/may not approve/i);
    });

    it('keeps a maker\'s own document out of their approval queue', async () => {
      const bothHats = await mkUser('both@test', 'Both Hats', ['FARM_MANAGER']);
      await workflow.submit(
        submitRequest({ actor: { userId: bothHats.id, roles: bothHats.roles } }),
      );
      const queue = await workflow.pendingFor(bothHats.id, fixture.companyId);
      expect(queue).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('the approval ladder in motion', () => {
    it('walks every level in order and posts at the end', async () => {
      const submitted = await workflow.submit(
        submitRequest({ amount: kobo(5_000_000_00), postingPayload: journalPayload() }),
      );

      const first = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });
      expect(first.status).toBe(WorkflowStatus.UNDER_REVIEW);
      expect(first.currentLevel).toBe(2);

      const second = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.financeManager.id, roles: users.financeManager.roles },
      });
      expect(second.currentLevel).toBe(3);

      const third = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.controller.id, roles: users.controller.roles },
      });

      expect(third.status).toBe(WorkflowStatus.POSTED);
      expect(third.currentLevel).toBeNull();
      expect(third.journalEntryId).toBeTruthy();

      const journal = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: third.journalEntryId! },
        include: { lines: true },
      });
      expect(journal.status).toBe('POSTED');
      expect(journal.lines).toHaveLength(2);
    });

    it('stops at APPROVED when the definition does not auto-post', async () => {
      await prisma.workflowDefinition.updateMany({
        where: { companyId: fixture.companyId },
        data: { autoPostOnApproval: false },
      });

      const submitted = await workflow.submit(submitRequest());
      const done = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });

      expect(done.status).toBe(WorkflowStatus.APPROVED);
      expect(done.journalEntryId).toBeFalsy();
      expect(await prisma.journalEntry.count()).toBe(0);
    });

    it('rolls the approval back when the posting fails', async () => {
      const badPayload = journalPayload();
      badPayload.lines[1]!.credit = '17999999'; // one kobo short

      const submitted = await workflow.submit(
        submitRequest({ postingPayload: badPayload }),
      );

      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        }),
      ).rejects.toThrow(/does not balance/i);

      // The document must NOT be left approved-but-unposted.
      const after = await prisma.workflowTransaction.findUniqueOrThrow({
        where: { id: submitted.transactionId },
      });
      expect(after.status).toBe(WorkflowStatus.SUBMITTED);
      expect(await prisma.journalEntry.count()).toBe(0);

      const step = await prisma.workflowTransactionStep.findFirstOrThrow({
        where: { transactionId: submitted.transactionId },
      });
      expect(step.status).toBe(WorkflowStepStatus.PENDING);
    });

    it('refuses to approve when auto-post is on but no handler is registered', async () => {
      await defineWorkflow('PAYROLL_RUN', true);
      const submitted = await workflow.submit(
        submitRequest({ transactionType: 'PAYROLL_RUN', documentId: 'PR-1' }),
      );
      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        }),
      ).rejects.toThrow(/no posting handler is registered/i);
    });

    it('refuses to act on a transaction that is already terminal', async () => {
      const submitted = await workflow.submit(
        submitRequest({ postingPayload: journalPayload() }),
      );
      await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });

      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.financeManager.id, roles: users.financeManager.roles },
        }),
      ).rejects.toThrow(/is POSTED and is not awaiting action/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('reject, return and cancel', () => {
    it('rejects terminally', async () => {
      const submitted = await workflow.submit(submitRequest());
      const rejected = await workflow.reject({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        comments: 'Wrong cost centre',
      });
      expect(rejected.status).toBe(WorkflowStatus.REJECTED);

      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        }),
      ).rejects.toThrow(/not awaiting action/i);
    });

    it('refuses to re-open a rejected transaction at the database', async () => {
      const submitted = await workflow.submit(submitRequest());
      await workflow.reject({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE workflow_transactions SET status = 'SUBMITTED' WHERE id = $1::uuid`,
          submitted.transactionId,
        ),
      ).rejects.toThrow(/cannot be re-opened/i);
    });

    it('returns to the maker and resumes the same transaction on resubmit', async () => {
      const request = submitRequest();
      const submitted = await workflow.submit(request);

      await workflow.returnToMaker({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        comments: 'Attach the invoice',
      });

      const resubmitted = await workflow.submit(request);
      expect(resubmitted.transactionId).toBe(submitted.transactionId);
      expect(resubmitted.status).toBe(WorkflowStatus.SUBMITTED);

      expect(await prisma.workflowTransaction.count()).toBe(1);
    });

    it('lets only the maker resubmit a returned document (approver cannot edit)', async () => {
      const request = submitRequest();
      const submitted = await workflow.submit(request);
      await workflow.returnToMaker({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });

      await expect(
        workflow.submit({
          ...(request as object),
          actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        } as never),
      ).rejects.toThrow(/Only that user may edit and resubmit/i);
    });

    it('lets the maker cancel before any approval', async () => {
      const submitted = await workflow.submit(submitRequest());
      const cancelled = await workflow.cancel({
        transactionId: submitted.transactionId,
        actor: { userId: users.maker.id, roles: users.maker.roles },
      });
      expect(cancelled.status).toBe(WorkflowStatus.CANCELLED);
    });

    it('refuses cancellation once a level has approved', async () => {
      const submitted = await workflow.submit(submitRequest({ amount: kobo(5_000_000_00) }));
      await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });

      await expect(
        workflow.cancel({
          transactionId: submitted.transactionId,
          actor: { userId: users.maker.id, roles: users.maker.roles },
        }),
      ).rejects.toThrow(/already been approved/i);
    });

    it('refuses cancellation by anyone but the maker', async () => {
      const submitted = await workflow.submit(submitRequest());
      await expect(
        workflow.cancel({
          transactionId: submitted.transactionId,
          actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        }),
      ).rejects.toThrow(/Only the maker/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('delegation (§2)', () => {
    const window = () => ({
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    });

    it('lets a delegate approve on the delegator\'s authority', async () => {
      await delegations.create({
        companyId: fixture.companyId,
        delegatorId: users.farmManager.id,
        delegateId: users.stranger.id,
        reason: 'Annual leave',
        ...window(),
        actor: { userId: users.admin.id, roles: users.admin.roles },
      });

      const submitted = await workflow.submit(
        submitRequest({ postingPayload: journalPayload() }),
      );
      const approved = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.stranger.id, roles: users.stranger.roles },
      });
      expect(approved.status).not.toBe(WorkflowStatus.SUBMITTED);

      const step = await prisma.workflowTransactionStep.findFirstOrThrow({
        where: { transactionId: submitted.transactionId },
      });
      expect(step.actedById).toBe(users.stranger.id);
      expect(step.actedOnBehalfOfId).toBe(users.farmManager.id);
    });

    it('still refuses the maker when they hold a delegation (Rule 4 survives)', async () => {
      await delegations.create({
        companyId: fixture.companyId,
        delegatorId: users.farmManager.id,
        delegateId: users.maker.id,
        reason: 'Cover',
        ...window(),
        actor: { userId: users.admin.id, roles: users.admin.roles },
      });

      const submitted = await workflow.submit(submitRequest());
      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.maker.id, roles: users.maker.roles },
        }),
      ).rejects.toThrow(/cannot approve it/i);
    });

    it('ignores a delegation outside its window', async () => {
      await delegations.create({
        companyId: fixture.companyId,
        delegatorId: users.farmManager.id,
        delegateId: users.stranger.id,
        reason: 'Past leave',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-02-01'),
        actor: { userId: users.admin.id, roles: users.admin.roles },
      });

      const submitted = await workflow.submit(submitRequest());
      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.stranger.id, roles: users.stranger.roles },
        }),
      ).rejects.toThrow(/may not approve/i);
    });

    it('ignores a revoked delegation', async () => {
      const delegation = await delegations.create({
        companyId: fixture.companyId,
        delegatorId: users.farmManager.id,
        delegateId: users.stranger.id,
        reason: 'Cover',
        ...window(),
        actor: { userId: users.admin.id, roles: users.admin.roles },
      });
      await delegations.revoke(delegation.id, { userId: users.admin.id, roles: users.admin.roles });

      const submitted = await workflow.submit(submitRequest());
      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.stranger.id, roles: users.stranger.roles },
        }),
      ).rejects.toThrow(/may not approve/i);
    });

    it('refuses a self-delegation', async () => {
      await expect(
        delegations.create({
          companyId: fixture.companyId,
          delegatorId: users.farmManager.id,
          delegateId: users.farmManager.id,
          reason: 'Nope',
          ...window(),
          actor: { userId: users.admin.id, roles: users.admin.roles },
        }),
      ).rejects.toThrow(/cannot delegate approval authority to themselves/i);
    });

    it('scopes a delegation to one transaction type when asked', async () => {
      await defineWorkflow('PURCHASE_ORDER', false);
      await delegations.create({
        companyId: fixture.companyId,
        delegatorId: users.farmManager.id,
        delegateId: users.stranger.id,
        transactionType: 'PURCHASE_ORDER',
        reason: 'PO cover only',
        ...window(),
        actor: { userId: users.admin.id, roles: users.admin.roles },
      });

      const journal = await workflow.submit(submitRequest());
      await expect(
        workflow.approve({
          transactionId: journal.transactionId,
          actor: { userId: users.stranger.id, roles: users.stranger.roles },
        }),
      ).rejects.toThrow(/may not approve/i);

      const po = await workflow.submit(
        submitRequest({ transactionType: 'PURCHASE_ORDER', documentId: 'PO-1' }),
      );
      const approved = await workflow.approve({
        transactionId: po.transactionId,
        actor: { userId: users.stranger.id, roles: users.stranger.roles },
      });
      expect(approved.status).toBe(WorkflowStatus.APPROVED);
    });
  });

  // -------------------------------------------------------------------------

  describe('audit trail and history (Rule 9)', () => {
    it('records every transition in both history and the audit log', async () => {
      const submitted = await workflow.submit(
        submitRequest({ amount: kobo(5_000_000_00) }),
      );
      await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });
      await workflow.returnToMaker({
        transactionId: submitted.transactionId,
        actor: { userId: users.financeManager.id, roles: users.financeManager.roles },
        comments: 'Needs support',
      });

      const history = await workflow.history(submitted.transactionId);
      expect(history.map((h) => h.action)).toEqual(['SUBMIT', 'APPROVE', 'RETURN']);

      const audit = await prisma.auditRecord.findMany({
        where: { transactionId: submitted.transactionId },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual(['SUBMIT', 'APPROVE', 'RETURN']);
    });

    it('never permits workflow history to be edited or deleted', async () => {
      const submitted = await workflow.submit(submitRequest());
      const row = await prisma.workflowHistory.findFirstOrThrow({
        where: { transactionId: submitted.transactionId },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE workflow_history SET comments = 'rewritten' WHERE id = $1::uuid`,
          row.id,
        ),
      ).rejects.toThrow(/append-only/i);

      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM workflow_history WHERE id = $1::uuid`,
          row.id,
        ),
      ).rejects.toThrow(/append-only/i);
    });

    it('names both the delegate and the delegator in history', async () => {
      await delegations.create({
        companyId: fixture.companyId,
        delegatorId: users.farmManager.id,
        delegateId: users.stranger.id,
        reason: 'Cover',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        actor: { userId: users.admin.id, roles: users.admin.roles },
      });

      const submitted = await workflow.submit(
        submitRequest({ postingPayload: journalPayload() }),
      );
      await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.stranger.id, roles: users.stranger.roles },
      });

      const history = await workflow.history(submitted.transactionId);
      const approval = history.find((h) => h.action === 'APPROVE')!;
      expect(approval.user.fullName).toBe('Stranger');
      expect(approval.onBehalfOf?.fullName).toBe('Farm Manager');
    });
  });

  // -------------------------------------------------------------------------

  describe('notifications (§2)', () => {
    it('notifies the level that must act, never the maker', async () => {
      const submitted = await workflow.submit(submitRequest());
      const queued = await prisma.workflowNotification.findMany({
        where: { transactionId: submitted.transactionId },
      });

      const recipients = new Set(queued.map((n) => n.recipientId));
      expect(recipients.has(users.farmManager.id)).toBe(true);
      expect(recipients.has(users.maker.id)).toBe(false);
      expect(queued.some((n) => n.event === NotificationEvent.SUBMISSION)).toBe(true);
    });

    it('tells the maker when their document is rejected', async () => {
      const submitted = await workflow.submit(submitRequest());
      await workflow.reject({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        comments: 'No',
      });

      const inbox = await notifications.inbox(users.maker.id);
      expect(inbox.some((n) => n.event === NotificationEvent.REJECTION)).toBe(true);
    });

    it('rolls notifications back with a failed approval', async () => {
      const badPayload = journalPayload();
      badPayload.lines[1]!.credit = '17999999';
      const submitted = await workflow.submit(
        submitRequest({ postingPayload: badPayload }),
      );

      const before = await prisma.workflowNotification.count();
      await expect(
        workflow.approve({
          transactionId: submitted.transactionId,
          actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
        }),
      ).rejects.toThrow();

      expect(await prisma.workflowNotification.count()).toBe(before);
    });
  });

  // -------------------------------------------------------------------------

  describe('escalation (§2 — 24/48/72h)', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

    async function ageTransaction(transactionId: string, hours: number) {
      await prisma.workflowTransaction.update({
        where: { id: transactionId },
        data: { levelEnteredAt: hoursAgo(hours) },
      });
    }

    it('does nothing before the reminder threshold', async () => {
      const submitted = await workflow.submit(submitRequest());
      await ageTransaction(submitted.transactionId, 12);
      const outcome = await escalation.sweep(new Date(), fixture.companyId);
      expect(outcome).toEqual({ reminded: 0, managersNotified: 0, escalated: 0 });
    });

    it('reminds the current approver after 24h', async () => {
      const submitted = await workflow.submit(submitRequest());
      await ageTransaction(submitted.transactionId, 25);

      const outcome = await escalation.sweep(new Date(), fixture.companyId);
      expect(outcome.reminded).toBe(1);

      const reminders = await prisma.workflowNotification.findMany({
        where: {
          transactionId: submitted.transactionId,
          event: NotificationEvent.REMINDER,
        },
      });
      expect(reminders.some((r) => r.recipientId === users.farmManager.id)).toBe(true);
    });

    it('notifies the next level up after 48h', async () => {
      const submitted = await workflow.submit(submitRequest({ amount: kobo(5_000_000_00) }));
      await ageTransaction(submitted.transactionId, 50);

      const outcome = await escalation.sweep(new Date(), fixture.companyId);
      expect(outcome.managersNotified).toBe(1);

      const notified = await prisma.workflowNotification.findMany({
        where: { transactionId: submitted.transactionId },
      });
      expect(notified.some((n) => n.recipientId === users.financeManager.id)).toBe(true);
    });

    it('escalates after 72h without auto-approving', async () => {
      const submitted = await workflow.submit(submitRequest({ amount: kobo(5_000_000_00) }));
      await ageTransaction(submitted.transactionId, 80);

      const outcome = await escalation.sweep(new Date(), fixture.companyId);
      expect(outcome.escalated).toBe(1);

      const after = await prisma.workflowTransaction.findUniqueOrThrow({
        where: { id: submitted.transactionId },
      });
      expect(after.escalatedAt).not.toBeNull();
      // Crucially: still awaiting a human, still at the same level.
      expect(after.status).toBe(WorkflowStatus.SUBMITTED);
      expect(after.currentLevel).toBe(1);
    });

    it('does not repeat a stage it has already run', async () => {
      const submitted = await workflow.submit(submitRequest());
      await ageTransaction(submitted.transactionId, 25);

      await escalation.sweep(new Date(), fixture.companyId);
      const second = await escalation.sweep(new Date(), fixture.companyId);
      expect(second.reminded).toBe(0);
    });

    it('resets the clock when a level is approved', async () => {
      const submitted = await workflow.submit(submitRequest({ amount: kobo(5_000_000_00) }));
      await ageTransaction(submitted.transactionId, 80);
      await escalation.sweep(new Date(), fixture.companyId);

      await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });

      const after = await prisma.workflowTransaction.findUniqueOrThrow({
        where: { id: submitted.transactionId },
      });
      expect(after.escalatedAt).toBeNull();
      expect(after.lastReminderAt).toBeNull();

      const outcome = await escalation.sweep(new Date(), fixture.companyId);
      expect(outcome).toEqual({ reminded: 0, managersNotified: 0, escalated: 0 });
    });
  });

  // -------------------------------------------------------------------------

  describe('queues and dashboard', () => {
    it('shows a document only to the level that must act on it', async () => {
      const submitted = await workflow.submit(submitRequest({ amount: kobo(5_000_000_00) }));

      expect(await workflow.pendingFor(users.farmManager.id, fixture.companyId)).toHaveLength(1);
      expect(await workflow.pendingFor(users.financeManager.id, fixture.companyId)).toHaveLength(0);

      await workflow.approve({
        transactionId: submitted.transactionId,
        actor: { userId: users.farmManager.id, roles: users.farmManager.roles },
      });

      expect(await workflow.pendingFor(users.farmManager.id, fixture.companyId)).toHaveLength(0);
      expect(await workflow.pendingFor(users.financeManager.id, fixture.companyId)).toHaveLength(1);
    });

    it('includes delegated work in the delegate\'s queue', async () => {
      await delegations.create({
        companyId: fixture.companyId,
        delegatorId: users.farmManager.id,
        delegateId: users.stranger.id,
        reason: 'Cover',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        actor: { userId: users.admin.id, roles: users.admin.roles },
      });

      await workflow.submit(submitRequest());
      expect(await workflow.pendingFor(users.stranger.id, fixture.companyId)).toHaveLength(1);
    });

    it('summarises open work for the dashboard', async () => {
      await workflow.submit(submitRequest({ amount: kobo(180_000_00) }));
      await workflow.submit(
        submitRequest({ amount: kobo(900_000_00), documentId: 'DOC-2' }),
      );

      const dashboard = await workflow.dashboard(fixture.companyId);
      expect(dashboard.open.count).toBe(2);
      const submittedRow = dashboard.byStatus.find(
        (r) => r.status === WorkflowStatus.SUBMITTED,
      );
      expect(submittedRow?.count).toBe(2);
      expect(submittedRow?.totalAmountKobo).toBe('108000000');
    });
  });
});
