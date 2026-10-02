import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SnailBreedingService } from './snail-breeding.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/** The same people who record poultry breeding record snail breeding. */
@Controller('snail-breeding')
@Roles(
  'FARM_MANAGER',
  'FARM_ATTENDANT',
  'SNAIL_SUPERVISOR',
  'PRODUCTION_SUPERVISOR',
  'PRODUCTION_LEAD',
  'FINANCE_MANAGER',
  'FINANCE_CONTROLLER',
  'CFO',
)
export class SnailBreedingController {
  constructor(private readonly breeding: SnailBreedingService) {}

  @Get('cycles')
  async cycles(@CurrentCompany() companyId: string) {
    return this.breeding.list(companyId);
  }

  @Get('breeders')
  async breeders(@CurrentCompany() companyId: string) {
    return this.breeding.breederGroups(companyId);
  }

  @Get('egg-cost-sources')
  async eggCostSources(@CurrentCompany() companyId: string) {
    return this.breeding.eggCostSources(companyId);
  }

  @Post('cycles')
  async record(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: { code: string; breederGroupId: string; setOn: string; breeders: number; eggsLaid: number; valueBasis: 'FVLCTS' | 'ATTRIBUTABLE_COST'; valuePerEggKobo: string; valueEvidence: string; fairValueUnreliableReason?: string | null; costSourceAccountId?: string | null; notes?: string | null },
  ) {
    return this.breeding.record({ companyId, actor, ...body, valuePerEggKobo: BigInt(body.valuePerEggKobo) });
  }

  @Post('cycles/:id/value')
  async valueLegacyCycle(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { valueBasis: 'FVLCTS' | 'ATTRIBUTABLE_COST'; valuePerEggKobo: string; valueEvidence: string; fairValueUnreliableReason?: string | null; costSourceAccountId?: string | null },
  ) {
    return this.breeding.valueExistingCycle({ ...body, valuePerEggKobo: BigInt(body.valuePerEggKobo), companyId, actor, cycleId: id });
  }

  @Post('cycles/:id/hatch')
  async hatch(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { hatchedOn: string; hatchedCount: number; unhatchedCount: number; hatchlingGroupCode?: string | null },
  ) {
    return this.breeding.hatch({ companyId, actor, cycleId: id, ...body });
  }

  @Post('cycles/:id/fail')
  async fail(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.breeding.fail({ companyId, actor, cycleId: id, reason: body.reason });
  }
}
