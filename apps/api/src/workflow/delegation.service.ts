import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { DelegationRequest, WorkflowActor } from './workflow.types';

export interface ActingAuthority {
  /** True when the user may act on the step. */
  permitted: boolean;
  /** Set when authority came from a delegation rather than the user's own role. */
  onBehalfOfId?: string | null;
  reason: string;
}

/**
 * §2 Delegation.
 *
 * A delegation lends authority for a window; it never lends identity. The
 * delegate acts as themselves, the history records both parties, and Rule 4
 * still applies to the delegate personally — a maker who has been delegated the
 * approver's authority still cannot approve their own document. That is the
 * loophole delegation would otherwise open, so it is closed explicitly here and
 * again by a database trigger.
 */
@Injectable()
export class DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(request: DelegationRequest) {
    if (request.delegatorId === request.delegateId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Delegation',
        'A user cannot delegate approval authority to themselves.',
        { userId: request.delegatorId },
      );
    }
    // A user may only lend their OWN authority — Administrators may set one
    // up on someone else's behalf (a leave handover, say), the same carve-out
    // `authorityFor` below already grants them over acting on a step directly.
    if (
      request.delegatorId !== request.actor.userId &&
      !request.actor.roles.includes(roleAdministrator)
    ) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Delegation',
        'You may only delegate your own approval authority. An administrator can set up a delegation on someone else’s behalf.',
        { actorId: request.actor.userId, delegatorId: request.delegatorId },
      );
    }
    if (request.endDate <= request.startDate) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Delegation',
        'A delegation must end after it starts.',
        { startDate: request.startDate, endDate: request.endDate },
      );
    }

    const delegation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workflowDelegation.create({
        data: {
          companyId: request.companyId,
          delegatorId: request.delegatorId,
          delegateId: request.delegateId,
          transactionType: request.transactionType ?? null,
          startDate: request.startDate,
          endDate: request.endDate,
          reason: request.reason,
          createdById: request.actor.userId,
        },
      });

      await this.audit.write(
        {
          transactionId: created.id,
          module: 'workflow',
          entityType: 'WorkflowDelegation',
          entityId: created.id,
          status: 'ACTIVE',
          action: AuditAction.CONFIG_CHANGE,
          userId: request.actor.userId,
          ipAddress: request.actor.ipAddress,
          device: request.actor.device,
          comments: request.reason,
          metadata: {
            delegatorId: request.delegatorId,
            delegateId: request.delegateId,
            transactionType: request.transactionType ?? 'ALL',
            startDate: request.startDate.toISOString(),
            endDate: request.endDate.toISOString(),
          },
        },
        tx,
      );

      return created;
    });

    return delegation;
  }

  /**
   * Revocable by the delegator themselves — withdrawing authority you lent is
   * self-service, the same as cancelling your own submission — or by an
   * Administrator. Not by every senior ladder role: a Finance Manager has no
   * business unwinding a delegation between two other people.
   */
  async revoke(delegationId: string, actor: WorkflowActor) {
    const delegation = await this.prisma.workflowDelegation.findUniqueOrThrow({
      where: { id: delegationId },
    });
    if (
      delegation.delegatorId !== actor.userId &&
      !actor.roles.includes(roleAdministrator)
    ) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Delegation',
        'Only the person who granted a delegation — or an administrator — may revoke it.',
        { delegationId, actorId: actor.userId },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowDelegation.update({
        where: { id: delegationId },
        data: { active: false },
      });
      await this.audit.write(
        {
          transactionId: delegationId,
          module: 'workflow',
          entityType: 'WorkflowDelegation',
          entityId: delegationId,
          status: 'REVOKED',
          action: AuditAction.CONFIG_CHANGE,
          userId: actor.userId,
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Every delegation `userId` can see — the ones they have granted (as
   * delegator) and the ones lent to them (as delegate). Personal, the same
   * scope `pendingFor`/the notification inbox already use: an approval
   * inbox has no legitimate reason to show somebody else's arrangement.
   */
  async listFor(companyId: string, userId: string) {
    return this.prisma.workflowDelegation.findMany({
      where: {
        companyId,
        OR: [{ delegatorId: userId }, { delegateId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        delegator: { select: { fullName: true } },
        delegate: { select: { fullName: true } },
      },
    });
  }

  /**
   * The users whose authority `userId` currently carries, for this transaction
   * type. Empty when they hold none.
   */
  async delegatorsFor(
    companyId: string,
    userId: string,
    transactionType: string,
    on: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const rows = await client.workflowDelegation.findMany({
      where: {
        companyId,
        delegateId: userId,
        active: true,
        startDate: { lte: on },
        endDate: { gte: on },
        OR: [{ transactionType: null }, { transactionType }],
      },
      select: { delegatorId: true },
    });
    return rows.map((r) => r.delegatorId);
  }

  /**
   * May this user act on a step requiring `roleCode`?
   *
   * Own role first, delegated authority second. The maker check is deliberately
   * NOT here — it belongs to the workflow service, which knows the maker, and
   * running it there keeps the two refusals distinguishable in the audit trail.
   */
  async authorityFor(params: {
    companyId: string;
    transactionType: string;
    roleCode: string;
    userId: string;
    userRoles: string[];
    on: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<ActingAuthority> {
    if (params.userRoles.includes(roleAdministrator)) {
      return {
        permitted: true,
        onBehalfOfId: null,
        reason: `User holds ${roleAdministrator}.`,
      };
    }
    if (params.userRoles.includes(params.roleCode)) {
      return {
        permitted: true,
        onBehalfOfId: null,
        reason: `User holds role ${params.roleCode}.`,
      };
    }

    const delegators = await this.delegatorsFor(
      params.companyId,
      params.userId,
      params.transactionType,
      params.on,
      params.tx,
    );
    if (delegators.length === 0) {
      return {
        permitted: false,
        reason:
          `This step requires role ${params.roleCode}. The user does not hold it ` +
          `and has no active delegation covering it.`,
      };
    }

    const client = params.tx ?? this.prisma;
    const holders = await client.user.findMany({
      where: { id: { in: delegators }, active: true, roles: { has: params.roleCode } },
      select: { id: true, fullName: true },
    });

    if (holders.length === 0) {
      return {
        permitted: false,
        reason:
          `This step requires role ${params.roleCode}. The user's active delegations ` +
          `are from people who do not hold it.`,
      };
    }

    return {
      permitted: true,
      onBehalfOfId: holders[0]!.id,
      reason: `Acting under delegation from ${holders[0]!.fullName}.`,
    };
  }
}

/**
 * Administrators can act on any step. §2 restricts workflow *configuration* to
 * Administrators; letting them also unblock a stuck queue is the pragmatic
 * reading, and every such action is recorded with the reason above.
 */
const roleAdministrator = 'ADMINISTRATOR';
