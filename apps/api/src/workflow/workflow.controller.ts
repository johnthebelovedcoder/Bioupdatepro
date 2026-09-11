import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { DelegationService } from './delegation.service';
import { EscalationService } from './escalation.service';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { kobo } from '../common/money';
import { SubmitRequest, WorkflowActor } from './workflow.types';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { Roles, AnyRole } from '../auth/roles.guard';

/**
 * Consolidated Reference §2 API surface.
 *
 * Who is acting comes from the session on every route that acts. That was the
 * one thing this controller got wrong for a long time: the actor was a field in
 * the request body, which reads as harmless plumbing and is not. Every §2 rule
 * about segregation of duties — a maker may not approve their own work, an
 * approver needs the role and the limit — is enforced against the actor, so an
 * actor the caller can type is a rule the caller can opt out of.
 */
@Controller('workflow')
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly delegations: DelegationService,
    private readonly escalation: EscalationService,
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Each role's approval limit, as this company is actually configured —
   * the same `WorkflowStep` rows `WorkflowRoutingService.resolveDefinition()`
   * reads to decide who must approve what. A role can appear on several of
   * the ~24 default ladders (one per transaction type); this takes the
   * highest limit seen for it, unlimited beating any number, since a role's
   * authority for this display is what it can approve at its widest, not
   * tied to one document type.
   */
  @AnyRole('Every signed-in person may see who can approve what, and up to how much.')
  @Get('approval-ladder')
  async approvalLadder(@CurrentCompany() companyId: string) {
    const steps = await this.prisma.workflowStep.findMany({
      where: { definition: { companyId } },
      select: { roleCode: true, maxAmountKobo: true },
    });

    const byRole = new Map<string, bigint | null>();
    for (const step of steps) {
      if (!byRole.has(step.roleCode)) {
        byRole.set(step.roleCode, step.maxAmountKobo);
        continue;
      }
      const current = byRole.get(step.roleCode)!;
      if (current !== null && (step.maxAmountKobo === null || step.maxAmountKobo > current)) {
        byRole.set(step.roleCode, step.maxAmountKobo);
      }
    }

    return [...byRole.entries()].map(([roleCode, maxAmountKobo]) => ({
      roleCode,
      maxAmountKobo: maxAmountKobo?.toString() ?? null,
    }));
  }

  @AnyRole('Raising a document for approval is open; the engine decides who must approve it.')
  @Post('submit')
  async submit(
    @Body()
    body: Omit<SubmitRequest, 'amount'> & { amountKobo: string | number },
  ) {
    const request: SubmitRequest = {
      ...body,
      amount: kobo(BigInt(body.amountKobo)),
    };
    return this.workflow.submit(request);
  }

  /*
   * Acting on a document: approve, reject, send back, cancel.
   *
   * The transaction moved from the body onto the path, and the actor from the
   * body onto the session, and both moves close the same hole. The actor being
   * a request field meant a caller could name themselves — including naming
   * somebody else, which defeats maker-checker at the point it exists to work:
   * the engine refuses an approval from the maker, and a maker could simply
   * claim to be their own approver. The transaction being a body field meant
   * the ownership guard, which reads path parameters, never ran, so a signed-in
   * user of one farm could approve another farm's payment run by id.
   */

  @OwnedRecord('workflowTransaction', 'transactionId')
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post(':transactionId/approve')
  async approve(
    @Param('transactionId') transactionId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { comments?: string | null },
  ) {
    return this.workflow.approve({ transactionId, actor, comments: body?.comments ?? null });
  }

  @OwnedRecord('workflowTransaction', 'transactionId')
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post(':transactionId/reject')
  async reject(
    @Param('transactionId') transactionId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { comments?: string | null },
  ) {
    return this.workflow.reject({ transactionId, actor, comments: body?.comments ?? null });
  }

  @OwnedRecord('workflowTransaction', 'transactionId')
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post(':transactionId/return')
  async returnToMaker(
    @Param('transactionId') transactionId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { comments?: string | null },
  ) {
    return this.workflow.returnToMaker({
      transactionId,
      actor,
      comments: body?.comments ?? null,
    });
  }

  @OwnedRecord('workflowTransaction', 'transactionId')
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post(':transactionId/cancel')
  async cancel(
    @Param('transactionId') transactionId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { comments?: string | null },
  ) {
    return this.workflow.cancel({ transactionId, actor, comments: body?.comments ?? null });
  }

  /**
   * Lend approval authority for a window. Defaults `delegatorId` to the
   * caller — lending your own authority needs no special role, the same as
   * raising a document does. Naming somebody else as delegator is refused by
   * `DelegationService.create()` unless the caller is an Administrator; see
   * its own comment for why.
   */
  @AnyRole('Lending your own approval authority for a window needs no special role.')
  @Post('delegate')
  async delegate(
    @CurrentUser() actor: WorkflowActor,
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      delegatorId?: string;
      delegateId: string;
      transactionType?: string | null;
      startDate: string;
      endDate: string;
      reason: string;
    },
  ) {
    return this.delegations.create({
      companyId,
      delegatorId: body.delegatorId ?? actor.userId,
      delegateId: body.delegateId,
      transactionType: body.transactionType ?? null,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      reason: body.reason,
      actor,
    });
  }

  /** Your own delegations — granted by you, or lent to you. */
  @AnyRole('Your own arrangements. The service scopes it to the caller.')
  @Get('delegations')
  async myDelegations(@CurrentUser() actor: WorkflowActor, @CurrentCompany() companyId: string) {
    const rows = await this.delegations.listFor(companyId, actor.userId);
    return rows.map((d) => ({
      id: d.id,
      delegatorId: d.delegatorId,
      delegatorName: d.delegator.fullName,
      delegateId: d.delegateId,
      delegateName: d.delegate.fullName,
      transactionType: d.transactionType,
      startDate: d.startDate,
      endDate: d.endDate,
      reason: d.reason,
      active: d.active,
      direction: d.delegatorId === actor.userId ? 'GRANTED' : 'RECEIVED',
    }));
  }

  @OwnedRecord('workflowDelegation', 'id')
  @AnyRole('The delegator, or an administrator. DelegationService.revoke() enforces which.')
  @Post('delegations/:id/revoke')
  async revokeDelegation(@Param('id') id: string, @CurrentUser() actor: WorkflowActor) {
    return this.delegations.revoke(id, actor);
  }

  /*
   * Whose approvals these are is decided by the token, not the query.
   *
   * `userId` used to come off the URL, which meant any signed-in user could
   * read anyone else's approval queue — including what is waiting on the
   * finance director, its amounts and its documents. An approval inbox is a
   * personal surface; there is no legitimate reason to ask for someone else's.
   */
  @AnyRole('Your own queue. The service scopes it to the caller.')
  @Get('pending')
  async pending(@CurrentUser() actor: WorkflowActor, @CurrentCompany() companyId: string) {
    const rows = await this.workflow.pendingFor(actor.userId, companyId);
    return rows.map((t) => ({
      transactionId: t.id,
      documentReference: t.documentReference,
      transactionType: t.transactionType,
      module: t.module,
      status: t.status,
      currentLevel: t.currentLevel,
      amountKobo: t.amountKobo.toString(),
      waitingSince: t.levelEnteredAt,
      escalated: t.escalatedAt !== null,
      route: t.definition.name,
      steps: t.steps.map((s) => ({
        level: s.level,
        name: s.name,
        roleCode: s.roleCode,
        status: s.status,
        ceilingKobo: s.maxAmountKobo?.toString() ?? null,
      })),
    }));
  }

  @OwnedRecord('workflowTransaction', 'transactionId')
  @AnyRole('The trail of a document you can already see.')
  @Get('history/:transactionId')
  async history(@Param('transactionId') transactionId: string) {
    const rows = await this.workflow.history(transactionId);
    return rows.map((h) => ({
      occurredAt: h.occurredAt,
      action: h.action,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      level: h.level,
      user: h.user.fullName,
      onBehalfOf: h.onBehalfOf?.fullName ?? null,
      comments: h.comments,
    }));
  }

  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Get('dashboard')
  async dashboard(@CurrentCompany() companyId: string) {
    return this.workflow.dashboard(companyId);
  }

  /** Also personal, and also previously addressable by any user id. */
  @AnyRole('Your own queue. The service scopes it to the caller.')
  @Get('inbox')
  async inbox(@CurrentUser() actor: WorkflowActor) {
    const rows = await this.notifications.inbox(actor.userId);
    return rows.map((n) => ({
      id: n.id,
      event: n.event,
      subject: n.subject,
      body: n.body,
      createdAt: n.createdAt,
      document: n.transaction.documentReference,
      documentStatus: n.transaction.status,
    }));
  }

  /**
   * Drive the escalation clock. A scheduler calls this in deployment; exposing
   * it also lets an administrator run the sweep on demand, and lets tests supply
   * an explicit `now` instead of waiting three days.
   */
  @Roles('CFO')
  @Post('escalation/sweep')
  async sweep(@CurrentCompany() companyId: string, @Body() body: { now?: string }) {
    return this.escalation.sweep(body.now ? new Date(body.now) : new Date(), companyId);
  }
}
