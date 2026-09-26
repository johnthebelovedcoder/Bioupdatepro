import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';
import { LeaveService } from './leave.service';

const HR_ROLES = ['FARM_MANAGER', 'FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO', 'ADMINISTRATOR', 'HR_OFFICER', 'HR_MANAGER'] as const;
const APPROVER_ROLES = ['FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO', 'ADMINISTRATOR', 'HR_MANAGER'] as const;

/** Leave (SOP-038, RPT-HR-007, AC-HR-003). */
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Roles(...HR_ROLES)
  @Get('policy')
  async policy(@CurrentCompany() companyId: string) {
    return this.leave.policy(companyId);
  }

  @Roles('CFO', 'ADMINISTRATOR', 'HR_MANAGER')
  @Post('policy')
  async setPolicy(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Body() body: Record<string, number>) {
    return this.leave.setPolicy({ companyId, values: body ?? {}, actor });
  }

  @Roles(...HR_ROLES)
  @Get('requests')
  async list(@CurrentCompany() companyId: string, @Query('status') status?: string) {
    return this.leave.list(companyId, status || undefined);
  }

  @Roles(...HR_ROLES)
  @Post('requests')
  async request(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { employeeId: string; type: string; startDate: string; endDate: string; reason: string; handover?: string; evidenceReference?: string },
  ) {
    const leave = await this.leave.request({
      companyId,
      employeeId: String(body?.employeeId ?? ''),
      type: String(body?.type ?? ''),
      startDate: new Date(String(body?.startDate ?? '')),
      endDate: new Date(String(body?.endDate ?? '')),
      reason: String(body?.reason ?? ''),
      handover: body?.handover,
      evidenceReference: body?.evidenceReference,
      actor,
    });
    return { id: leave.id, status: leave.status, workingDays: leave.workingDays, payPercent: leave.payPercent };
  }

  @Roles(...APPROVER_ROLES)
  @Post('requests/:id/decide')
  async decide(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Param('id') id: string, @Body() body: { approve: boolean; note?: string }) {
    const decided = await this.leave.decide({ companyId, leaveId: id, approve: body?.approve === true, note: body?.note, actor });
    return { id: decided.id, status: decided.status };
  }

  @Roles(...HR_ROLES)
  @Post('requests/:id/cancel')
  async cancel(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Param('id') id: string, @Body() body: { note?: string }) {
    const cancelled = await this.leave.cancel({ companyId, leaveId: id, note: body?.note, actor });
    return { id: cancelled.id, status: cancelled.status };
  }

  /** RPT-HR-007: opening, earned, taken, closing and liability. */
  @Roles(...HR_ROLES)
  @Get('balances')
  async balances(@CurrentCompany() companyId: string, @Query('asOf') asOf?: string) {
    return this.leave.balances(companyId, asOf ? new Date(asOf) : new Date());
  }
}
