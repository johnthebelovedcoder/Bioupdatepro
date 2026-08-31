import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AuditAction,
  NotificationEvent,
  Prisma,
  WorkflowActionType,
  WorkflowStatus,
  WorkflowStepStatus,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation, MakerCheckerViolation } from '../common/errors';
import { WorkflowRoutingService } from './workflow-routing.service';
import { DelegationService } from './delegation.service';
import { NotificationService } from './notification.service';
import {
  ActionRequest,
  SubmitRequest,
  WORKFLOW_POSTING_HANDLERS,
  WorkflowActionResult,
  WorkflowActor,
  WorkflowPostingHandler,
} from './workflow.types';

/**
 * The one Workflow & Approval Engine (Rule 5, Consolidated Reference §2).
 *
 * Every module registers its transaction types and calls these methods. No
 * module implements approval routing, maker-checker or escalation itself.
 *
 * THE FOUR MAKER-CHECKER RULES FROM §2, AND WHERE EACH LIVES:
 *   - maker cannot approve          -> assertNotMaker(), plus a DB trigger
 *   - approver cannot edit          -> editable only in DRAFT/RETURNED, by maker
 *   - posted cannot be modified     -> DB trigger on terminal states
 *   - reversal required after post  -> PostingService.reverse(), Phase 1
 *
 * Every transition writes BOTH a WorkflowHistory row (the workflow-shaped view)
 * and an AuditRecord (the system-wide one, Rule 9), in the same database
 * transaction as the transition itself.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);
  private readonly handlers = new Map<string, WorkflowPostingHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: WorkflowRoutingService,
    private readonly delegations: DelegationService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    @Optional()
    @Inject(WORKFLOW_POSTING_HANDLERS)
    handlers?: WorkflowPostingHandler[],
  ) {
    for (const handler of handlers ?? []) this.register(handler);
  }

  /** Modules call this to attach their posting behaviour to a transaction type. */
  register(handler: WorkflowPostingHandler): void {
    this.handlers.set(handler.transactionType, handler);
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  /**
   * Put a document into approval. Resolves the route, freezes the ladder onto
   * the transaction, and notifies the first level.
   *
   * Re-submitting a document that was RETURNED resumes the same transaction
   * rather than creating a second one — the history of a returned-and-fixed
   * document must stay in one place.
   */
  async submit(request: SubmitRequest): Promise<WorkflowActionResult> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.workflowTransaction.findUnique({
        where: {
          module_documentType_documentId: {
            module: request.module,
            documentType: request.documentType,
            documentId: request.documentId,
          },
        },
      });

      if (existing && existing.status === WorkflowStatus.RETURNED) {
        return this.resubmitReturned(tx, existing.id, request, now);
      }
      if (existing) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §2 — Workflow state',
          `${request.documentReference} is already in workflow with status ${existing.status}. ` +
            `A document has one approval history, not several.`,
          { transactionId: existing.id, status: existing.status },
        );
      }

      const definition = await this.routing.resolveDefinition(request, now, tx);
      const amountKobo: bigint = request.amount;
      const required = this.routing.requiredSteps(definition.steps, amountKobo);

      const created = await tx.workflowTransaction.create({
        data: {
          companyId: request.companyId,
          transactionType: request.transactionType,
          module: request.module,
          documentType: request.documentType,
          documentId: request.documentId,
          documentReference: request.documentReference,
          amountKobo,
          currencyId: request.currencyId,
          branchId: request.branchId ?? null,
          farmId: request.farmId ?? null,
          departmentId: request.departmentId ?? null,
          costCentreId: request.costCentreId ?? null,
          definitionId: definition.id,
          status: WorkflowStatus.SUBMITTED,
          currentLevel: required[0]!.level,
          makerId: request.actor.userId,
          postingPayload: request.postingPayload ?? Prisma.DbNull,
          submittedAt: now,
          levelEnteredAt: now,
          steps: {
            create: required.map((step) => ({
              level: step.level,
              roleCode: step.roleCode,
              name: step.name,
              maxAmountKobo: step.maxAmountKobo,
            })),
          },
        },
      });

      await this.recordEvent(tx, {
        transactionId: created.id,
        action: WorkflowActionType.SUBMIT,
        fromStatus: WorkflowStatus.DRAFT,
        toStatus: WorkflowStatus.SUBMITTED,
        level: created.currentLevel,
        actor: request.actor,
        comments: request.comments,
        reference: created.documentReference,
        module: request.module,
        auditAction: AuditAction.SUBMIT,
      });

      await this.notifyLevel(tx, created.id, required[0]!.roleCode, {
        companyId: request.companyId,
        event: NotificationEvent.SUBMISSION,
        subject: `Approval required: ${request.documentReference}`,
        body:
          `${request.documentReference} was submitted and awaits level ` +
          `${required[0]!.level} (${required[0]!.name}) approval.`,
        excludeUserId: request.actor.userId,
      });

      return {
        transactionId: created.id,
        documentReference: created.documentReference,
        status: created.status,
        currentLevel: created.currentLevel,
      };
    });
  }

  private async resubmitReturned(
    tx: Prisma.TransactionClient,
    transactionId: string,
    request: SubmitRequest,
    now: Date,
  ): Promise<WorkflowActionResult> {
    const transaction = await tx.workflowTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: { steps: { orderBy: { level: 'asc' } } },
    });

    // Only the maker may fix and resubmit. An approver who could edit the
    // document would be approving their own work by another name.
    if (transaction.makerId !== request.actor.userId) {
      throw new AccountingRuleViolation(
        'Rule 4 — Maker-checker (approver cannot edit)',
        `${transaction.documentReference} was returned to its maker. Only that user ` +
          `may edit and resubmit it.`,
        { transactionId, makerId: transaction.makerId },
      );
    }

    const first = transaction.steps[0]!;
    await tx.workflowTransactionStep.updateMany({
      where: { transactionId },
      data: {
        status: WorkflowStepStatus.PENDING,
        actedById: null,
        actedAt: null,
        actedOnBehalfOfId: null,
      },
    });
    const updated = await tx.workflowTransaction.update({
      where: { id: transactionId },
      data: {
        status: WorkflowStatus.SUBMITTED,
        currentLevel: first.level,
        amountKobo: request.amount,
        postingPayload: request.postingPayload ?? Prisma.DbNull,
        submittedAt: now,
        levelEnteredAt: now,
        lastReminderAt: null,
        managerNotifiedAt: null,
        escalatedAt: null,
      },
    });

    await this.recordEvent(tx, {
      transactionId,
      action: WorkflowActionType.RESUBMIT,
      fromStatus: WorkflowStatus.RETURNED,
      toStatus: WorkflowStatus.SUBMITTED,
      level: first.level,
      actor: request.actor,
      comments: request.comments,
      reference: transaction.documentReference,
      module: transaction.module,
      auditAction: AuditAction.SUBMIT,
    });

    await this.notifyLevel(tx, transactionId, first.roleCode, {
      companyId: transaction.companyId,
      event: NotificationEvent.SUBMISSION,
      subject: `Resubmitted: ${transaction.documentReference}`,
      body: `${transaction.documentReference} was corrected and resubmitted for approval.`,
      excludeUserId: request.actor.userId,
    });

    return {
      transactionId,
      documentReference: updated.documentReference,
      status: updated.status,
      currentLevel: updated.currentLevel,
    };
  }

  // -------------------------------------------------------------------------
  // Approve
  // -------------------------------------------------------------------------

  /**
   * Approve the level currently awaiting action.
   *
   * When the last required level approves, the transaction becomes APPROVED and
   * — if its definition auto-posts — the registered handler posts it inside this
   * same database transaction. A failed posting therefore un-approves too,
   * because "approved but not posted" and "posted but not approved" are both
   * states the ledger must never be able to reach.
   */
  async approve(request: ActionRequest): Promise<WorkflowActionResult> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const transaction = await this.loadActionable(tx, request.transactionId);
      const step = await this.currentStep(tx, transaction);

      this.assertNotMaker(transaction.makerId, request.actor, transaction.documentReference);

      const authority = await this.delegations.authorityFor({
        companyId: transaction.companyId,
        transactionType: transaction.transactionType,
        roleCode: step.roleCode,
        userId: request.actor.userId,
        userRoles: request.actor.roles,
        on: now,
        tx,
      });
      if (!authority.permitted) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §2 — Approval authority',
          `${request.actor.userId} may not approve level ${step.level} of ` +
            `${transaction.documentReference}. ${authority.reason}`,
          { requiredRole: step.roleCode, level: step.level },
        );
      }

      await tx.workflowTransactionStep.update({
        where: { id: step.id },
        data: {
          status: WorkflowStepStatus.APPROVED,
          actedById: request.actor.userId,
          actedOnBehalfOfId: authority.onBehalfOfId ?? null,
          actedAt: now,
          comments: request.comments ?? null,
        },
      });

      const next = transaction.steps.find(
        (s) => s.level > step.level && s.status === WorkflowStepStatus.PENDING,
      );

      if (next) {
        const updated = await tx.workflowTransaction.update({
          where: { id: transaction.id },
          data: {
            status: WorkflowStatus.UNDER_REVIEW,
            currentLevel: next.level,
            levelEnteredAt: now,
            lastReminderAt: null,
            managerNotifiedAt: null,
            escalatedAt: null,
          },
        });

        await this.recordEvent(tx, {
          transactionId: transaction.id,
          action: WorkflowActionType.APPROVE,
          fromStatus: transaction.status,
          toStatus: WorkflowStatus.UNDER_REVIEW,
          level: step.level,
          actor: request.actor,
          onBehalfOfId: authority.onBehalfOfId,
          comments: request.comments,
          reference: transaction.documentReference,
          module: transaction.module,
          auditAction: AuditAction.APPROVE,
        });

        await this.notifyLevel(tx, transaction.id, next.roleCode, {
          companyId: transaction.companyId,
          event: NotificationEvent.APPROVAL,
          subject: `Approval required: ${transaction.documentReference}`,
          body:
            `Level ${step.level} approved ${transaction.documentReference}. ` +
            `It now awaits level ${next.level} (${next.name}).`,
          excludeUserId: request.actor.userId,
        });

        return {
          transactionId: transaction.id,
          documentReference: updated.documentReference,
          status: updated.status,
          currentLevel: updated.currentLevel,
        };
      }

      // Final level: fully approved.
      let journalEntryId: string | null = null;
      const definition = await tx.workflowDefinition.findUniqueOrThrow({
        where: { id: transaction.definitionId },
      });

      if (definition.autoPostOnApproval) {
        const handler = this.handlers.get(transaction.transactionType);
        if (!handler) {
          throw new AccountingRuleViolation(
            'Consolidated Reference §2 — Posting handler',
            `Workflow definition "${definition.name}" is configured to post on approval, but ` +
              `no posting handler is registered for transaction type ` +
              `"${transaction.transactionType}". Refusing to approve a document that ` +
              `cannot then be posted.`,
            { transactionType: transaction.transactionType },
          );
        }
        const posted = await handler.post({
          transactionId: transaction.id,
          documentReference: transaction.documentReference,
          payload: (transaction.postingPayload ?? null) as Prisma.JsonValue,
          actor: request.actor,
          tx,
        });
        // A null id means the handler did real work but produced no GL entry.
        // The document is APPROVED, not POSTED — claiming otherwise would put a
        // posting reference on a transaction that never reached the ledger.
        journalEntryId = posted.journalEntryId ?? null;
      }

      const finalStatus = journalEntryId ? WorkflowStatus.POSTED : WorkflowStatus.APPROVED;

      const updated = await tx.workflowTransaction.update({
        where: { id: transaction.id },
        data: {
          status: finalStatus,
          currentLevel: null,
          completedAt: now,
          journalEntryId,
        },
      });

      await this.recordEvent(tx, {
        transactionId: transaction.id,
        action: WorkflowActionType.APPROVE,
        fromStatus: transaction.status,
        toStatus: WorkflowStatus.APPROVED,
        level: step.level,
        actor: request.actor,
        onBehalfOfId: authority.onBehalfOfId,
        comments: request.comments,
        reference: transaction.documentReference,
        module: transaction.module,
        auditAction: AuditAction.APPROVE,
      });

      if (journalEntryId) {
        await this.recordEvent(tx, {
          transactionId: transaction.id,
          action: WorkflowActionType.POST,
          fromStatus: WorkflowStatus.APPROVED,
          toStatus: WorkflowStatus.POSTED,
          level: null,
          actor: request.actor,
          comments: `Posted as journal ${journalEntryId}`,
          reference: transaction.documentReference,
          module: transaction.module,
          auditAction: AuditAction.POST,
          metadata: { journalEntryId },
        });
      }

      await this.notifications.queue(
        {
          transactionId: transaction.id,
          recipientIds: [transaction.makerId],
          event: journalEntryId
            ? NotificationEvent.POSTING
            : NotificationEvent.APPROVAL,
          subject: `${transaction.documentReference} ${journalEntryId ? 'posted' : 'approved'}`,
          body:
            `${transaction.documentReference} completed its approval ladder` +
            (journalEntryId ? ` and was posted to the general ledger.` : `.`),
        },
        tx,
      );

      return {
        transactionId: transaction.id,
        documentReference: updated.documentReference,
        status: updated.status,
        currentLevel: null,
        journalEntryId,
      };
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Reject / Return / Cancel
  // -------------------------------------------------------------------------

  /** Terminal refusal. The document is dead; a new one must be raised. */
  async reject(request: ActionRequest): Promise<WorkflowActionResult> {
    return this.terminalAction(request, {
      action: WorkflowActionType.REJECT,
      toStatus: WorkflowStatus.REJECTED,
      auditAction: AuditAction.REJECT,
      event: NotificationEvent.REJECTION,
      requiresAuthority: true,
      verb: 'rejected',
    });
  }

  /** Send back to the maker for correction. Resumable via submit(). */
  async returnToMaker(request: ActionRequest): Promise<WorkflowActionResult> {
    return this.terminalAction(request, {
      action: WorkflowActionType.RETURN,
      toStatus: WorkflowStatus.RETURNED,
      auditAction: AuditAction.RETURN,
      event: NotificationEvent.RETURN,
      requiresAuthority: true,
      verb: 'returned for correction',
    });
  }

  /**
   * Withdraw a document. Only the maker may cancel, and only before anyone has
   * approved — once an approval exists the document has a history that a
   * unilateral withdrawal would erase.
   */
  async cancel(request: ActionRequest): Promise<WorkflowActionResult> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const transaction = await this.loadActionable(tx, request.transactionId);

      if (transaction.makerId !== request.actor.userId) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §2 — Cancellation',
          `Only the maker of ${transaction.documentReference} may cancel it.`,
          { makerId: transaction.makerId },
        );
      }
      const anyApproved = transaction.steps.some(
        (s) => s.status === WorkflowStepStatus.APPROVED,
      );
      if (anyApproved) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §2 — Cancellation',
          `${transaction.documentReference} has already been approved at least once and ` +
            `cannot be cancelled. Ask an approver to reject or return it.`,
          { transactionId: transaction.id },
        );
      }

      const updated = await tx.workflowTransaction.update({
        where: { id: transaction.id },
        data: {
          status: WorkflowStatus.CANCELLED,
          currentLevel: null,
          completedAt: now,
        },
      });

      await this.recordEvent(tx, {
        transactionId: transaction.id,
        action: WorkflowActionType.CANCEL,
        fromStatus: transaction.status,
        toStatus: WorkflowStatus.CANCELLED,
        level: transaction.currentLevel,
        actor: request.actor,
        comments: request.comments,
        reference: transaction.documentReference,
        module: transaction.module,
        auditAction: AuditAction.CANCEL,
      });

      return {
        transactionId: transaction.id,
        documentReference: updated.documentReference,
        status: updated.status,
        currentLevel: null,
      };
    });
  }

  private async terminalAction(
    request: ActionRequest,
    config: {
      action: WorkflowActionType;
      toStatus: WorkflowStatus;
      auditAction: AuditAction;
      event: NotificationEvent;
      requiresAuthority: boolean;
      verb: string;
    },
  ): Promise<WorkflowActionResult> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const transaction = await this.loadActionable(tx, request.transactionId);
      const step = await this.currentStep(tx, transaction);

      this.assertNotMaker(transaction.makerId, request.actor, transaction.documentReference);

      if (config.requiresAuthority) {
        const authority = await this.delegations.authorityFor({
          companyId: transaction.companyId,
          transactionType: transaction.transactionType,
          roleCode: step.roleCode,
          userId: request.actor.userId,
          userRoles: request.actor.roles,
          on: now,
          tx,
        });
        if (!authority.permitted) {
          throw new AccountingRuleViolation(
            'Consolidated Reference §2 — Approval authority',
            `${request.actor.userId} may not act on level ${step.level} of ` +
              `${transaction.documentReference}. ${authority.reason}`,
            { requiredRole: step.roleCode, level: step.level },
          );
        }
      }

      if (config.toStatus === WorkflowStatus.REJECTED) {
        await tx.workflowTransactionStep.update({
          where: { id: step.id },
          data: {
            status: WorkflowStepStatus.REJECTED,
            actedById: request.actor.userId,
            actedAt: now,
            comments: request.comments ?? null,
          },
        });
      }

      const updated = await tx.workflowTransaction.update({
        where: { id: transaction.id },
        data: {
          status: config.toStatus,
          currentLevel:
            config.toStatus === WorkflowStatus.RETURNED ? transaction.currentLevel : null,
          completedAt: config.toStatus === WorkflowStatus.REJECTED ? now : null,
        },
      });

      await this.recordEvent(tx, {
        transactionId: transaction.id,
        action: config.action,
        fromStatus: transaction.status,
        toStatus: config.toStatus,
        level: step.level,
        actor: request.actor,
        comments: request.comments,
        reference: transaction.documentReference,
        module: transaction.module,
        auditAction: config.auditAction,
      });

      await this.notifications.queue(
        {
          transactionId: transaction.id,
          recipientIds: [transaction.makerId],
          event: config.event,
          subject: `${transaction.documentReference} ${config.verb}`,
          body:
            `${transaction.documentReference} was ${config.verb} at level ${step.level}.` +
            (request.comments ? ` Comment: ${request.comments}` : ''),
        },
        tx,
      );

      return {
        transactionId: transaction.id,
        documentReference: updated.documentReference,
        status: updated.status,
        currentLevel: updated.currentLevel,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * What is waiting on this user — by their own roles or by delegation, and
   * never including documents they made themselves (Rule 4 again: showing a
   * maker their own document in an approval queue is an invitation to a control
   * failure).
   */
  async pendingFor(userId: string, companyId?: string) {
    const now = new Date();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { roles: true },
    });

    const delegations = await this.prisma.workflowDelegation.findMany({
      where: {
        delegateId: userId,
        active: true,
        startDate: { lte: now },
        endDate: { gte: now },
        ...(companyId ? { companyId } : {}),
      },
      select: { delegatorId: true, transactionType: true },
    });

    const delegatedRoles = new Set<string>();
    if (delegations.length > 0) {
      const delegators = await this.prisma.user.findMany({
        where: { id: { in: delegations.map((d) => d.delegatorId) } },
        select: { roles: true },
      });
      for (const d of delegators) for (const r of d.roles) delegatedRoles.add(r);
    }

    const roles = [...new Set([...user.roles, ...delegatedRoles])];

    const transactions = await this.prisma.workflowTransaction.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        status: { in: [WorkflowStatus.SUBMITTED, WorkflowStatus.UNDER_REVIEW] },
        makerId: { not: userId },
      },
      include: {
        steps: { orderBy: { level: 'asc' } },
        definition: { select: { name: true } },
      },
      orderBy: { levelEnteredAt: 'asc' },
    });

    const isAdministrator = user.roles.includes('ADMINISTRATOR');

    return transactions.filter((t) => {
      const step = t.steps.find((s) => s.level === t.currentLevel);
      if (!step) return false;
      return isAdministrator || roles.includes(step.roleCode);
    });
  }

  async history(transactionId: string) {
    return this.prisma.workflowHistory.findMany({
      where: { transactionId },
      orderBy: { occurredAt: 'asc' },
      include: {
        user: { select: { fullName: true } },
        onBehalfOf: { select: { fullName: true } },
      },
    });
  }

  async dashboard(companyId: string) {
    const grouped = await this.prisma.workflowTransaction.groupBy({
      by: ['status', 'transactionType'],
      where: { companyId },
      _count: { _all: true },
      _sum: { amountKobo: true },
    });

    const now = Date.now();
    const open = await this.prisma.workflowTransaction.findMany({
      where: {
        companyId,
        status: { in: [WorkflowStatus.SUBMITTED, WorkflowStatus.UNDER_REVIEW] },
      },
      select: { levelEnteredAt: true, escalatedAt: true },
    });

    const ageHours = open
      .map((t) =>
        t.levelEnteredAt ? (now - t.levelEnteredAt.getTime()) / 3_600_000 : 0,
      )
      .sort((a, b) => b - a);

    return {
      byStatus: grouped.map((g) => ({
        status: g.status,
        transactionType: g.transactionType,
        count: g._count._all,
        totalAmountKobo: (g._sum.amountKobo ?? 0n).toString(),
      })),
      open: {
        count: open.length,
        escalated: open.filter((t) => t.escalatedAt !== null).length,
        oldestHours: ageHours.length > 0 ? Math.round(ageHours[0]!) : 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async loadActionable(tx: Prisma.TransactionClient, transactionId: string) {
    const transaction = await tx.workflowTransaction.findUnique({
      where: { id: transactionId },
      include: { steps: { orderBy: { level: 'asc' } } },
    });
    if (!transaction) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Workflow state',
        `Workflow transaction ${transactionId} does not exist.`,
        { transactionId },
      );
    }
    const actionable: WorkflowStatus[] = [
      WorkflowStatus.SUBMITTED,
      WorkflowStatus.UNDER_REVIEW,
    ];
    if (!actionable.includes(transaction.status)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Workflow state',
        `${transaction.documentReference} is ${transaction.status} and is not awaiting action.`,
        { transactionId, status: transaction.status },
      );
    }
    return transaction;
  }

  private async currentStep(
    tx: Prisma.TransactionClient,
    transaction: Prisma.WorkflowTransactionGetPayload<{ include: { steps: true } }>,
  ) {
    const step = transaction.steps.find((s) => s.level === transaction.currentLevel);
    if (!step) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Workflow state',
        `${transaction.documentReference} has no step at level ${transaction.currentLevel}.`,
        { transactionId: transaction.id },
      );
    }
    return step;
  }

  /**
   * Rule 4, first clause. Checked here in the service — not only in the UI and
   * not only in the database — because this is the layer every module shares.
   */
  private assertNotMaker(
    makerId: string,
    actor: WorkflowActor,
    reference: string,
  ): void {
    if (makerId === actor.userId) {
      throw new MakerCheckerViolation(reference, actor.userId);
    }
  }

  private async recordEvent(
    tx: Prisma.TransactionClient,
    event: {
      transactionId: string;
      action: WorkflowActionType;
      fromStatus: WorkflowStatus | null;
      toStatus: WorkflowStatus;
      level: number | null;
      actor: WorkflowActor;
      onBehalfOfId?: string | null;
      comments?: string | null;
      reference: string;
      module: string;
      auditAction: AuditAction;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.workflowHistory.create({
      data: {
        transactionId: event.transactionId,
        action: event.action,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        level: event.level,
        userId: event.actor.userId,
        onBehalfOfId: event.onBehalfOfId ?? null,
        comments: event.comments ?? null,
        ipAddress: event.actor.ipAddress ?? null,
        device: event.actor.device ?? null,
      },
    });

    await this.audit.write(
      {
        transactionId: event.transactionId,
        module: event.module,
        entityType: 'WorkflowTransaction',
        entityId: event.transactionId,
        status: event.toStatus,
        action: event.auditAction,
        userId: event.actor.userId,
        ipAddress: event.actor.ipAddress,
        device: event.actor.device,
        comments: event.comments,
        metadata: {
          documentReference: event.reference,
          level: event.level,
          ...(event.onBehalfOfId ? { onBehalfOfId: event.onBehalfOfId } : {}),
          ...(event.metadata ?? {}),
        },
      },
      tx,
    );
  }

  /** Notify everyone who could act on a level. */
  private async notifyLevel(
    tx: Prisma.TransactionClient,
    transactionId: string,
    roleCode: string,
    options: {
      companyId: string;
      event: NotificationEvent;
      subject: string;
      body: string;
      excludeUserId?: string;
    },
  ): Promise<void> {
    const holders = await tx.user.findMany({
      where: { active: true, roles: { has: roleCode } },
      select: { id: true },
    });

    const now = new Date();
    const delegated = await tx.workflowDelegation.findMany({
      where: {
        companyId: options.companyId,
        active: true,
        startDate: { lte: now },
        endDate: { gte: now },
        delegatorId: { in: holders.map((h) => h.id) },
      },
      select: { delegateId: true },
    });

    const recipients = [
      ...holders.map((h) => h.id),
      ...delegated.map((d) => d.delegateId),
    ].filter((id) => id !== options.excludeUserId);

    await this.notifications.queue(
      {
        transactionId,
        recipientIds: recipients,
        event: options.event,
        subject: options.subject,
        body: options.body,
      },
      tx,
    );
  }
}
