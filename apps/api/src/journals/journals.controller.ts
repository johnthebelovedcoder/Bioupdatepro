import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ManualJournalStatus, RecurrenceFrequency } from '@bioassetpro/database';
import { ManualJournalService } from './manual-journal.service';
import { RecurringJournalService } from './recurring-journal.service';
import { PartyLedgerService } from './party-ledger.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { kobo } from '../common/money';
import { CurrentCompany } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';

/**
 * §3 API surface.
 *
 * Note what is absent: there is no DELETE anywhere in this controller. §3 lists
 * the permitted operations as View, Create, Edit, Submit, Approve, Post,
 * Reverse, Export and Email, and states that Delete is "disabled entirely" —
 * so it is absent here and refused by a database trigger besides.
 */
@Controller('journal')
@Roles('FINANCIAL_CONTROLLER', 'FINANCE_MANAGER', 'MANAGING_DIRECTOR')
export class JournalsController {
  constructor(
    private readonly journals: ManualJournalService,
    private readonly recurring: RecurringJournalService,
    private readonly ledgers: PartyLedgerService,
  ) {}

  @Post('create')
  async create(
    @Body()
    body: {
      companyId: string;
      journalTypeCode: string;
      reasonCode?: string;
      reference: string;
      journalDate: string;
      narration: string;
      branchId: string;
      financialYearId: string;
      financialPeriodId: string;
      currencyId: string;
      exchangeRate?: string;
      customerId?: string;
      supplierId?: string;
      lines: Array<Record<string, unknown>>;
      actor: WorkflowActor;
    },
  ) {
    const journal = await this.journals.create({
      ...body,
      journalDate: new Date(body.journalDate),
      lines: body.lines.map((line) => ({
        glAccountId: String(line.glAccountId),
        description: String(line.description ?? ''),
        debit:
          line.debitKobo !== undefined && line.debitKobo !== null
            ? kobo(BigInt(String(line.debitKobo)))
            : undefined,
        credit:
          line.creditKobo !== undefined && line.creditKobo !== null
            ? kobo(BigInt(String(line.creditKobo)))
            : undefined,
        departmentId: (line.departmentId as string) ?? null,
        costCentreId: (line.costCentreId as string) ?? null,
        farmId: (line.farmId as string) ?? null,
        penHouseId: (line.penHouseId as string) ?? null,
        projectId: (line.projectId as string) ?? null,
        customerId: (line.customerId as string) ?? null,
        supplierId: (line.supplierId as string) ?? null,
        employeeId: (line.employeeId as string) ?? null,
        itemId: (line.itemId as string) ?? null,
      })),
    });

    return {
      id: journal.id,
      reference: journal.reference,
      status: journal.status,
      lineCount: journal.lines.length,
    };
  }

  @Post('submit')
  async submit(
    @Body() body: { manualJournalId: string; actor: WorkflowActor; comments?: string },
  ) {
    return this.journals.submit(body);
  }

  @Post('reverse')
  async reverse(
    @Body()
    body: {
      manualJournalId: string;
      reference: string;
      journalDate: string;
      reasonCode?: string;
      actor: WorkflowActor;
    },
  ) {
    const reversal = await this.journals.createReversal({
      ...body,
      journalDate: new Date(body.journalDate),
    });
    return {
      id: reversal.id,
      reference: reversal.reference,
      status: reversal.status,
      reversalOfId: reversal.reversalOfId,
    };
  }

  @Post('cancel')
  async cancel(
    @Body() body: { manualJournalId: string; actor: WorkflowActor; reason: string },
  ) {
    return this.journals.cancel(body);
  }

  @Get('register')
  async register(
    @CurrentCompany() companyId: string,
    @Query('status') status?: ManualJournalStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('journalTypeCode') journalTypeCode?: string,
  ) {
    return this.journals.register({
      companyId,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      journalTypeCode,
    });
  }

  // --- Recurring ----------------------------------------------------------

  @Post('recurring')
  async createRecurring(
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      journalTypeCode: string;
      code: string;
      name: string;
      narration: string;
      branchId: string;
      currencyId: string;
      frequency: RecurrenceFrequency;
      dayOfMonth: number;
      startDate: string;
      endDate?: string;
      lines: Array<Record<string, unknown>>;
      actorId: string;
    },
  ) {
    return this.recurring.create({
      ...body,
      companyId,
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : null,
      lines: body.lines.map((line) => ({
        glAccountId: String(line.glAccountId),
        description: String(line.description ?? ''),
        debitKobo:
          line.debitKobo !== undefined ? BigInt(String(line.debitKobo)) : undefined,
        creditKobo:
          line.creditKobo !== undefined ? BigInt(String(line.creditKobo)) : undefined,
        costCentreId: (line.costCentreId as string) ?? null,
      })),
    });
  }

  @Post('recurring/generate')
  async generateRecurring(
    @CurrentCompany() companyId: string,
    @Body() body: { actorId: string; now?: string },
  ) {
    return this.recurring.generateDue({
      companyId,
      actorId: body.actorId,
      now: body.now ? new Date(body.now) : new Date(),
    });
  }

  // --- Party ledgers (§3, §6) ---------------------------------------------

  @Get('customer-adjustments')
  async customerStatement(
    @Query('customerId') customerId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.ledgers.customerStatement({
      customerId,
      from: new Date(from),
      to: new Date(to),
    });
  }

  @Get('supplier-adjustments')
  async supplierStatement(
    @Query('supplierId') supplierId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.ledgers.supplierStatement({
      supplierId,
      from: new Date(from),
      to: new Date(to),
    });
  }

  @Get('customer-ageing')
  async customerAgeing(
    @CurrentCompany() companyId: string,
    @Query('asAt') asAt?: string,
  ) {
    return this.ledgers.customerAgeing({
      companyId,
      asAt: asAt ? new Date(asAt) : new Date(),
    });
  }
}
