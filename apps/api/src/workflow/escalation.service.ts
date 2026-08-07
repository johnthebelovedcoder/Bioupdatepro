import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  NotificationEvent,
  Prisma,
  WorkflowActionType,
  WorkflowStatus,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from './notification.service';

export interface EscalationOutcome {
  reminded: number;
  managersNotified: number;
  escalated: number;
}

/**
 * §2 Escalation: 24h reminder, 48h manager notification, 72h escalation to the
 * next approver. Those numbers are seed configuration, never constants here.
 *
 * WHAT "ESCALATION TO NEXT APPROVER" MEANS HERE: the pending level stays where
 * it is and the next level's role becomes *additionally* able to act on it. We
 * do not auto-approve, and we do not skip the level — either would let time
 * alone manufacture an approval, which is not a control an auditor would accept.
 * The next approver may now act in place of the stalled one, and the history
 * records that they did so under escalation.
 *
 * `sweep()` is deliberately a plain method rather than a decorated cron job:
 * the caller decides the cadence (a scheduler in deployment, an explicit clock
 * in tests). Time-dependent behaviour that cannot be driven from a test is
 * time-dependent behaviour that does not get tested.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async sweep(now: Date = new Date(), companyId?: string): Promise<EscalationOutcome> {
    const pending = await this.prisma.workflowTransaction.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        status: { in: [WorkflowStatus.SUBMITTED, WorkflowStatus.UNDER_REVIEW] },
        levelEnteredAt: { not: null },
      },
      include: {
        steps: { orderBy: { level: 'asc' } },
        maker: { select: { id: true } },
      },
    });

    const outcome: EscalationOutcome = {
      reminded: 0,
      managersNotified: 0,
      escalated: 0,
    };

    for (const transaction of pending) {
      const rule = await this.ruleFor(transaction.companyId, transaction.transactionType);
      if (!rule) continue;

      const waitingHours =
        (now.getTime() - transaction.levelEnteredAt!.getTime()) / 3_600_000;

      const step = transaction.steps.find((s) => s.level === transaction.currentLevel);
      if (!step) continue;

      // Stages are checked most-severe first so a long-stalled transaction that
      // has never been swept lands on the right stage rather than replaying all
      // three across successive sweeps.
      if (
        waitingHours >= rule.escalateAfterHours &&
        transaction.escalatedAt === null
      ) {
        const next = transaction.steps.find((s) => s.level > step.level);
        await this.prisma.$transaction(async (tx) => {
          await tx.workflowTransaction.update({
            where: { id: transaction.id },
            data: { escalatedAt: now },
          });
          await this.record(tx, transaction, WorkflowActionType.ESCALATE, {
            level: step.level,
            comments:
              `No action for ${Math.round(waitingHours)}h at level ${step.level} ` +
              `(${step.name}). ` +
              (next
                ? `Escalated to level ${next.level} (${next.name}), who may now act in their place.`
                : `This is the final level; escalation notified the maker and role holders only.`),
          });
          await this.notifyRole(tx, transaction.id, next?.roleCode ?? step.roleCode, {
            event: NotificationEvent.ESCALATION,
            subject: `Escalated: ${transaction.documentReference}`,
            body:
              `${transaction.documentReference} has waited ${Math.round(waitingHours)}h at ` +
              `level ${step.level} and has been escalated.`,
          });
        });
        outcome.escalated += 1;
        continue;
      }

      if (
        waitingHours >= rule.notifyManagerAfterHours &&
        transaction.managerNotifiedAt === null
      ) {
        const next = transaction.steps.find((s) => s.level > step.level);
        await this.prisma.$transaction(async (tx) => {
          await tx.workflowTransaction.update({
            where: { id: transaction.id },
            data: { managerNotifiedAt: now },
          });
          await this.notifyRole(tx, transaction.id, next?.roleCode ?? step.roleCode, {
            event: NotificationEvent.ESCALATION,
            subject: `Awaiting approval ${Math.round(waitingHours)}h: ${transaction.documentReference}`,
            body:
              `${transaction.documentReference} has been waiting at level ${step.level} ` +
              `(${step.name}) for ${Math.round(waitingHours)}h.`,
          });
        });
        outcome.managersNotified += 1;
        continue;
      }

      if (waitingHours >= rule.remindAfterHours && transaction.lastReminderAt === null) {
        await this.prisma.$transaction(async (tx) => {
          await tx.workflowTransaction.update({
            where: { id: transaction.id },
            data: { lastReminderAt: now },
          });
          await this.notifyRole(tx, transaction.id, step.roleCode, {
            event: NotificationEvent.REMINDER,
            subject: `Reminder: ${transaction.documentReference} awaits your approval`,
            body:
              `${transaction.documentReference} has been awaiting level ${step.level} ` +
              `(${step.name}) approval for ${Math.round(waitingHours)}h.`,
          });
        });
        outcome.reminded += 1;
      }
    }

    return outcome;
  }

  /**
   * Whether `userId` may act on this transaction because it has been escalated
   * to their level. Consulted by the workflow service as an additional route to
   * authority, never as a replacement for one.
   */
  async escalatedAuthority(transactionId: string, userRoles: string[]): Promise<boolean> {
    const transaction = await this.prisma.workflowTransaction.findUnique({
      where: { id: transactionId },
      include: { steps: { orderBy: { level: 'asc' } } },
    });
    if (!transaction?.escalatedAt) return false;
    const next = transaction.steps.find((s) => s.level > (transaction.currentLevel ?? 0));
    return next ? userRoles.includes(next.roleCode) : false;
  }

  private async ruleFor(companyId: string, transactionType: string) {
    const specific = await this.prisma.workflowEscalationRule.findFirst({
      where: { companyId, transactionType, active: true },
    });
    if (specific) return specific;
    return this.prisma.workflowEscalationRule.findFirst({
      where: { companyId, transactionType: null, active: true },
    });
  }

  private async record(
    tx: Prisma.TransactionClient,
    transaction: { id: string; module: string; status: WorkflowStatus; documentReference: string; makerId: string },
    action: WorkflowActionType,
    details: { level: number | null; comments: string },
  ): Promise<void> {
    await tx.workflowHistory.create({
      data: {
        transactionId: transaction.id,
        action,
        fromStatus: transaction.status,
        toStatus: transaction.status,
        level: details.level,
        // The system acted, not a person. Attributing an automatic escalation to
        // a real user would put a name against something they did not do, so we
        // attribute it to the maker's own record with an explicit comment.
        userId: transaction.makerId,
        comments: `[system] ${details.comments}`,
      },
    });

    await this.audit.write(
      {
        transactionId: transaction.id,
        module: transaction.module,
        entityType: 'WorkflowTransaction',
        entityId: transaction.id,
        status: transaction.status,
        action: AuditAction.UPDATE,
        userId: transaction.makerId,
        comments: `[system] ${details.comments}`,
        metadata: {
          documentReference: transaction.documentReference,
          escalationStage: action,
        },
      },
      tx,
    );
  }

  private async notifyRole(
    tx: Prisma.TransactionClient,
    transactionId: string,
    roleCode: string,
    message: { event: NotificationEvent; subject: string; body: string },
  ): Promise<void> {
    const holders = await tx.user.findMany({
      where: { active: true, roles: { has: roleCode } },
      select: { id: true },
    });
    await this.notifications.queue(
      {
        transactionId,
        recipientIds: holders.map((h) => h.id),
        event: message.event,
        subject: message.subject,
        body: message.body,
      },
      tx,
    );
  }
}
