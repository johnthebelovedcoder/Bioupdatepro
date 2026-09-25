import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { OperationsService } from './operations.service';
import { OperationsReadService } from './operations-read.service';
import { TradeService } from './trade.service';
import { OperationsPostingService } from './operations-posting.service';
import { EggPostingService } from '../poultry-egg/egg-posting.service';
import { BatchCloseService } from './batch-close.service';
import { BatchProfileService } from './batch-profile.service';
import { Roles, AnyRole } from '../auth/roles.guard';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * The receiving end of the phone's outbox.
 *
 * Every route takes its company from the signed-in user and its actor from the
 * verified token — never from the body, which arrives from a handset that has
 * been offline and is not a source of authority about either.
 *
 * The idempotency key is required rather than optional. The client generates
 * one per queued item and reuses it across retries, and a retry after a timeout
 * is precisely the case where the server may already have committed. A write
 * endpoint that accepts an unkeyed submission is one that will eventually
 * record the same round twice.
 */
@Controller('operations')
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly reads: OperationsReadService,
    private readonly trade: TradeService,
    private readonly postings: OperationsPostingService,
    private readonly eggPostings: EggPostingService,
    private readonly batches: BatchCloseService,
    private readonly profiles: BatchProfileService,
  ) {}

  /* --- Reads ------------------------------------------------------------ */

  @AnyRole('Livestock reads are the shared ground floor of the product.')
  @Get('groups')
  async groups(@CurrentCompany() companyId: string, @Query('species') species: string) {
    return this.reads.groups(companyId, species);
  }

  @AnyRole('Livestock reads are the shared ground floor of the product.')
  @Get('groups/:code')
  async group(@CurrentCompany() companyId: string, @Param('code') code: string) {
    const group = await this.reads.groupDetail(companyId, code);
    if (!group) throw new NotFoundException(`No population with the code ${code}.`);
    return group;
  }

  @AnyRole('Livestock reads are the shared ground floor of the product.')
  @Get('production')
  async production(
    @CurrentCompany() companyId: string,
    @Query('species') species: string,
    @Query('days') days = '30',
  ) {
    return this.reads.production(companyId, species, positiveDays(days));
  }

  @AnyRole('Livestock reads are the shared ground floor of the product.')
  @Get('feeding')
  async feeding(
    @CurrentCompany() companyId: string,
    @Query('species') species: string,
    @Query('days') days = '30',
  ) {
    return this.reads.feeding(companyId, species, positiveDays(days));
  }

  @AnyRole('Livestock reads are the shared ground floor of the product.')
  @Get('health')
  async health(@CurrentCompany() companyId: string, @Query('species') species: string) {
    return this.reads.health(companyId, species);
  }

  @AnyRole('Livestock reads are the shared ground floor of the product.')
  @Get('harvests')
  async harvestList(@CurrentCompany() companyId: string, @Query('species') species: string) {
    return this.reads.harvests(companyId, species);
  }

  @AnyRole('Livestock reads are the shared ground floor of the product.')
  @Get('stages')
  async stages(
    @CurrentCompany() companyId: string,
    @Query('species') species: string,
    @Query('stages') stages = '',
  ) {
    // The lifecycle order belongs to the module registry in the web app, so it
    // is passed in rather than duplicated here — the schema has no opinion
    // about what a snail's stages are, and should not acquire one.
    return this.reads.stageBreakdown(
      companyId,
      species,
      stages.split(',').map((s) => s.trim()).filter(Boolean),
    );
  }

  /* --- Writes ----------------------------------------------------------- */

  @Roles('FARM_MANAGER', 'CFO')
  @Post('placements')
  async placement(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() payload: Parameters<OperationsService['placeGroup']>[0]['payload'],
  ) {
    return this.operations.placeGroup({
      companyId,
      actor,
      idempotencyKey: requireKey(idempotencyKey),
      payload,
    });
  }

  /*
   * FARM_ATTENDANT's whole RACI line (ROL-001) is "Capture daily
   * biological/production data by cut-off" — this endpoint IS that job. The
   * species supervisors and PRODUCTION_LEAD approve what an attendant
   * captures, so they can also capture it themselves on a farm too small to
   * split the two.
   */
  @Roles(
    'PRODUCTION_SUPERVISOR',
    'SNAIL_SUPERVISOR',
    'POULTRY_SUPERVISOR',
    'PRODUCTION_LEAD',
    'FARM_ATTENDANT',
    'FARM_MANAGER',
    'CFO',
  )
  @Post('rounds')
  async round(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() payload: Parameters<OperationsService['recordRound']>[0]['payload'],
  ) {
    return this.operations.recordRound({
      companyId,
      actor,
      idempotencyKey: requireKey(idempotencyKey),
      payload,
    });
  }

  @Roles(
    'PRODUCTION_SUPERVISOR',
    'SNAIL_SUPERVISOR',
    'POULTRY_SUPERVISOR',
    'PRODUCTION_LEAD',
    'FARM_ATTENDANT',
    'FARM_MANAGER',
    'CFO',
  )
  @Post('treatments')
  async treatment(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() payload: Parameters<OperationsService['recordTreatment']>[0]['payload'],
  ) {
    return this.operations.recordTreatment({
      companyId,
      actor,
      idempotencyKey: requireKey(idempotencyKey),
      payload,
    });
  }

  // "Approve...harvest readiness" is a named RACI line for both species
  // supervisors (ROL-002/003) — harvest sits at their tier, not the
  // attendant's.
  @Roles(
    'PRODUCTION_SUPERVISOR',
    'SNAIL_SUPERVISOR',
    'POULTRY_SUPERVISOR',
    'PRODUCTION_LEAD',
    'FARM_MANAGER',
    'CFO',
  )
  @Post('harvests')
  async harvest(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() payload: Parameters<OperationsService['recordHarvest']>[0]['payload'],
  ) {
    return this.operations.recordHarvest({
      companyId,
      actor,
      idempotencyKey: requireKey(idempotencyKey),
      payload,
    });
  }

  /**
   * Post the operational rows that have no journal yet.
   *
   * Not automatic on a timer, because posting into the ledger is not something
   * that should happen while nobody is looking — it is an action somebody takes
   * and is answerable for, and the actor on every resulting journal is the
   * person who called this.
   */
  /**
   * Close a batch. With animals still recorded, `writeOffRemaining` records
   * them as a final loss through the ordinary death posting first. Closing a
   * cycle is the farm manager's call; the finance roles can do it too.
   */
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('groups/:code/close')
  async closeGroup(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('code') code: string,
    @Body() body: { closedOn: string; reason: string; writeOffRemaining?: boolean },
  ) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body?.closedOn ?? '')) {
      throw new BadRequestException('closedOn must be a date, YYYY-MM-DD.');
    }
    return this.batches.close({
      companyId,
      groupCode: code,
      closedOn: new Date(`${body.closedOn}T00:00:00.000Z`),
      reason: String(body.reason ?? ''),
      writeOffRemaining: body.writeOffRemaining === true,
      actor,
    });
  }

  /** Age, weighings, live weight and how animals left — for the group page. */
  @AnyRole('How a batch is growing is farm information everyone on the farm uses.')
  @Get('groups/:code/profile')
  async groupProfile(@CurrentCompany() companyId: string, @Param('code') code: string) {
    return this.profiles.profile(companyId, code);
  }

  /**
   * A sample weighing, recorded PENDING — whoever walks the round can record
   * it (the round can carry one too); a supervisor or farm manager approves.
   */
  @Roles('PRODUCTION_SUPERVISOR', 'SNAIL_SUPERVISOR', 'POULTRY_SUPERVISOR', 'PRODUCTION_LEAD', 'FARM_ATTENDANT', 'FARM_MANAGER', 'CFO')
  @Post('groups/:code/weighings')
  async recordWeighing(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('code') code: string,
    @Body() body: { weighedOn: string; sampleSize: number; totalSampleWeight: number; unit: 'g' | 'kg'; notes?: string },
  ) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body?.weighedOn ?? '')) {
      throw new BadRequestException('weighedOn must be a date, YYYY-MM-DD.');
    }
    const weighing = await this.profiles.recordWeighing({
      companyId,
      code,
      weighedOn: new Date(`${body.weighedOn}T00:00:00.000Z`),
      sampleSize: Number(body.sampleSize),
      totalSampleWeight: Number(body.totalSampleWeight),
      unit: body.unit,
      notes: body.notes ?? null,
      actor,
    });
    return { id: weighing.id, averageWeightGrams: weighing.averageWeightGrams, status: weighing.status };
  }

  @AnyRole('Weighings waiting for a supervisor are farm information.')
  @Get('weighings/pending')
  async pendingWeighings(@CurrentCompany() companyId: string) {
    return this.profiles.pendingWeighings(companyId);
  }

  @Roles('FARM_MANAGER', 'POULTRY_SUPERVISOR', 'SNAIL_SUPERVISOR', 'PRODUCTION_SUPERVISOR', 'PRODUCTION_LEAD', 'CFO')
  @Post('weighings/:id/approve')
  async approveWeighing(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Param('id') id: string) {
    const weighing = await this.profiles.approveWeighing({ companyId, weighingId: id, actor });
    return { id: weighing.id, isCurrent: weighing.isCurrent };
  }

  @Roles('FARM_MANAGER', 'POULTRY_SUPERVISOR', 'SNAIL_SUPERVISOR', 'PRODUCTION_SUPERVISOR', 'PRODUCTION_LEAD', 'CFO')
  @Post('weighings/:id/reject')
  async rejectWeighing(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    await this.profiles.rejectWeighing({ companyId, weighingId: id, reason: String(body?.reason ?? ''), actor });
    return { ok: true };
  }

  @Roles('PRODUCTION_SUPERVISOR', 'SNAIL_SUPERVISOR', 'POULTRY_SUPERVISOR', 'PRODUCTION_LEAD', 'FARM_MANAGER', 'CFO')
  @Post('groups/:code/hatch-date')
  async setHatchDate(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('code') code: string,
    @Body() body: { hatchedOn: string | null; estimated?: boolean },
  ) {
    const hatchedOn = body?.hatchedOn ?? null;
    if (hatchedOn !== null && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(hatchedOn)) {
      throw new BadRequestException('hatchedOn must be a date, YYYY-MM-DD, or null.');
    }
    await this.profiles.setHatchDate({
      companyId,
      code,
      hatchedOn: hatchedOn ? new Date(`${hatchedOn}T00:00:00.000Z`) : null,
      estimated: body?.estimated === true,
      actor,
    });
    return { ok: true };
  }

  // FARM_ACCOUNTANT (ROL-012) reconciles BA/inventory/WIP/journals day to
  // day — clearing the posting backlog is part of that, even though they
  // cannot approve the manual journals it might surface.
  @Roles('FINANCE_CONTROLLER', 'FINANCE_MANAGER', 'FARM_ACCOUNTANT', 'CFO')
  @Post('postings/retry')
  async retryPostings(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Query('limit') limit?: string,
  ) {
    const farm = await this.postings.postBacklog({
      companyId,
      actor,
      ...(limit ? { limit: Number(limit) } : {}),
    });
    // Egg collections, settings and hatches (PCR-067/068/069) wait the same way.
    const eggs = await this.eggPostings.postPending(companyId, actor);
    return {
      ...farm,
      eggs: { posted: eggs.posted, failed: eggs.failed },
      reasons: [...new Set([...farm.reasons, ...eggs.reasons])],
    };
  }

  /*
   * Trade, not operations — but it arrives through the same outbox, so it is
   * received here and handed to O2C and P2P. Neither posts anything: both
   * record a document and submit it for approval.
   */
  // SALES_OFFICER (ROL-010): "Create order, dispatch and invoice" — this is
  // that role's entire job, and it had no route to it at all before.
  @Roles(
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCE_CONTROLLER',
    'SALES_OFFICER',
    'CFO',
  )
  @Post('sales')
  async sale(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() payload: Parameters<TradeService['recordSale']>[0]['payload'],
  ) {
    return this.trade.recordSale({
      companyId,
      actor,
      idempotencyKey: requireKey(idempotencyKey),
      payload,
    });
  }

  // PROCUREMENT_OFFICER (ROL-005): "Source, create PR/PO, monitor delivery"
  // — this is that role's entire job.
  @Roles(
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCE_CONTROLLER',
    'PROCUREMENT_OFFICER',
    'CFO',
  )
  @Post('purchases')
  async purchase(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() payload: Parameters<TradeService['recordPurchase']>[0]['payload'],
  ) {
    return this.trade.recordPurchase({
      companyId,
      actor,
      idempotencyKey: requireKey(idempotencyKey),
      payload,
    });
  }

  // "Transfers" in the same supervisor RACI line as harvest readiness.
  @Roles(
    'PRODUCTION_SUPERVISOR',
    'SNAIL_SUPERVISOR',
    'POULTRY_SUPERVISOR',
    'PRODUCTION_LEAD',
    'FARM_MANAGER',
    'CFO',
  )
  @Post('stage-changes')
  async stageChange(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() payload: Parameters<OperationsService['recordStageChange']>[0]['payload'],
  ) {
    return this.operations.recordStageChange({
      companyId,
      actor,
      idempotencyKey: requireKey(idempotencyKey),
      payload,
    });
  }
}

function positiveDays(value: string): number {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? Math.min(400, Math.trunc(days)) : 30;
}

function requireKey(key: string | undefined): string {
  if (!key?.trim()) {
    throw new BadRequestException('An idempotency-key header is required.');
  }
  return key.trim();
}
