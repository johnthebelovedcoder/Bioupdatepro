import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrialBalanceService } from './trial-balance.service';
import { CurrentCompany } from '../auth/current-user.decorator';
import { Roles, AnyRole } from '../auth/roles.guard';

/**
 * Read-only reporting for the web app.
 *
 * Separate from the demo controller on purpose: that one is dev scaffolding
 * that can reset the database, and it is not registered in production. This is
 * product surface, behind the global auth guard like everything else.
 *
 * Every route here is scoped to the signed-in user's company, taken from
 * `@CurrentCompany()` and never from the request. It used to read `companyId`
 * off the query string, which meant any authenticated user could page through
 * another company's ledger by editing the URL — and the audit route carried no
 * company filter at all, so it returned every tenant's trail to anyone who
 * asked. Being signed in is not the same as being entitled to the row.
 */
@Controller('reporting')
export class ReportingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trialBalance: TrialBalanceService,
  ) {}

  /**
   * The organisation the signed-in user is working in: company, branches, and
   * the financial calendar. The web app needs this before it can ask for
   * anything else, because every query is scoped by company and period.
   */
  @AnyRole('The app shell calls this on every page. Gating it locks everyone out of the application rather than out of the ledger.')
  @Get('context')
  async context(@CurrentCompany() companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        baseCurrency: { select: { id: true, code: true, minorUnitScale: true } },
        branches: {
          where: { active: true },
          orderBy: { code: 'asc' },
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!company) return { company: null, branches: [], financialYears: [] };

    const financialYears = await this.prisma.financialYear.findMany({
      where: { companyId: company.id },
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        code: true,
        status: true,
        startDate: true,
        endDate: true,
        periods: {
          orderBy: { periodNumber: 'asc' },
          select: {
            id: true,
            periodNumber: true,
            name: true,
            status: true,
            startDate: true,
            endDate: true,
          },
        },
      },
    });

    return {
      company: {
        id: company.id,
        code: company.code,
        name: company.name,
        currency: company.baseCurrency,
      },
      branches: company.branches,
      financialYears,
    };
  }

  @Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Get('trial-balance')
  async trialBalanceReport(
    @CurrentCompany() companyId: string,
    @Query('financialYearId') financialYearId?: string,
    @Query('financialPeriodId') financialPeriodId?: string,
    @Query('branchId') branchId?: string,
    @Query('costCentreId') costCentreId?: string,
    @Query('farmId') farmId?: string,
  ) {
    return this.trialBalance.build({
      companyId,
      ...(financialYearId ? { financialYearId } : {}),
      ...(financialPeriodId ? { financialPeriodId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(costCentreId ? { costCentreId } : {}),
      ...(farmId ? { farmId } : {}),
    });
  }

  /**
   * The journal register. Paged, because a real ledger is not a list you scroll
   * — a year of production postings runs to tens of thousands of entries.
   */
  @Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Get('journals')
  async journals(
    @CurrentCompany() companyId: string,
    @Query('financialYearId') financialYearId?: string,
    @Query('financialPeriodId') financialPeriodId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
  ) {
    const pageSize = 25;
    const pageNumber = Math.max(1, Number(page) || 1);

    const where = {
      companyId,
      ...(financialYearId ? { financialYearId } : {}),
      ...(financialPeriodId ? { financialPeriodId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(search
        ? {
            OR: [
              { journalNumber: { contains: search, mode: 'insensitive' as const } },
              { narration: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, entries] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ journalDate: 'desc' }, { createdAt: 'desc' }],
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        include: {
          createdBy: { select: { fullName: true } },
          postedBy: { select: { fullName: true } },
          financialPeriod: { select: { name: true } },
          lines: {
            orderBy: { lineNumber: 'asc' },
            include: {
              glAccount: { select: { accountNumber: true, name: true } },
              costCentre: { select: { code: true } },
            },
          },
        },
      }),
    ]);

    return {
      total,
      page: pageNumber,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      entries: entries.map((entry) => ({
        id: entry.id,
        journalNumber: entry.journalNumber,
        journalDate: entry.journalDate,
        narration: entry.narration,
        status: entry.status,
        sourceModule: entry.sourceModule,
        sourceDocumentType: entry.sourceDocumentType,
        reversalOfId: entry.reversalOfId,
        period: entry.financialPeriod?.name ?? null,
        createdBy: entry.createdBy?.fullName ?? null,
        postedBy: entry.postedBy?.fullName ?? null,
        postedAt: entry.postedAt,
        totalDebitKobo: entry.lines.reduce((sum, line) => sum + line.debitKobo, 0n),
        totalCreditKobo: entry.lines.reduce((sum, line) => sum + line.creditKobo, 0n),
        lines: entry.lines.map((line) => ({
          lineNumber: line.lineNumber,
          accountNumber: line.glAccount.accountNumber,
          accountName: line.glAccount.name,
          costCentre: line.costCentre?.code ?? null,
          description: line.description,
          debitKobo: line.debitKobo,
          creditKobo: line.creditKobo,
        })),
      })),
    };
  }

  /**
   * The audit trail (Rule 9). Append-only at the database, so this is purely a
   * read — there is deliberately no endpoint that edits or deletes one.
   */
  @Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Get('audit')
  async audit(
    @CurrentCompany() companyId: string,
    @Query('module') module?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
  ) {
    const pageSize = 50;
    const pageNumber = Math.max(1, Number(page) || 1);

    const where = {
      companyId,
      ...(module ? { module } : {}),
      // `action` is an enum, so it is matched exactly rather than by substring.
      ...(search
        ? {
            OR: [
              { entityType: { contains: search, mode: 'insensitive' as const } },
              { comments: { contains: search, mode: 'insensitive' as const } },
              { entityId: { contains: search, mode: 'insensitive' as const } },
              { transactionId: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, records, modules] = await Promise.all([
      this.prisma.auditRecord.count({ where }),
      this.prisma.auditRecord.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { fullName: true } } },
      }),
      this.prisma.auditRecord.findMany({
        // Scoped too. The filter dropdown is a list of what this company has
        // done, not a directory of every module any tenant has ever touched.
        where: { companyId },
        distinct: ['module'],
        select: { module: true },
        orderBy: { module: 'asc' },
      }),
    ]);

    return {
      total,
      page: pageNumber,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      modules: modules.map((row) => row.module),
      records: records.map((record) => ({
        id: record.id,
        occurredAt: record.occurredAt,
        module: record.module,
        entityType: record.entityType,
        entityId: record.entityId,
        action: record.action,
        status: record.status,
        user: record.user?.fullName ?? 'System',
        ipAddress: record.ipAddress,
        device: record.device,
        comments: record.comments,
      })),
    };
  }

  /**
   * The money figures the dashboard leads with, from the ledger.
   *
   * These were invented — a fixture returning ₦4.8m of revenue against a farm
   * that had never posted a sale. Now that operations post, they can be read
   * from the accounts, and the honest answer is more useful than the flattering
   * one: this farm has millions tied up in living batches and has recognised no
   * revenue, because nothing has been sold AND approved yet. A dashboard that
   * showed otherwise would be the first place a farmer learned not to trust it.
   *
   * Work in progress is included because on a livestock farm it is the number
   * that matters — the cost of the animals currently alive, which is neither an
   * expense yet nor revenue, and is invisible on a normal P&L summary.
   */
  @Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR', 'FARM_MANAGER')
  @Get('money-summary')
  async moneySummary(@CurrentCompany() companyId: string) {
    const [revenue, expenses, receivables, workInProgress, finishedGoods] = await Promise.all([
      this.balanceOfType(companyId, 'REVENUE'),
      this.balanceOfType(companyId, 'EXPENSE'),
      this.balanceOfAccount(companyId, '1201'),
      this.balanceOfAccount(companyId, '1501'),
      this.balanceOfAccount(companyId, '1401'),
    ]);

    return {
      // Revenue is a credit balance, so its natural sign is negative in
      // debits-minus-credits terms. Flipped here so the screen can show it as
      // a positive amount earned.
      revenueKobo: (-revenue).toString(),
      expenseKobo: expenses.toString(),
      receivableKobo: receivables.toString(),
      workInProgressKobo: workInProgress.toString(),
      finishedGoodsKobo: finishedGoods.toString(),
    };
  }

  /** Net movement across every account of a type, in kobo. */
  private async balanceOfType(companyId: string, accountType: 'REVENUE' | 'EXPENSE') {
    const result = await this.prisma.journalLine.aggregate({
      where: {
        journalEntry: { companyId, status: 'POSTED' },
        glAccount: { companyId, accountType },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (result._sum.debitKobo ?? 0n) - (result._sum.creditKobo ?? 0n);
  }

  private async balanceOfAccount(companyId: string, accountNumber: string) {
    const result = await this.prisma.journalLine.aggregate({
      where: {
        journalEntry: { companyId, status: 'POSTED' },
        glAccount: { companyId, accountNumber },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (result._sum.debitKobo ?? 0n) - (result._sum.creditKobo ?? 0n);
  }

  /** Cost centres and farms, for the trial balance dimension filters. */
  @Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Get('dimensions')
  async dimensions(@CurrentCompany() companyId: string) {
    const [costCentres, farms] = await Promise.all([
      this.prisma.costCentre.findMany({
        where: { companyId, active: true },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.farm.findMany({
        where: { companyId, active: true },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return { costCentres, farms };
  }
}
