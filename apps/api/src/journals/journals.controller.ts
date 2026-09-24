import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ManualJournalStatus, RecurrenceFrequency, RecurringJournalBasis } from '@bioassetpro/database';
import { ManualJournalService } from './manual-journal.service';
import { RecurringJournalService } from './recurring-journal.service';
import { PartyLedgerService } from './party-ledger.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { kobo } from '../common/money';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/roles.guard';

/**
 * §3 API surface.
 *
 * Note what is absent: there is no DELETE anywhere in this controller. §3 lists
 * the permitted operations as View, Create, Edit, Submit, Approve, Post,
 * Reverse, Export and Email, and states that Delete is "disabled entirely" —
 * so it is absent here and refused by a database trigger besides.
 */
// FARM_ACCOUNTANT (ROL-012) is the RACI sheet's actual preparer of a manual
// journal — "Manual journals require approval" names them as the one being
// approved, not the approver. Everything here is create/submit/reverse or a
// read; approval itself happens through WorkflowController, not here.
@Controller('journal')
@Roles('FINANCE_CONTROLLER', 'FINANCE_MANAGER', 'FARM_ACCOUNTANT', 'CFO')
export class JournalsController {
  constructor(
    private readonly journals: ManualJournalService,
    private readonly recurring: RecurringJournalService,
    private readonly ledgers: PartyLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  /*
   * Who is acting, and for which company, comes from the verified session —
   * never the body. These routes used to accept a whole `actor` object, roles
   * and all, from the request: anyone who could reach them could raise,
   * submit, reverse or cancel a journal as somebody else, which is the one
   * thing maker-checker exists to stop. An `actor` or `companyId` still sent
   * by an older client is ignored rather than refused.
   */

  /** A journal named in the body must be this company's. 404, as the ownership guard does. */
  private async assertOwnJournal(companyId: string, manualJournalId: string) {
    const journal =
      typeof manualJournalId === 'string' && manualJournalId
        ? await this.prisma.manualJournal
            .findFirst({ where: { id: manualJournalId, companyId }, select: { id: true } })
            .catch(() => null)
        : null;
    if (!journal) throw new NotFoundException('No such journal.');
  }

  @Post('create')
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      companyId?: string;
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
      actor?: unknown;
    },
  ) {
    const journal = await this.journals.create({
      ...body,
      companyId,
      actor,
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
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { manualJournalId: string; comments?: string },
  ) {
    await this.assertOwnJournal(companyId, body.manualJournalId);
    return this.journals.submit({
      manualJournalId: body.manualJournalId,
      comments: body.comments,
      actor,
    });
  }

  @Post('reverse')
  async reverse(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      manualJournalId: string;
      reference: string;
      journalDate: string;
      reasonCode?: string;
    },
  ) {
    await this.assertOwnJournal(companyId, body.manualJournalId);
    const reversal = await this.journals.createReversal({
      manualJournalId: body.manualJournalId,
      reference: body.reference,
      reasonCode: body.reasonCode,
      actor,
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
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { manualJournalId: string; reason: string },
  ) {
    await this.assertOwnJournal(companyId, body.manualJournalId);
    return this.journals.cancel({
      manualJournalId: body.manualJournalId,
      reason: body.reason,
      actor,
    });
  }

  /** Active reason codes this company has configured — the create-journal form's picker needs them. */
  @Get('reason-codes')
  async reasonCodes(@CurrentCompany() companyId: string) {
    return this.journals.listReasonCodes(companyId);
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

  /** Every recurring-journal template this company has — the web app's own list needs it. */
  @Get('recurring')
  async listRecurring(@CurrentCompany() companyId: string) {
    return this.recurring.listTemplates(companyId);
  }

  @Post('recurring')
  async createRecurring(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
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
      basis?: RecurringJournalBasis;
      startDate: string;
      endDate?: string;
      lines: Array<Record<string, unknown>>;
      actorId?: string;
    },
  ) {
    return this.recurring.create({
      ...body,
      companyId,
      actorId: actor.userId,
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
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { now?: string },
  ) {
    return this.recurring.generateDue({
      companyId,
      actorId: actor.userId,
      now: body.now ? new Date(body.now) : new Date(),
    });
  }

  // --- Party ledgers (§3, §6) ---------------------------------------------

  /*
   * The party is named in the query, where the ownership guard cannot see it,
   * so it is checked here: unchecked, these returned any company's customer
   * or supplier statement to anyone who had its id.
   */
  @Get('customer-adjustments')
  async customerStatement(
    @CurrentCompany() companyId: string,
    @Query('customerId') customerId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const customer = await this.prisma.customer
      .findFirst({ where: { id: customerId, companyId }, select: { id: true } })
      .catch(() => null);
    if (!customer) throw new NotFoundException('No such customer.');
    return this.ledgers.customerStatement({
      customerId,
      from: new Date(from),
      to: new Date(to),
    });
  }

  @Get('supplier-adjustments')
  async supplierStatement(
    @CurrentCompany() companyId: string,
    @Query('supplierId') supplierId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const supplier = await this.prisma.supplier
      .findFirst({ where: { id: supplierId, companyId }, select: { id: true } })
      .catch(() => null);
    if (!supplier) throw new NotFoundException('No such supplier.');
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
