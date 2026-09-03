import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RoutingService } from './routing.service';
import { CurrentCompany } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';

/** Routing and activity-based costing — US-897-014/015. */
@Controller()
@Roles('PRODUCTION_LEAD', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Post('production/orders/:id/routing/snapshot')
  async snapshot(@Param('id') id: string) {
    return this.routing.snapshotRouting(id);
  }

  @Get('production/orders/:id/routing')
  async listRoutingLines(@Param('id') id: string) {
    return this.routing.listRoutingLines(id);
  }

  @Get('costing/cost-pools')
  async listCostPools(@CurrentCompany() companyId: string) {
    return this.routing.listCostPools(companyId);
  }

  @Get('costing/cost-pools/:id/unused-capacity')
  async unusedCapacity(@Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.routing.unusedCapacity(id, asOf ? new Date(asOf) : new Date());
  }
}
