import { Controller, Get } from '@nestjs/common';
import { CurrentCompany } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { RetentionService } from './retention.service';

/** The record retention schedule and what the company holds against it. Read-only. */
@Controller('retention')
@Roles('ADMINISTRATOR', 'CFO', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'EXTERNAL_AUDITOR')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  async report(@CurrentCompany() companyId: string) {
    return this.retention.report(companyId);
  }
}
