import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { ProductionOrderCycle } from '@bioassetpro/database';
import { FixedAssetService } from './fixed-asset.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { AnyRole, Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Fixed assets over HTTP.
 *
 * Same split as every other module here: reading is open to anyone signed
 * in, raising a capitalisation or running depreciation is not — both move
 * the ledger once approved.
 */
@Controller('fixed-assets')
export class FixedAssetsController {
  constructor(private readonly assets: FixedAssetService) {}

  @AnyRole('The register is what anyone reconciling PPE needs to see.')
  @Get('assets')
  async assetsList(@CurrentCompany() companyId: string) {
    return this.assets.listAssets(companyId);
  }

  /** FARM_ACCOUNTANT (ROL-012) is PCR-029's maker; Controller/CFO approve. */
  @Roles('FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('assets')
  async capitalise(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      name: string;
      assetClass: string;
      acquisitionDate: string;
      costKobo: string;
      usefulLifeMonths: number;
      costCentreId?: string | null;
    },
  ) {
    return this.assets.capitalise({
      companyId,
      actor,
      name: body.name,
      assetClass: body.assetClass,
      acquisitionDate: new Date(body.acquisitionDate),
      costKobo: BigInt(body.costKobo),
      usefulLifeMonths: body.usefulLifeMonths,
      costCentreId: body.costCentreId ?? null,
    });
  }

  /** PCR-030's maker/approver pair, same tier as capitalisation. */
  @Roles('FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('depreciation-runs')
  async runDepreciation(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { financialPeriodId: string },
  ) {
    return this.assets.runDepreciation({
      companyId,
      actor,
      financialPeriodId: body.financialPeriodId,
    });
  }

  /** Same maker/approver tier — a disposal moves the ledger once approved too. */
  @Roles('FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @OwnedRecord('fixedAsset', 'id')
  @Post('assets/:id/dispose')
  async dispose(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { disposedOn: string },
  ) {
    return this.assets.dispose({
      assetId: id,
      actor,
      disposedOn: new Date(body.disposedOn),
    });
  }

  /** PCR-031 — machine hours logged per line for a period (all assets, or one). */
  @AnyRole('Hours behind a depreciation split are part of the register anyone reconciling PPE reads.')
  @Get('machine-hours')
  async machineHoursList(@CurrentCompany() companyId: string, @Query('periodId') periodId: string) {
    if (!periodId) throw new BadRequestException('periodId is required.');
    return this.assets.machineHours(companyId, periodId);
  }

  /**
   * PCR-031 by machine hours — a machine's hours on each line for a period.
   * Its depreciation that period is split by them when the run posts.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO', 'PRODUCTION_LEAD')
  @OwnedRecord('fixedAsset', 'id')
  @Post('assets/:id/machine-hours')
  async setMachineHours(
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { financialPeriodId: string; hours: Partial<Record<'SNAILPRO' | 'POULTRYPRO' | 'FEED_MILL', string | number>> },
  ) {
    if (!body?.financialPeriodId || typeof body.hours !== 'object' || body.hours === null) {
      throw new BadRequestException('financialPeriodId and hours are required.');
    }
    const hours: Partial<Record<ProductionOrderCycle, Decimal>> = {};
    for (const [cycle, value] of Object.entries(body.hours)) {
      if (!['SNAILPRO', 'POULTRYPRO', 'FEED_MILL'].includes(cycle)) {
        throw new BadRequestException(`${cycle} is not a processing line.`);
      }
      const text = String(value ?? '').trim() || '0';
      if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new BadRequestException(`Hours for ${cycle} must be a number such as 42.5.`);
      hours[cycle as ProductionOrderCycle] = new Decimal(text);
    }
    return this.assets.setMachineHours({ companyId, assetId: id, financialPeriodId: body.financialPeriodId, hours, actor });
  }

  /**
   * PCR-031 — which processing line a machine serves, so its depreciation
   * becomes that line's overhead. A costing decision, so the finance roles
   * that approve depreciation make it.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @OwnedRecord('fixedAsset', 'id')
  @Post('assets/:id/processing-line')
  async setProcessingLine(
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { processingCycle: string | null },
  ) {
    const cycle = body?.processingCycle ?? null;
    if (cycle !== null && !['SNAILPRO', 'POULTRYPRO', 'FEED_MILL'].includes(cycle)) {
      throw new BadRequestException('processingCycle must be SNAILPRO, POULTRYPRO, FEED_MILL or null.');
    }
    return this.assets.setProcessingCycle({
      companyId,
      assetId: id,
      processingCycle: cycle as ProductionOrderCycle | null,
      actor,
    });
  }
}
