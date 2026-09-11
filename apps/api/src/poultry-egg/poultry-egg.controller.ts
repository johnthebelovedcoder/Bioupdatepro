import { BadRequestException, Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { PoultryEggService } from './poultry-egg.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Required rather than optional — see `IdempotencyService`'s own doc
 * comment (Rule 6). These three endpoints are reached from the offline
 * outbox (`sync-queue.ts`), where a retry after a lost response is the
 * expected case, not the exception.
 */
function requireKey(key: string | undefined): string {
  if (!key?.trim()) {
    throw new BadRequestException('An idempotency-key header is required.');
  }
  return key.trim();
}

/** PoultryPro egg production, incubation and hatching — Poultry_Egg_Production, PCR-067/068/069. */
@Controller('poultry/eggs')
@Roles('FARM_MANAGER', 'FARM_ATTENDANT', 'PRODUCTION_LEAD', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class PoultryEggController {
  constructor(
    private readonly eggs: PoultryEggService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Active poultry groups, for the "record a collection" picker.
   *
   * `/operations/groups` exists already but returns each group's CODE as its
   * `id` (the web app routes to that screen by code) — no use here, since
   * `recordCollection()` needs the real `LivestockGroup.id`.
   */
  @Get('groups')
  async layingGroups(@CurrentCompany() companyId: string) {
    return this.prisma.livestockGroup.findMany({
      where: { companyId, speciesKey: 'poultry', status: 'ACTIVE' },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, stage: true, population: true },
    });
  }

  @Get('collections')
  async listCollections(@CurrentCompany() companyId: string) {
    return this.eggs.listEggBatches(companyId);
  }

  @Get('incubations')
  async listIncubations(@CurrentCompany() companyId: string) {
    return this.eggs.listIncubationBatches(companyId);
  }

  @Post('collections')
  async recordCollection(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body()
    body: {
      sourceGroupId: string;
      code: string;
      collectedOn: string;
      hatchingCount: number;
      tableCount: number;
      rejectCount: number;
      notes?: string;
    },
  ) {
    return this.eggs.recordCollection({
      companyId,
      sourceGroupId: body.sourceGroupId,
      code: body.code,
      collectedOn: new Date(body.collectedOn),
      hatchingCount: body.hatchingCount,
      tableCount: body.tableCount,
      rejectCount: body.rejectCount,
      notes: body.notes ?? null,
      recordedById: actor.userId,
      idempotencyKey: requireKey(idempotencyKey),
    });
  }

  @Post('incubations')
  async setIncubation(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body()
    body: {
      eggBatchId: string;
      code: string;
      setOn: string;
      setQuantity: number;
      incubator?: string;
      notes?: string;
    },
  ) {
    return this.eggs.setIncubation({
      companyId,
      eggBatchId: body.eggBatchId,
      code: body.code,
      setOn: new Date(body.setOn),
      setQuantity: body.setQuantity,
      incubator: body.incubator ?? null,
      notes: body.notes ?? null,
      recordedById: actor.userId,
      idempotencyKey: requireKey(idempotencyKey),
    });
  }

  @Post('hatch')
  async recordHatch(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body()
    body: {
      incubationBatchId: string;
      hatchedOn: string;
      hatchedCount: number;
      unhatchedCount: number;
      damagedCount: number;
      chickGroupCode?: string;
      breed?: string;
      purpose?: string;
      penHouseId?: string;
    },
  ) {
    return this.eggs.recordHatch({
      companyId,
      incubationBatchId: body.incubationBatchId,
      hatchedOn: new Date(body.hatchedOn),
      hatchedCount: body.hatchedCount,
      unhatchedCount: body.unhatchedCount,
      damagedCount: body.damagedCount,
      chickGroupCode: body.chickGroupCode,
      breed: body.breed,
      purpose: body.purpose,
      penHouseId: body.penHouseId,
      recordedById: actor.userId,
      idempotencyKey: requireKey(idempotencyKey),
    });
  }
}
