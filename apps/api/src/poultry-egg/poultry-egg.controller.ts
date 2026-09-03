import { Body, Controller, Get, Post } from '@nestjs/common';
import { PoultryEggService } from './poultry-egg.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/** PoultryPro egg production, incubation and hatching — Poultry_Egg_Production, PCR-067/068/069. */
@Controller('poultry/eggs')
@Roles('FARM_MANAGER', 'FARM_ATTENDANT', 'PRODUCTION_LEAD', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class PoultryEggController {
  constructor(private readonly eggs: PoultryEggService) {}

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
    });
  }

  @Post('incubations')
  async setIncubation(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
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
    });
  }

  @Post('hatch')
  async recordHatch(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
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
    });
  }
}
