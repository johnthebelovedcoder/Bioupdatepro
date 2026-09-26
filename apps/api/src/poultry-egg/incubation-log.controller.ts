import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IncubationReadingKind } from '@bioassetpro/database';
import { IncubationLogService } from './incubation-log.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { AnyRole, Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

const RECORDERS = ['FARM_MANAGER', 'FARM_ATTENDANT', 'POULTRY_SUPERVISOR', 'PRODUCTION_SUPERVISOR', 'PRODUCTION_LEAD', 'QA_OFFICER', 'CFO'];
const SUPERVISORS = ['FARM_MANAGER', 'POULTRY_SUPERVISOR', 'PRODUCTION_SUPERVISOR', 'PRODUCTION_LEAD', 'QA_OFFICER', 'CFO'];

/** The incubation log: readings, candling and exceptions (FR-LIFE-04). */
@Controller('poultry/incubation-log')
export class IncubationLogController {
  constructor(private readonly log: IncubationLogService) {}

  @AnyRole('How the setters are running is hatchery information everyone on the farm uses.')
  @Get()
  async overview(@CurrentCompany() companyId: string) {
    return this.log.overview(companyId);
  }

  @AnyRole('Incubators and what is in them are hatchery information.')
  @Get('incubators')
  async incubators(@CurrentCompany() companyId: string) {
    return this.log.incubators(companyId);
  }

  @Roles(...SUPERVISORS)
  @Post('incubators')
  async saveIncubator(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { code: string; name: string; capacityEggs: number; active?: boolean },
  ) {
    return this.log.saveIncubator({
      companyId,
      code: String(body?.code ?? ''),
      name: String(body?.name ?? ''),
      capacityEggs: Number(body?.capacityEggs),
      active: body?.active !== false,
      actor,
    });
  }

  @AnyRole('The incubation standard is shared hatchery information.')
  @Get('standard')
  async standard(@CurrentCompany() companyId: string) {
    return this.log.standard(companyId);
  }

  @Roles(...SUPERVISORS)
  @Post('standard')
  async setStandard(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { minTemperatureC: string; maxTemperatureC: string; minHumidityPercent: string; maxHumidityPercent: string; readingIntervalHours: number },
  ) {
    return this.log.setStandard({ companyId, ...body, readingIntervalHours: Number(body?.readingIntervalHours), actor });
  }

  @AnyRole('A batch’s readings are hatchery information.')
  @Get('batches/:id')
  async readings(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.log.readings(companyId, id);
  }

  @Roles(...RECORDERS)
  @Post('batches/:id/readings')
  async record(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body()
    body: {
      kind: 'ENVIRONMENT' | 'CANDLING';
      readAt?: string;
      temperatureC?: string;
      humidityPercent?: string;
      turned?: boolean;
      fertileCount?: number;
      clearCount?: number;
      deadInShellCount?: number;
      note?: string;
    },
  ) {
    if (body?.kind !== 'ENVIRONMENT' && body?.kind !== 'CANDLING') throw new BadRequestException('kind is ENVIRONMENT or CANDLING.');
    const readAt = body.readAt ? new Date(body.readAt) : new Date();
    if (Number.isNaN(readAt.getTime())) throw new BadRequestException('readAt must be a date and time.');
    const n = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
    return this.log.record({
      companyId,
      incubationBatchId: id,
      kind: body.kind as IncubationReadingKind,
      readAt,
      temperatureC: body.temperatureC ?? null,
      humidityPercent: body.humidityPercent ?? null,
      turned: body.turned ?? null,
      fertileCount: n(body.fertileCount),
      clearCount: n(body.clearCount),
      deadInShellCount: n(body.deadInShellCount),
      note: body.note ?? null,
      actor,
    });
  }

  @Roles(...SUPERVISORS)
  @Post('readings/:id/acknowledge')
  async acknowledge(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { actionTaken: string },
  ) {
    return this.log.acknowledge({ companyId, readingId: id, actionTaken: String(body?.actionTaken ?? ''), actor });
  }
}
