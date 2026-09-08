import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { AnyRole, Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';
import { FarmConfigService } from './farm-config.service';

/** Roles that can already reach the web app's Settings screen — see `apps/web/src/lib/permissions.ts`'s BY_ROLE table for the `settings` section. */
const SETTINGS_ROLES = ['CFO', 'FARM_MANAGER', 'FINANCE_CONTROLLER', 'SYSTEM_ADMIN'] as const;

@Controller('company-config')
export class FarmConfigController {
  constructor(private readonly farmConfig: FarmConfigService) {}

  /**
   * Open to any signed-in role, not just the ones that can change it — the
   * config drives ordinary daily-round behaviour (collections per day,
   * whether a mortality photo is required) for every role, not only the
   * ones with a Settings screen to edit it from.
   */
  @AnyRole('Every role reads its own farm-behaviour config; only some can change it.')
  @Get()
  async get(@CurrentCompany() companyId: string) {
    return { overrides: await this.farmConfig.get(companyId) };
  }

  @Roles(...SETTINGS_ROLES)
  @Post()
  async save(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { overrides: unknown },
  ) {
    await this.farmConfig.save({ companyId, actor, overrides: body.overrides });
    return { ok: true };
  }

  @Roles(...SETTINGS_ROLES)
  @Delete()
  async reset(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor) {
    await this.farmConfig.reset({ companyId, actor });
    return { ok: true };
  }
}
