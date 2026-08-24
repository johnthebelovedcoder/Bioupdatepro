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

  @Roles('FARM_MANAGER', 'CEO')
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
    'CEO',
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
    'CEO',
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
    'CEO',
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
  // FARM_ACCOUNTANT (ROL-012) reconciles BA/inventory/WIP/journals day to
  // day — clearing the posting backlog is part of that, even though they
  // cannot approve the manual journals it might surface.
  @Roles('FINANCE_CONTROLLER', 'FINANCE_MANAGER', 'FARM_ACCOUNTANT', 'CEO')
  @Post('postings/retry')
  async retryPostings(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Query('limit') limit?: string,
  ) {
    return this.postings.postBacklog({
      companyId,
      actor,
      ...(limit ? { limit: Number(limit) } : {}),
    });
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
    'CEO',
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
    'CEO',
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
    'CEO',
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
