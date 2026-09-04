import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { TrialBalanceService } from './trial-balance.service';
import { ProfitLossService } from './profit-loss.service';
import { BalanceSheetService } from './balance-sheet.service';
import { CashFlowService } from './cash-flow.service';
import { KpiService } from './kpi.service';
import { ControlAccountReconciliationService } from './control-account-reconciliation.service';
import { CustomerReceiptService } from '../sales/customer-receipt.service';
import { SupplierPaymentService } from '../procurement/supplier-payment.service';
import { PostingService } from '../posting/posting.service';
import { PostingControlChecksService } from '../posting-control/posting-control-checks.service';
import { AuditService } from '../audit/audit.service';
import { currentFinancialYearId, currentFinancialPeriodId } from './current-financial-year';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles, AnyRole } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

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
    private readonly profitLoss: ProfitLossService,
    private readonly balanceSheet: BalanceSheetService,
    private readonly cashFlow: CashFlowService,
    private readonly kpis: KpiService,
    private readonly customerReceipts: CustomerReceiptService,
    private readonly supplierPayments: SupplierPaymentService,
    private readonly controlReconciliation: ControlAccountReconciliationService,
    private readonly posting: PostingService,
    private readonly postingControlChecks: PostingControlChecksService,
    private readonly auditService: AuditService,
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

  // INTERNAL_AUDITOR (ROL-016) is explicitly read-only over "controls, audit
  // trail and traceability" — the reports below are exactly that. FARM_ACCOUNTANT
  // (ROL-012) reads the same reports to reconcile against them, without gaining
  // any ability to post or approve.
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
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
   * US-897-033's export criterion — "does not change source calculations" —
   * taken literally: this calls the exact same `TrialBalanceService.build()`
   * the screen above does, under the same filters, and serialises the same
   * rows. No second computation path that could quietly disagree with the
   * first.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('trial-balance/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="trial-balance.csv"')
  async trialBalanceExport(
    @CurrentCompany() companyId: string,
    @Query('financialYearId') financialYearId?: string,
    @Query('financialPeriodId') financialPeriodId?: string,
    @Query('branchId') branchId?: string,
    @Query('costCentreId') costCentreId?: string,
    @Query('farmId') farmId?: string,
  ): Promise<string> {
    const tb = await this.trialBalance.build({
      companyId,
      ...(financialYearId ? { financialYearId } : {}),
      ...(financialPeriodId ? { financialPeriodId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(costCentreId ? { costCentreId } : {}),
      ...(farmId ? { farmId } : {}),
    });
    const header = ['Account Number', 'Account Name', 'Account Type', 'Debit (kobo)', 'Credit (kobo)', 'Balance (kobo)'];
    const rows = tb.rows.map((r) => [
      r.accountNumber,
      csvCell(r.accountName),
      r.accountType,
      r.totalDebitKobo.toString(),
      r.totalCreditKobo.toString(),
      r.displayedBalanceKobo.toString(),
    ]);
    rows.push(['', '', '', tb.totalDebitKobo.toString(), tb.totalCreditKobo.toString(), '']);
    return [header, ...rows].map((row) => row.join(',')).join('\r\n');
  }

  /**
   * US-897-033/037's own "drill-through reaches the underlying transaction"
   * criterion — the one gap CSV export didn't touch. Same filters as the TB
   * screen above, plus which row's account to open up.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('trial-balance/drill-through')
  async trialBalanceDrillThrough(
    @CurrentCompany() companyId: string,
    @Query('accountNumber') accountNumber: string,
    @Query('financialYearId') financialYearId?: string,
    @Query('financialPeriodId') financialPeriodId?: string,
    @Query('branchId') branchId?: string,
    @Query('costCentreId') costCentreId?: string,
    @Query('farmId') farmId?: string,
    @Query('page') page = '1',
  ) {
    if (!accountNumber) {
      throw new NotFoundException('accountNumber query parameter is required.');
    }
    return this.trialBalance.drillThrough(
      accountNumber,
      {
        companyId,
        ...(financialYearId ? { financialYearId } : {}),
        ...(financialPeriodId ? { financialPeriodId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(costCentreId ? { costCentreId } : {}),
        ...(farmId ? { farmId } : {}),
      },
      Math.max(1, Number(page) || 1),
    );
  }

  /**
   * Revenue, cost of sales and operating expense for a period — defaulting to
   * the current financial year to date when neither is named, since "how has
   * this year gone so far" is the question this screen exists to answer.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('profit-loss')
  async profitLossReport(
    @CurrentCompany() companyId: string,
    @Query('financialYearId') financialYearId?: string,
    @Query('financialPeriodId') financialPeriodId?: string,
    @Query('branchId') branchId?: string,
    @Query('costCentreId') costCentreId?: string,
    @Query('farmId') farmId?: string,
  ) {
    const defaultYearId =
      !financialYearId && !financialPeriodId
        ? await currentFinancialYearId(this.prisma, companyId)
        : undefined;

    return this.profitLoss.build({
      companyId,
      ...(financialYearId ? { financialYearId } : {}),
      ...(financialPeriodId ? { financialPeriodId } : {}),
      ...(defaultYearId ? { financialYearId: defaultYearId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(costCentreId ? { costCentreId } : {}),
      ...(farmId ? { farmId } : {}),
    });
  }

  /** Same "second serialisation of the same build() call" pattern as the
   * trial balance export — US-897-033's export criterion extended past its
   * first, trial-balance-only slice. */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('profit-loss/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="profit-and-loss.csv"')
  async profitLossExport(
    @CurrentCompany() companyId: string,
    @Query('financialYearId') financialYearId?: string,
    @Query('financialPeriodId') financialPeriodId?: string,
    @Query('branchId') branchId?: string,
    @Query('costCentreId') costCentreId?: string,
    @Query('farmId') farmId?: string,
  ): Promise<string> {
    const defaultYearId =
      !financialYearId && !financialPeriodId
        ? await currentFinancialYearId(this.prisma, companyId)
        : undefined;

    const pl = await this.profitLoss.build({
      companyId,
      ...(financialYearId ? { financialYearId } : {}),
      ...(financialPeriodId ? { financialPeriodId } : {}),
      ...(defaultYearId ? { financialYearId: defaultYearId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(costCentreId ? { costCentreId } : {}),
      ...(farmId ? { farmId } : {}),
    });
    const header = ['Section', 'Account Number', 'Account Name', 'Amount (kobo)'];
    const lineRows = (section: string, lines: Array<{ accountNumber: string; accountName: string; amountKobo: string }>) =>
      lines.map((l) => [section, l.accountNumber, csvCell(l.accountName), l.amountKobo]);
    const rows = [
      ...lineRows('Revenue', pl.revenueLines),
      ...lineRows('Cost of Sales', pl.costOfSalesLines),
      ...lineRows('Operating Expense', pl.operatingExpenseLines),
      ['Total Revenue', '', '', pl.revenueKobo],
      ['Total Cost of Sales', '', '', pl.costOfSalesKobo],
      ['Gross Profit', '', '', pl.grossProfitKobo],
      ['Total Operating Expense', '', '', pl.operatingExpenseKobo],
      ['Profit Before Tax', '', '', pl.profitBeforeTaxKobo],
    ];
    return [header, ...rows].map((row) => row.join(',')).join('\r\n');
  }

  /**
   * Assets, liabilities and equity as at now — permanent accounts, so there is
   * no period/year filter here at all, only the dimension filters trial
   * balance already supports.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('balance-sheet')
  async balanceSheetReport(
    @CurrentCompany() companyId: string,
    @Query('branchId') branchId?: string,
    @Query('costCentreId') costCentreId?: string,
    @Query('farmId') farmId?: string,
  ) {
    return this.balanceSheet.build({
      companyId,
      ...(branchId ? { branchId } : {}),
      ...(costCentreId ? { costCentreId } : {}),
      ...(farmId ? { farmId } : {}),
    });
  }

  /** Same pattern again — the same `BalanceSheetService.build()` call the
   * screen above uses, serialised a second way rather than recomputed. */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('balance-sheet/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="balance-sheet.csv"')
  async balanceSheetExport(
    @CurrentCompany() companyId: string,
    @Query('branchId') branchId?: string,
    @Query('costCentreId') costCentreId?: string,
    @Query('farmId') farmId?: string,
  ): Promise<string> {
    const bs = await this.balanceSheet.build({
      companyId,
      ...(branchId ? { branchId } : {}),
      ...(costCentreId ? { costCentreId } : {}),
      ...(farmId ? { farmId } : {}),
    });
    const header = ['Section', 'Account Number', 'Account Name', 'Amount (kobo)'];
    const lineRows = (section: string, lines: Array<{ accountNumber: string; accountName: string; amountKobo: string }>) =>
      lines.map((l) => [section, l.accountNumber, csvCell(l.accountName), l.amountKobo]);
    const rows = [
      ...lineRows('Asset', bs.assets),
      ...lineRows('Liability', bs.liabilities),
      ...lineRows('Equity', bs.equity),
      ['Equity', '', 'Current Year Earnings (unclosed)', bs.currentYearEarningsKobo],
      ['Total Assets', '', '', bs.totalAssetsKobo],
      ['Total Liabilities', '', '', bs.totalLiabilitiesKobo],
      ['Total Equity', '', '', bs.totalEquityKobo],
      ['Total Liabilities + Equity', '', '', bs.totalLiabilitiesAndEquityKobo],
    ];
    return [header, ...rows].map((row) => row.join(',')).join('\r\n');
  }

  /**
   * Cash flow for one period, indirect method — defaulting to the current
   * period when none is named.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('cash-flow')
  async cashFlowReport(
    @CurrentCompany() companyId: string,
    @Query('financialPeriodId') financialPeriodId?: string,
  ) {
    const periodId = financialPeriodId ?? (await currentFinancialPeriodId(this.prisma, companyId));
    if (!periodId) {
      return { error: 'No financial period covers today for this company.' };
    }
    return this.cashFlow.build({ companyId, financialPeriodId: periodId });
  }

  /** Cash Flow has no line-item array — a flat set of named figures — so its
   * CSV is one label/value row per figure, in the same order the statement
   * presents them, rather than the multi-section shape the other exports use. */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('cash-flow/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="cash-flow.csv"')
  async cashFlowExport(
    @CurrentCompany() companyId: string,
    @Query('financialPeriodId') financialPeriodId?: string,
  ): Promise<string> {
    const periodId = financialPeriodId ?? (await currentFinancialPeriodId(this.prisma, companyId));
    if (!periodId) {
      return 'Line Item,Amount (kobo)\r\nError,No financial period covers today for this company.';
    }
    const cf = await this.cashFlow.build({ companyId, financialPeriodId: periodId });
    const header = ['Line Item', 'Amount (kobo)'];
    const rows = [
      ['Opening Cash', cf.openingCashKobo],
      ['Net Income', cf.netIncomeKobo],
      ['Depreciation Add-back', cf.depreciationAddBackKobo],
      ['Receivables Change', cf.receivablesChangeKobo],
      ['Inventory Change', cf.inventoryChangeKobo],
      ['Payables Change', cf.payablesChangeKobo],
      ['Net Cash From Operations', cf.netCashFromOperationsKobo],
      ['Fixed Asset Acquisitions', cf.fixedAssetAcquisitionsKobo],
      ['Net Cash From Investing', cf.netCashFromInvestingKobo],
      ['Net Change In Cash', cf.netChangeInCashKobo],
      ['Closing Cash', cf.closingCashKobo],
      ['Bank Account Closing Balance', cf.bankAccountClosingKobo],
      ['Reconciled', cf.reconciled ? 'true' : 'false'],
    ];
    return [header, ...rows].map((row) => row.join(',')).join('\r\n');
  }

  /**
   * The nine named KPIs, each computed or explicitly refused with a reason —
   * never a guessed number for one this chart cannot yet support. `farmId`
   * scopes the four production-side KPIs (survival/mortality/yield/cost
   * variance) plus gross margin to one farm; `financialYearId` scopes gross
   * margin and payroll cost/head to one year. DSO/DPO/asset utilisation
   * stay company-wide/current-year — see `KpiService.build()`'s own comment.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('kpis')
  async kpiReport(
    @CurrentCompany() companyId: string,
    @Query('farmId') farmId?: string,
    @Query('financialYearId') financialYearId?: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.kpis.build(companyId, farmId, financialYearId, groupId);
  }

  /**
   * US-897-034's governance criterion: each KPI's meaning as an inspectable
   * row (numerator/denominator/formula/source/dimensions), not only a code
   * comment. Seeded from `KpiService`'s own doc comments, not invented —
   * `formula` describes what the code does rather than being a second
   * computation path that could drift from it.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('kpi-definitions')
  async kpiDefinitions(@CurrentCompany() companyId: string) {
    return this.prisma.kpiDefinition.findMany({
      where: { companyId, active: true },
      orderBy: { key: 'asc' },
    });
  }

  /**
   * US-897-033's own governance criterion: purpose/owner/frequency/source/
   * filters/measures for every report this company can run, as real,
   * inspectable rows — the web app's own reports index now reads this
   * instead of its old hardcoded array, so this is a real consumer, not
   * scope built ahead of one.
   */
  @AnyRole('Every signed-in user needs to know what reports exist before they can ask for one.')
  @Get('catalogue')
  async reportCatalogue(@CurrentCompany() companyId: string) {
    return this.prisma.reportDefinition.findMany({
      where: { companyId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The real transactions behind one KPI's number — same discipline trial-
   * balance drill-through already gives an account balance, scoped to the
   * KPIs whose source rows are a real, enumerable set.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('kpis/:key/drill-through')
  async kpiDrillThrough(
    @CurrentCompany() companyId: string,
    @Param('key') key: string,
    @Query('farmId') farmId?: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.kpis.drillThrough(companyId, key, farmId, groupId);
  }

  /**
   * Accounts receivable ageing, by customer — built and proven weeks ago as
   * part of customer receipts, with no HTTP endpoint until now.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('ar-ageing')
  async arAgeing(@CurrentCompany() companyId: string) {
    return this.customerReceipts.ageing({ companyId, asAt: new Date() });
  }

  /** One row per customer at the bucket-total level the screen shows — not
   * exploded to invoice level, the same "first slice, not a claimed general
   * framework" scope the trial balance export set. */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('ar-ageing/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ar-ageing.csv"')
  async arAgeingExport(@CurrentCompany() companyId: string): Promise<string> {
    const ageing = await this.customerReceipts.ageing({ companyId, asAt: new Date() });
    return ageingCsv(
      'Customer Code',
      'Customer Name',
      ageing.map((e) => ({ code: e.customerCode, name: e.customerName, totalKobo: e.totalKobo, buckets: e.buckets })),
    );
  }

  /** Accounts payable ageing, by supplier — the same stranded-service pattern. */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('ap-ageing')
  async apAgeing(@CurrentCompany() companyId: string) {
    return this.supplierPayments.ageing({ companyId, asAt: new Date() });
  }

  /** Same shape as the AR export, for suppliers. */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('ap-ageing/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ap-ageing.csv"')
  async apAgeingExport(@CurrentCompany() companyId: string): Promise<string> {
    const ageing = await this.supplierPayments.ageing({ companyId, asAt: new Date() });
    return ageingCsv(
      'Supplier Code',
      'Supplier Name',
      ageing.map((e) => ({ code: e.supplierCode, name: e.supplierName, totalKobo: e.totalKobo, buckets: e.buckets })),
    );
  }

  /**
   * US-897-029's remaining criterion: does every CONTROL account's GL
   * balance actually equal the subledger detail it's supposed to be the
   * only thing ever posted to — AR, AP, every inventory GL account, and WIP
   * by processing cycle.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
  @Get('control-reconciliation')
  async controlReconciliationReport(@CurrentCompany() companyId: string) {
    return this.controlReconciliation.reconcile(companyId);
  }

  /**
   * US-897-037's last remaining criterion: "all exceptions resolved/accepted
   * before release" was happening in this register's own prose, not as a
   * system record. This makes it one — a real, immutable AuditRecord (no new
   * table: entityType 'ReleaseSignOff' on the same append-only trail
   * US-897-036 already gave dedicated old/new-value columns) naming who
   * signed off, when, and the exact PostingControlChecksService/control-
   * reconciliation snapshot they were looking at.
   *
   * §60.5's own rule — a mandatory control that is missing is a version-1
   * correction, not something to defer — is enforced here, not waived: if
   * either check surface shows anything short of clean, this refuses unless
   * the caller supplies `exceptionsAcknowledged`, a real justification for
   * releasing anyway. That is the honest reading of "resolved OR accepted" —
   * not silence, and not a rubber stamp either.
   */
  @Roles('FINANCE_CONTROLLER', 'CFO')
  @Post('release-sign-off')
  async signOffRelease(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { releaseLabel: string; exceptionsAcknowledged?: string },
  ) {
    if (!body.releaseLabel?.trim()) {
      throw new BadRequestException('A release label is required (e.g. "v8.9.7").');
    }

    const [checks, reconciliation] = await Promise.all([
      this.postingControlChecks.run(companyId),
      this.controlReconciliation.reconcile(companyId),
    ]);

    const failingChecks = checks.rows.filter((r) => r.state !== 'PASS');
    const variantAccounts = reconciliation.filter((r) => !r.reconciled);
    const hasExceptions = failingChecks.length > 0 || variantAccounts.length > 0;

    if (hasExceptions && !body.exceptionsAcknowledged?.trim()) {
      throw new BadRequestException(
        `Cannot sign off clean: ${failingChecks.length} posting-control check(s) and ` +
          `${variantAccounts.length} control-account row(s) are not resolved. Resolve them, ` +
          `or supply exceptionsAcknowledged explaining why release proceeds anyway — a sign-off ` +
          `is a decision made in the open, not a silent pass.`,
      );
    }

    const entityId = `${companyId}:${body.releaseLabel.trim()}:${Date.now()}`;
    const snapshot = {
      releaseLabel: body.releaseLabel.trim(),
      postingControlChecks: checks.rows,
      releasableByChecksAlone: checks.releasable,
      controlReconciliation: reconciliation,
      failingCheckCount: failingChecks.length,
      variantAccountCount: variantAccounts.length,
    };

    await this.auditService.write({
      transactionId: entityId,
      module: 'reporting',
      entityType: 'ReleaseSignOff',
      entityId,
      status: hasExceptions ? 'RELEASED_WITH_EXCEPTIONS' : 'RELEASED',
      action: AuditAction.CREATE,
      userId: actor.userId,
      comments: body.exceptionsAcknowledged?.trim() ?? null,
      newValue: snapshot,
    });

    return {
      releaseLabel: snapshot.releaseLabel,
      verdict: hasExceptions ? 'RELEASED_WITH_EXCEPTIONS' : 'RELEASED',
      failingCheckCount: failingChecks.length,
      variantAccountCount: variantAccounts.length,
      exceptionsAcknowledged: body.exceptionsAcknowledged?.trim() ?? null,
      signedOffBy: actor.userId,
    };
  }

  /** The sign-off history — every release decision this company has ever made, newest first. */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'CFO')
  @Get('release-sign-offs')
  async releaseSignOffs(@CurrentCompany() companyId: string) {
    const records = await this.prisma.auditRecord.findMany({
      where: { companyId, entityType: 'ReleaseSignOff' },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      include: { user: { select: { fullName: true, email: true } } },
    });
    return records.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      status: r.status,
      signedOffBy: r.user ? r.user.fullName || r.user.email : r.userId,
      exceptionsAcknowledged: r.comments,
      snapshot: r.newValueJson,
    }));
  }

  /**
   * The governed 12-phase build sequence (US-897-001) — Developer_Build_Order
   * (DEV-01..12) seeded verbatim from the workbook, joined with a `status`
   * computed live from real data existence in THIS company rather than a
   * hand-set flag that could drift stale. A phase with no real signal to
   * check (no channel/integration or migration-run model exists anywhere in
   * this codebase) is reported `hasEvidence: false, signal: null` rather
   * than a guessed pass — the same "honest blank over invented status"
   * convention KPI drill-through already uses.
   */
  @AnyRole('Every signed-in user can see how far the build has actually got.')
  @Get('build-order')
  async buildOrder(@CurrentCompany() companyId: string) {
    const phases = await this.prisma.implementationPhase.findMany({
      where: { companyId, active: true },
      orderBy: { sequence: 'asc' },
    });

    const [
      costCentreCount,
      workflowTransactionCount,
      purchaseOrderCount,
      stockMovementCount,
      snailGroupCount,
      poultryGroupCount,
      settledProductionOrderCount,
      salesInvoiceCount,
      reportDefinitionCount,
      kpiDefinitionCount,
      releaseSignOffCount,
    ] = await Promise.all([
      this.prisma.costCentre.count({ where: { companyId } }),
      this.prisma.workflowTransaction.count({ where: { companyId } }),
      this.prisma.purchaseOrder.count({ where: { companyId } }),
      this.prisma.stockMovement.count({ where: { companyId } }),
      this.prisma.livestockGroup.count({ where: { companyId, speciesKey: 'snail' } }),
      this.prisma.livestockGroup.count({ where: { companyId, speciesKey: 'poultry' } }),
      this.prisma.productionOrder.count({ where: { companyId, settledAt: { not: null } } }),
      this.prisma.salesInvoice.count({ where: { companyId } }),
      this.prisma.reportDefinition.count({ where: { companyId, active: true } }),
      this.prisma.kpiDefinition.count({ where: { companyId, active: true } }),
      this.prisma.auditRecord.count({ where: { companyId, entityType: 'ReleaseSignOff' } }),
    ]);

    const evidence: Record<string, { hasEvidence: boolean; signal: string | null }> = {
      'DEV-01': { hasEvidence: costCentreCount > 0, signal: `${costCentreCount} cost centre(s) configured` },
      'DEV-02': { hasEvidence: workflowTransactionCount > 0, signal: `${workflowTransactionCount} workflow transaction(s) submitted` },
      'DEV-03': { hasEvidence: purchaseOrderCount > 0, signal: `${purchaseOrderCount} purchase order(s) raised` },
      'DEV-04': { hasEvidence: stockMovementCount > 0, signal: `${stockMovementCount} stock movement(s) posted` },
      'DEV-05': { hasEvidence: snailGroupCount > 0, signal: `${snailGroupCount} snail cohort(s) recorded` },
      'DEV-06': { hasEvidence: poultryGroupCount > 0, signal: `${poultryGroupCount} poultry flock(s) recorded` },
      'DEV-07': { hasEvidence: settledProductionOrderCount > 0, signal: `${settledProductionOrderCount} production order(s) fully settled` },
      'DEV-08': { hasEvidence: salesInvoiceCount > 0, signal: `${salesInvoiceCount} sales invoice(s) raised` },
      'DEV-09': {
        hasEvidence: reportDefinitionCount > 0 && kpiDefinitionCount > 0,
        signal: `${reportDefinitionCount} report(s), ${kpiDefinitionCount} KPI(s) governed`,
      },
      'DEV-10': { hasEvidence: false, signal: null },
      'DEV-11': { hasEvidence: false, signal: null },
      'DEV-12': { hasEvidence: releaseSignOffCount > 0, signal: `${releaseSignOffCount} release sign-off(s) recorded` },
    };

    return phases.map((phase) => ({
      code: phase.code,
      sequence: phase.sequence,
      name: phase.name,
      scope: phase.scope,
      owner: phase.owner,
      exitEvidence: phase.exitEvidence,
      dependencyCodes: phase.dependencyCodes,
      evidenceSheet: phase.evidenceSheet,
      webPath: phase.webPath,
      hasEvidence: evidence[phase.code]?.hasEvidence ?? false,
      signal: evidence[phase.code]?.signal ?? null,
    }));
  }

  /**
   * The journal register. Paged, because a real ledger is not a list you scroll
   * — a year of production postings runs to tens of thousands of entries.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
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
   * US-897-037's own "reverse" half — `PostingService.reverse()` (Rule 2:
   * mirror-image document, the original untouched) already existed with
   * exactly one caller anywhere in the app: the dev-only demo panel's
   * `/demo/reverse`, never routed in production. This is the first real,
   * production-facing door to it. Tightly gated — reversing a posted
   * journal is not a call any finance role should make unilaterally.
   */
  @Roles('FINANCE_CONTROLLER', 'CFO')
  @Post('journals/:id/reverse')
  async reverseJournal(
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
  ) {
    const original = await this.prisma.journalEntry.findFirst({ where: { id, companyId } });
    if (!original) throw new NotFoundException(`No journal ${id} in this company.`);

    const stamp = Date.now().toString(36).toUpperCase();
    return this.posting.reverse(id, {
      journalNumber: `REV-${original.journalNumber}-${stamp}`,
      journalDate: new Date(),
      narration: `Reversal of ${original.journalNumber}`,
      // Same period the original posted into, not "today's" — a reversal
      // corrects the period it belongs to, the same convention the demo
      // panel's own reverse() call already used.
      financialYearId: original.financialYearId,
      financialPeriodId: original.financialPeriodId,
      idempotencyKey: `reversal:${id}`,
      actor,
    });
  }

  /**
   * The audit trail (Rule 9). Append-only at the database, so this is purely a
   * read — there is deliberately no endpoint that edits or deletes one.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
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
  @Roles(
    'FINANCE_MANAGER',
    'FINANCE_CONTROLLER',
    'CFO',
    'FARM_MANAGER',
    'INTERNAL_AUDITOR',
    'FARM_ACCOUNTANT',
  )
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
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'INTERNAL_AUDITOR', 'FARM_ACCOUNTANT', 'CFO')
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

/** RFC 4180 quoting — wraps and escapes a cell only when it actually needs it. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Shared by the AR and AP ageing exports — both `.ageing()` methods return
 * the same shape under a different code/name key, so the caller normalises
 * to `code`/`name` and this just serialises. One row per party at the same
 * bucket-total level the screen shows; bucket columns come from the first
 * entry's own labels since every entry shares the same edges. */
function ageingCsv(
  codeHeader: string,
  nameHeader: string,
  entries: Array<{
    code: string;
    name: string;
    totalKobo: string;
    buckets: Array<{ label: string; amountKobo: string }>;
  }>,
): string {
  const bucketLabels = entries[0]?.buckets.map((b) => b.label) ?? [];
  const header = [codeHeader, nameHeader, 'Total Outstanding (kobo)', ...bucketLabels];
  const rows = entries.map((e) => [
    e.code,
    csvCell(e.name),
    e.totalKobo,
    ...e.buckets.map((b) => b.amountKobo),
  ]);
  return [header, ...rows].map((row) => row.join(',')).join('\r\n');
}
