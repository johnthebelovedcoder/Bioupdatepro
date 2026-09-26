import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentCompany } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { TraceabilityService } from './traceability.service';

const TRACE_ROLES = [
  'FARM_MANAGER', 'FARM_ACCOUNTANT', 'STOREKEEPER', 'PRODUCTION_LEAD', 'SALES_OFFICER',
  'PRODUCTION_SUPERVISOR', 'SNAIL_SUPERVISOR', 'POULTRY_SUPERVISOR',
  'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'CFO',
] as const;

/** Lot traceability (AC-011): one query, and the same trace as a file. */
@Controller('traceability')
export class TraceabilityController {
  constructor(private readonly traceability: TraceabilityService) {}

  @Roles(...TRACE_ROLES)
  @Get()
  async trace(@CurrentCompany() companyId: string, @Query('reference') reference = '') {
    return this.traceability.trace(companyId, reference);
  }

  @Roles(...TRACE_ROLES)
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="trace.csv"')
  async export(@CurrentCompany() companyId: string, @Query('reference') reference = ''): Promise<string> {
    const { tree } = await this.traceability.trace(companyId, reference);
    const cell = (value: string | number) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = TraceabilityService.toRows(tree);
    return [
      ['Depth', 'Step', 'Description', 'Reference', 'Date', 'Quantity', 'Details'].join(','),
      ...rows.map((r) => [r.depth, r.kind, r.title, r.reference, r.date, r.quantity, r.details].map(cell).join(',')),
    ].join('\n');
  }
}
