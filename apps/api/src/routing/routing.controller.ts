import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RoutingResourceType } from '@bioassetpro/database';
import { RoutingService } from './routing.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { OwnedRecord } from '../auth/owned-record.guard';
import { kobo } from '../common/money';
import type { WorkflowActor } from '../workflow/workflow.types';

/** Routing and activity-based costing — US-897-014/015. */
@Controller()
@Roles('PRODUCTION_LEAD', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  // Ownership checked on every route taking an order or pool id: the service
  // looks these up by id alone, so unguarded they answered for any company.
  @OwnedRecord('productionOrder', 'id')
  @Post('production/orders/:id/routing/snapshot')
  async snapshot(@Param('id') id: string) {
    return this.routing.snapshotRouting(id);
  }

  @OwnedRecord('productionOrder', 'id')
  @Get('production/orders/:id/routing')
  async listRoutingLines(@Param('id') id: string) {
    return this.routing.listRoutingLines(id);
  }

  @Get('costing/cost-pools')
  async listCostPools(@CurrentCompany() companyId: string) {
    return this.routing.listCostPools(companyId);
  }

  /** AC-MFG-004: each pool's ledger cost against absorbed plus unused capacity. */
  @Get('costing/cost-pools/reconciliation')
  async reconcilePools(@CurrentCompany() companyId: string, @Query('asOf') asOf?: string) {
    if (asOf && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(asOf)) throw new BadRequestException('asOf must be a date, YYYY-MM-DD.');
    return this.routing.reconcilePools(companyId, asOf ? new Date(`${asOf}T00:00:00.000Z`) : new Date());
  }

  @OwnedRecord('costPool', 'id')
  @Post('costing/cost-pools/:id/sources')
  async setPoolSources(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { sources: Array<{ glAccountId: string; costCentreId?: string | null }> },
  ) {
    if (!Array.isArray(body?.sources)) throw new BadRequestException('sources is a list of ledger accounts.');
    return this.routing.setPoolSources({ companyId, poolId: id, sources: body.sources, actorId: actor.userId });
  }

  @OwnedRecord('costPool', 'id')
  @Get('costing/cost-pools/:id/unused-capacity')
  async unusedCapacity(@Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.routing.unusedCapacity(id, asOf ? new Date(asOf) : new Date());
  }

  @Post('costing/cost-pools')
  async createCostPool(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { code: string; name: string; driverName: string },
  ) {
    return this.routing.createCostPool({ ...body, companyId, actorId: actor.userId });
  }

  @Post('costing/cost-pools/:id/rate')
  async setCostPoolRate(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body()
    body: {
      poolCostKobo: string;
      practicalCapacity: string;
      effectiveFrom: string;
      sourceReference?: string | null;
    },
  ) {
    return this.routing.setCostPoolRate({
      companyId,
      poolId: id,
      poolCost: kobo(BigInt(body.poolCostKobo)),
      practicalCapacity: body.practicalCapacity,
      effectiveFrom: new Date(body.effectiveFrom),
      sourceReference: body.sourceReference ?? null,
      actorId: actor.userId,
    });
  }

  @Get('masters/recipes/versions/:id/routing')
  async listRoutingOperations(
    @CurrentCompany() companyId: string,
    @Param('id') recipeVersionId: string,
  ) {
    return this.routing.listRoutingOperations(companyId, recipeVersionId);
  }

  @Post('masters/recipes/versions/:id/routing')
  async createRoutingOperation(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') recipeVersionId: string,
    @Body()
    body: {
      costCentreId: string;
      costPoolId: string;
      operationName: string;
      resourceType: RoutingResourceType;
      setupHours?: string;
      runHoursPerUnit?: string;
    },
  ) {
    return this.routing.createRoutingOperation({
      ...body,
      companyId,
      recipeVersionId,
      actorId: actor.userId,
    });
  }
}
