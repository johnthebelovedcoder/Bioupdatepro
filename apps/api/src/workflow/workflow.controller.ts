import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { DelegationService } from './delegation.service';
import { EscalationService } from './escalation.service';
import { NotificationService } from './notification.service';
import { kobo } from '../common/money';
import { ActionRequest, SubmitRequest, WorkflowActor } from './workflow.types';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { Roles, AnyRole } from '../auth/roles.guard';

/**
 * Consolidated Reference §2 API surface.
 *
 * Authentication lands in Phase 3; until then the actor arrives in the body and
 * these routes are not exposed outside development. Every method already takes
 * the actor as an explicit argument, so wiring a JWT guard in front changes only
 * where the actor comes from, never how the rules are enforced.
 */
@Controller('workflow')
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly delegations: DelegationService,
    private readonly escalation: EscalationService,
    private readonly notifications: NotificationService,
  ) {}

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

  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Post('approve')
  async approve(@Body() body: ActionRequest) {
    return this.workflow.approve(body);
  }

  @Post('reject')
  async reject(@Body() body: ActionRequest) {
    return this.workflow.reject(body);
  }

  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Post('return')
  async returnToMaker(@Body() body: ActionRequest) {
    return this.workflow.returnToMaker(body);
  }

  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Post('cancel')
  async cancel(@Body() body: ActionRequest) {
    return this.workflow.cancel(body);
  }

  @Post('delegate')
  async delegate(
    @Body()
    body: {
      companyId: string;
      delegatorId: string;
      delegateId: string;
      transactionType?: string | null;
      startDate: string;
      endDate: string;
      reason: string;
      actor: WorkflowActor;
    },
  ) {
    return this.delegations.create({
      ...body,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    });
  }

  @OwnedRecord('workflowDelegation', 'id')
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Post('delegations/:id/revoke')
  async revokeDelegation(
    @Param('id') id: string,
    @Body() body: { actor: WorkflowActor },
  ) {
    return this.delegations.revoke(id, body.actor.userId);
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

  @Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
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
  @Roles('MANAGING_DIRECTOR')
  @Post('escalation/sweep')
  async sweep(@CurrentCompany() companyId: string, @Body() body: { now?: string }) {
    return this.escalation.sweep(body.now ? new Date(body.now) : new Date(), companyId);
  }
}
