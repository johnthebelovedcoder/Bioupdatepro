import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import Decimal from 'decimal.js';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';
import { FarmCostAllocationService, type AllocationBasis } from './farm-cost-allocation.service';
import { TimesheetService } from './timesheet.service';
import { PrismaService } from '../prisma/prisma.service';

/** Whole kobo from the wire, where money travels as a string. */
function koboOf(value: string | number | undefined, what: string): bigint {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new BadRequestException(`${what} must be a whole number of kobo.`);
  return BigInt(text);
}

function basisOf(value: string | undefined): AllocationBasis {
  if (value === undefined || value === '' || value === 'ANIMAL_DAYS') return 'ANIMAL_DAYS';
  if (value === 'HOURS') return 'HOURS';
  throw new BadRequestException('basis must be ANIMAL_DAYS or HOURS.');
}

function dayOf(value: string | undefined, what: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new BadRequestException(`${what} must be a date, YYYY-MM-DD.`);
  return new Date(`${value}T00:00:00.000Z`);
}

/** PCR-028 / PCR-043 / PCR-064 — farm labour and overhead, by animal-days or by timesheet hours. */
@Controller('cost-allocation')
@Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class FarmCostAllocationController {
  constructor(
    private readonly allocations: FarmCostAllocationService,
    private readonly timesheets: TimesheetService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@CurrentCompany() companyId: string) {
    return this.allocations.list(companyId);
  }

  @Get('sources')
  async sources(@CurrentCompany() companyId: string, @Query('periodId') periodId: string) {
    if (!periodId) throw new BadRequestException('periodId is required.');
    return this.allocations.sources(companyId, periodId);
  }

  @Get('preview')
  async preview(
    @CurrentCompany() companyId: string,
    @Query('periodId') periodId: string,
    @Query('totalKobo') totalKobo: string,
    @Query('basis') basis?: string,
  ) {
    if (!periodId) throw new BadRequestException('periodId is required.');
    return this.allocations.preview(companyId, periodId, koboOf(totalKobo ?? '0', 'totalKobo'), basisOf(basis));
  }

  /** Moves cost between accounts, so only the roles that can reverse a journal may post one. */
  @Roles('FINANCE_CONTROLLER', 'CFO')
  @Post()
  async post(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      financialPeriodId: string;
      basis?: string;
      sources: Array<{ glAccountId: string; costCentreId?: string | null; amountKobo: string }>;
    },
  ) {
    if (!body?.financialPeriodId || !Array.isArray(body.sources)) {
      throw new BadRequestException('financialPeriodId and sources are required.');
    }
    return this.allocations.post({
      companyId,
      financialPeriodId: body.financialPeriodId,
      basis: basisOf(body.basis),
      sources: body.sources.map((s) => ({
        glAccountId: s.glAccountId,
        costCentreId: s.costCentreId ?? null,
        amountKobo: koboOf(s.amountKobo, 'amountKobo'),
      })),
      actor,
    });
  }

  /* --- Timesheets ----------------------------------------------------- */

  /** Hours logged between two dates, newest first. Whoever keeps the farm's time can see them. */
  @Roles('PRODUCTION_SUPERVISOR', 'FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Get('timesheets')
  async timesheetList(@CurrentCompany() companyId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.timesheets.list(companyId, dayOf(from, 'from'), dayOf(to, 'to'));
  }

  /** What the timesheet form picks from: staff, and the batches alive now. */
  @Roles('PRODUCTION_SUPERVISOR', 'FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Get('timesheets/choices')
  async timesheetChoices(@CurrentCompany() companyId: string) {
    const [employees, groups] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId, employmentStatus: { in: ['PROBATION', 'ACTIVE'] } },
        orderBy: [{ firstName: 'asc' }, { surname: 'asc' }],
        select: { id: true, employeeNumber: true, firstName: true, surname: true },
      }),
      this.prisma.livestockGroup.findMany({
        where: { companyId, status: 'ACTIVE' },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, speciesKey: true },
      }),
    ]);
    return {
      employees: employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.surname}`.trim(), number: e.employeeNumber })),
      groups,
    };
  }

  @Roles('PRODUCTION_SUPERVISOR', 'FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('timesheets')
  async timesheetRecord(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { employeeId: string; groupId: string; workDate: string; hours: string | number; notes?: string },
  ) {
    const hours = String(body?.hours ?? '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(hours)) throw new BadRequestException('hours must be a number such as 7.5.');
    if (!body.employeeId || !body.groupId) throw new BadRequestException('employeeId and groupId are required.');
    return this.timesheets.record({
      companyId,
      employeeId: body.employeeId,
      groupId: body.groupId,
      workDate: dayOf(body.workDate, 'workDate'),
      hours: new Decimal(hours),
      notes: body.notes?.trim() || null,
      actor,
    });
  }

  /** Approve hours so they count. The people who run the farm and its money approve; a supervisor logs. */
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('timesheets/approve')
  async timesheetApprove(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { ids: string[] },
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) throw new BadRequestException('ids is required.');
    return this.timesheets.approve({ companyId, ids: body.ids, actor });
  }

  @Roles('PRODUCTION_SUPERVISOR', 'FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('timesheets/:id/delete')
  async timesheetRemove(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.timesheets.remove(companyId, id);
  }
}
