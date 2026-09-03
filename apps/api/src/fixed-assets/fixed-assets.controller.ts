import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FixedAssetService } from './fixed-asset.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
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
}
