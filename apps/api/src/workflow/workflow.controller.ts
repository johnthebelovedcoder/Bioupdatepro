import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { DelegationService } from './delegation.service';
import { EscalationService } from './escalation.service';
import { NotificationService } from './notification.service';
import { kobo } from '../common/money';
import { ActionRequest, SubmitRequest, WorkflowActor } from './workflow.types';

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

  @Post('approve')
  async approve(@Body() body: ActionRequest) {
    return this.workflow.approve(body);
  }

  @Post('reject')
  async reject(@Body() body: ActionRequest) {
    return this.workflow.reject(body);
  }

  @Post('return')
  async returnToMaker(@Body() body: ActionRequest) {
    return this.workflow.returnToMaker(body);
  }

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

  @Post('delegations/:id/revoke')
  async revokeDelegation(
    @Param('id') id: string,
    @Body() body: { actor: WorkflowActor },
  ) {
    return this.delegations.revoke(id, body.actor.userId);
  }

  @Get('pending')
  async pending(
    @Query('userId') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    const rows = await this.workflow.pendingFor(userId, companyId);
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

  @Get('dashboard')
  async dashboard(@Query('companyId') companyId: string) {
    return this.workflow.dashboard(companyId);
  }

  @Get('inbox')
  async inbox(@Query('userId') userId: string) {
    const rows = await this.notifications.inbox(userId);
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
  @Post('escalation/sweep')
  async sweep(@Body() body: { companyId?: string; now?: string }) {
    return this.escalation.sweep(
      body.now ? new Date(body.now) : new Date(),
      body.companyId,
    );
  }
}
