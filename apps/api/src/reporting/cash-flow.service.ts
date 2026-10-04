import { Injectable } from '@nestjs/common';
import { assertReportFilter } from './report-filter';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitLossService } from './profit-loss.service';
import { allNumbersFor } from '../chart/chart';

export interface CashFlow {
  openingCashKobo: string;
  netIncomeKobo: string;
  depreciationAddBackKobo: string;
  /**
   * IAS 41: the period's fair-value gain (negative here) or loss (positive)
   * on biological assets, and the gain on eggs valued at collection — income
   * that is not cash. Shown on its own line rather than left inside the
   * change in inventory, where a revaluation would look like working capital.
   */
  fairValueAdjustmentKobo: string;
  receivablesChangeKobo: string;
  inventoryChangeKobo: string;
  payablesChangeKobo: string;
  /**
   * Equity booked without cash — an opening balance taken on against
   * retained earnings, a prior-period adjustment. Its other side is already in
   * the working-capital changes above, so it is added back here; without it
   * the statement no longer ends at the bank.
   */
  nonCashEquityKobo: string;
  netCashFromOperationsKobo: string;
  fixedAssetAcquisitionsKobo: string;
  netCashFromInvestingKobo: string;
  /** Capital and loans — the same figure under both methods (IAS 7). */
  netCashFromFinancingKobo: string;
  netChangeInCashKobo: string;
  closingCashKobo: string;
  /** The Bank account's own trial-balance closing figure, for the one check
   * this statement exists to pass: closing CF cash equals BS cash. */
  bankAccountClosingKobo: string;
  reconciled: boolean;
  /**
   * The direct method (500_Cash_Flow, S_CONSOLIDATED_CF, AC-ENT-001 / AC-013):
   * the bank's own movements this period, each classified by what the other
   * side of its journal was.
   */
  direct: DirectCashFlow;
  /** The workbook's checks, each zero when the statements agree. */
  checks: {
    /** Direct closing cash less the bank's closing balance. */
    directKobo: string;
    /** Indirect closing cash less the bank's closing balance. */
    indirectKobo: string;
    /** Direct less indirect net cash from operating activities. */
    directVsIndirectOperatingKobo: string;
  };
}

export interface DirectCashFlow {
  customerReceiptsKobo: string;
  supplierPaymentsKobo: string;
  employeePaymentsKobo: string;
  taxesPaidKobo: string;
  otherOperatingKobo: string;
  netCashFromOperationsKobo: string;
  investingKobo: string;
  financingKobo: string;
  netChangeInCashKobo: string;
  openingCashKobo: string;
  closingCashKobo: string;
  /** How many journals moved the bank this period. */
  journals: number;
}

type DirectLine = 'customers' | 'suppliers' | 'employees' | 'taxes' | 'otherOperating' | 'investing' | 'financing';

// Every account below was confirmed by tracing this session's own journal
// lines to see what actually posts where — not assumed from account naming
// or from which chart (legacy four-digit vs. the client's newer six-digit
// one) a number happens to belong to. The two charts are both live
// simultaneously (US-897-029's own finding) and which one a given module
// resolves to isn't consistent: Fixed Assets/GRN/Trade-Payables post to
// legacy numbers (2140, 2201); ProductionOrderService's own conversion
// accrual posts to six-digit ones instead (210100 overhead, 220100
// labour); payroll's own statutory payables sit on a THIRD set of legacy
// four-digit codes (2101-2110, PayrollRunService's own hardcoded map) that
// happen to look nothing like the six-digit 22xx00 accounts their names
// might otherwise suggest. A first pass at this list added six-digit
// accounts by name-matching alone (120100, 110100, 140100, 221100-224100)
// and every one of them turned out to have zero journal lines ever posted
// against it — removed rather than left in as harmless dead weight.
// Each bucket lists its accounts on both charts (chart.ts): a company that
// has moved charts has nothing left on the old numbers, and one that has not
// has nothing on the new.
const RECEIVABLE_ACCOUNTS = allNumbersFor('receivables');
/**
 * VAT and withholding tax recoverable, and VAT and withholding owed: working
 * capital like any receivable or payable. Missing until 2026-09-26, so a
 * receipt with withholding deducted left the indirect statement's operating
 * cash above the bank's by the tax withheld — the direct method, reading the
 * bank itself, is what showed it.
 */
const TAX_RECEIVABLE_ACCOUNTS = allNumbersFor('inputVat', 'whtReceivable');
const TAX_PAYABLE_ACCOUNTS = allNumbersFor('outputVat', 'whtPayable');
const INVENTORY_ACCOUNTS = [
  '1301', '1302', '1305', '1401', '1501',
  '130100', '130110', '130199', '130410', '130420', '130430', '130510', '130520',
  // Eggs, held at their value from collection (egg-posting.service.ts) and in
  // incubation. Left out until 2026-09-25, so every egg collected was income
  // the statement never reversed and it stopped agreeing with the bank.
  '130215', '130216',
  // …and their homes on the approved chart: eggs as finished poultry products
  // (12420) and eggs in incubation as poultry farm WIP (13020).
  '12420', '13020',
  // Production and processing on the approved chart: raw materials and feed
  // ingredients, finished snail products and feed, and the three WIP controls.
  '12000', '12100', '12200', '12300', '12400', '12410', '12450', '12500', '13000', '13110', '13120', '13200',
  // Viable biological eggs can use the approved immature-stage control
  // accounts when the company is on the approved posting-engine COA.
  '16031', '16032', '16041', '16042',
  // The six-digit chart's biological asset accounts, which a cutover leaves behind with their history.
  '130200', '130201', '130202', '130203', '130204', '130210',
];
const PAYABLE_ACCOUNTS = [
  // Trade payables, GRNI and the payroll liabilities on every chart (the
  // approved chart's 20100, 20300, 20600 and the shared payroll control 20700).
  ...allNumbersFor('tradePayables', 'grni', 'salaryPayable', 'pensionPayable', 'nhfPayable', 'nsitfPayable', 'itfPayable', 'payePayable'),
  '2140', '2201', '210200', '210100', '220100',
  // Payroll's own statutory payables (PayrollRunService's hardcoded map) —
  // salary, pension, NHF, NSITF, ITF, PAYE.
  '2101', '2102', '2103', '2104', '2105', '2110',
  // …and their homes on the client's chart.
  '221100', '222100', '223100', '224100',
  // Standard-costing recovery/clearing liabilities (Dr WIP / Cr Recovery as
  // standard cost is absorbed, cleared against actual cost at settlement) —
  // real posted liability balances that move independently of every other
  // bucket here. Missing these understated "change in payables" by exactly
  // their period movement, breaking the closing-cash reconciliation this
  // service exists to prove.
  '219810', '219820', '219830',
  // Accrued expenses control (the actual conversion cost accrued by processing orders, approved chart).
  '20200',
  // Current income tax payable on the approved chart (PCR-084-CR).
  '20900',
  // Income tax provided for but not yet paid (PCR-084-CR).
  '227100',
  // Accrued expenses: actual conversion cost accrued at confirmation
  // (ProductionOrderService.actualCostCreditAccount), settled when the
  // invoices, payroll and depreciation behind it are booked.
  '230100',
];
const BANK_ACCOUNTS = allNumbersFor('bank');
/** Salary and statutory payroll payables and costs: paid to or for employees. */
const EMPLOYEE_ACCOUNTS = allNumbersFor(
  'salaryPayable', 'pensionPayable', 'nhfPayable', 'nsitfPayable', 'itfPayable',
  'salaryExpense', 'employerPensionExpense', 'nsitfExpense', 'itfExpense',
);
/** PAYE, VAT, withholding and income tax. */
const TAX_ACCOUNTS = [...allNumbersFor('payePayable', 'outputVat', 'whtPayable', 'inputVat', 'whtReceivable'), '227100', '650100', '20900', '58000'];
/** What the farm owes suppliers for goods and services. */
const SUPPLIER_ACCOUNTS = allNumbersFor('tradePayables', 'grni');
// The approved chart splits fixed assets by class (docs/approved-coa-crosswalk-review.csv).
const PPE_ACCOUNTS = ['1701', '140100', '15100', '15200', '15300', '15400'];
const DEPRECIATION_ACCOUNTS = ['5501', '630100', '52400'];
const ACCUMULATED_DEPRECIATION_ACCOUNTS = ['1702', '149100', '15500', '15600', '15700'];
/** Fair-value gain/loss on snails and poultry, and the gain on eggs at collection. */
const FAIR_VALUE_ACCOUNTS = ['42000', '42100', '420100', '420200', '420210'];

/**
 * Cash Flow, indirect method — the only method the data supports.
 *
 * No transaction is tagged "this moved cash" at the point of posting, so a
 * direct-method statement would have nothing to read from. What exists
 * instead is exactly what the indirect method needs: net income (from
 * `ProfitLossService`), the depreciation this period actually posted (a
 * real, non-cash expense), and the working-capital accounts' own
 * period-over-period movement, all read from the same trial balance
 * everything else here is built on.
 *
 * No financing section — nothing in the chart represents a loan or share
 * issuance today, so it is correctly absent rather than shown as a
 * confident zero.
 *
 * The biological-asset fair-value gain is the other non-cash item net income
 * carries: its offsetting debit lands in a per-species-per-stage GL account
 * (`BiologicalAssetStageAccount`), which `balancesAsOf` folds into the
 * inventory bucket so the gain reverses out of operating cash the same way
 * depreciation reverses out of an expense.
 */
@Injectable()
export class CashFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profitLoss: ProfitLossService,
  ) {}

  /**
   * Year to date (REPORT_KPI_CATALOG AGR-016): the year's first period
   * through the one named. Every flow line adds up across periods, so this is
   * the sum of the monthly statements — opening cash from the first, closing
   * and the bank from the last — and agrees with them by construction.
   */
  async yearToDate(params: { companyId: string; financialPeriodId: string }): Promise<CashFlow & { fromPeriodId: string; periods: number }> {
    await assertReportFilter(this.prisma, params);
    const through = await this.prisma.financialPeriod.findUniqueOrThrow({
      where: { id: params.financialPeriodId },
      select: { financialYearId: true, startDate: true },
    });
    const periods = await this.prisma.financialPeriod.findMany({
      where: { financialYearId: through.financialYearId, startDate: { lte: through.startDate } },
      orderBy: { startDate: 'asc' },
      select: { id: true },
    });
    const months: CashFlow[] = [];
    for (const p of periods) months.push(await this.build({ companyId: params.companyId, financialPeriodId: p.id }));
    const first = months[0]!;
    const last = months[months.length - 1]!;
    const sum = (pick: (m: CashFlow) => string) => months.reduce((s, m) => s + BigInt(pick(m)), 0n);

    const netCashFromOperationsKobo = sum((m) => m.netCashFromOperationsKobo);
    const netCashFromInvestingKobo = sum((m) => m.netCashFromInvestingKobo);
    const netCashFromFinancingKobo = sum((m) => m.netCashFromFinancingKobo);
    const netChangeInCashKobo = netCashFromOperationsKobo + netCashFromInvestingKobo + netCashFromFinancingKobo;
    const openingCashKobo = BigInt(first.openingCashKobo);
    const closingCashKobo = openingCashKobo + netChangeInCashKobo;
    const bank = BigInt(last.bankAccountClosingKobo);
    const directOperating = sum((m) => m.direct.netCashFromOperationsKobo);
    const directChange = sum((m) => m.direct.netChangeInCashKobo);
    const directClosing = openingCashKobo + directChange;

    return {
      fromPeriodId: periods[0]!.id,
      periods: periods.length,
      openingCashKobo: openingCashKobo.toString(),
      netIncomeKobo: sum((m) => m.netIncomeKobo).toString(),
      depreciationAddBackKobo: sum((m) => m.depreciationAddBackKobo).toString(),
      fairValueAdjustmentKobo: sum((m) => m.fairValueAdjustmentKobo).toString(),
      receivablesChangeKobo: sum((m) => m.receivablesChangeKobo).toString(),
      inventoryChangeKobo: sum((m) => m.inventoryChangeKobo).toString(),
      payablesChangeKobo: sum((m) => m.payablesChangeKobo).toString(),
      nonCashEquityKobo: sum((m) => m.nonCashEquityKobo).toString(),
      netCashFromOperationsKobo: netCashFromOperationsKobo.toString(),
      fixedAssetAcquisitionsKobo: sum((m) => m.fixedAssetAcquisitionsKobo).toString(),
      netCashFromInvestingKobo: netCashFromInvestingKobo.toString(),
      netCashFromFinancingKobo: netCashFromFinancingKobo.toString(),
      netChangeInCashKobo: netChangeInCashKobo.toString(),
      closingCashKobo: closingCashKobo.toString(),
      bankAccountClosingKobo: bank.toString(),
      reconciled: closingCashKobo === bank,
      direct: {
        customerReceiptsKobo: sum((m) => m.direct.customerReceiptsKobo).toString(),
        supplierPaymentsKobo: sum((m) => m.direct.supplierPaymentsKobo).toString(),
        employeePaymentsKobo: sum((m) => m.direct.employeePaymentsKobo).toString(),
        taxesPaidKobo: sum((m) => m.direct.taxesPaidKobo).toString(),
        otherOperatingKobo: sum((m) => m.direct.otherOperatingKobo).toString(),
        netCashFromOperationsKobo: directOperating.toString(),
        investingKobo: sum((m) => m.direct.investingKobo).toString(),
        financingKobo: sum((m) => m.direct.financingKobo).toString(),
        netChangeInCashKobo: directChange.toString(),
        openingCashKobo: openingCashKobo.toString(),
        closingCashKobo: directClosing.toString(),
        journals: months.reduce((s, m) => s + m.direct.journals, 0),
      },
      checks: {
        directKobo: (directClosing - bank).toString(),
        indirectKobo: (closingCashKobo - bank).toString(),
        directVsIndirectOperatingKobo: (directOperating - netCashFromOperationsKobo).toString(),
      },
    };
  }

  async build(params: { companyId: string; financialPeriodId: string }): Promise<CashFlow> {
    await assertReportFilter(this.prisma, params);
    const period = await this.prisma.financialPeriod.findUniqueOrThrow({
      where: { id: params.financialPeriodId },
      select: { financialYearId: true, startDate: true },
    });

    const priorPeriod = await this.prisma.financialPeriod.findFirst({
      where: {
        financialYearId: period.financialYearId,
        startDate: { lt: period.startDate },
      },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });

    const [opening, closing, netIncome] = await Promise.all([
      priorPeriod
        ? this.balancesAsOf(params.companyId, priorPeriod.id)
        : this.zeroBalances(),
      this.balancesAsOf(params.companyId, params.financialPeriodId),
      // Filtered to this ONE period, not year-to-date — the figure a cash
      // flow statement for this period actually needs.
      this.profitLoss.build({ companyId: params.companyId, financialPeriodId: params.financialPeriodId }),
    ]);

    // This period's own depreciation charge, read off the same single-period
    // P&L rather than `closing.depreciationExpense`'s year-to-date balance —
    // an add-back is a flow for the period, not a cumulative balance.
    //
    // Plus depreciation charged somewhere other than the expense account — an
    // asset whose charge goes to production (a feed mill's mixer) is just as
    // non-cash. Read as the depreciation runs' credits to accumulated
    // depreciation, less what the expense account already counted. Missing it
    // left the indirect method short by exactly that charge (the 40-step
    // rehearsal, step 37).
    const expensed = netIncome.operatingExpenseLines
      .filter((line) => DEPRECIATION_ACCOUNTS.includes(line.accountNumber))
      .reduce((sum, line) => sum + BigInt(line.amountKobo), 0n);
    const charged = await this.prisma.journalLine.aggregate({
      where: {
        companyId: params.companyId,
        financialPeriodId: params.financialPeriodId,
        glAccount: { companyId: params.companyId, accountNumber: { in: ACCUMULATED_DEPRECIATION_ACCOUNTS } },
        journalEntry: { companyId: params.companyId, status: 'POSTED', sourceDocumentType: 'DepreciationRun' },
      },
      _sum: { creditKobo: true, debitKobo: true },
    });
    const chargedKobo = (charged._sum.creditKobo ?? 0n) - (charged._sum.debitKobo ?? 0n);
    const depreciationAddBackKobo = chargedKobo > expensed ? chargedKobo : expensed;

    // IAS 41 and produce gains are shown as other income on the P&L, then
    // removed from operating cash because they are non-cash.
    const fairValueAdjustmentKobo = -netIncome.otherIncomeLines
      .filter((line) => FAIR_VALUE_ACCOUNTS.includes(line.accountNumber))
      .reduce((sum, line) => sum + BigInt(line.amountKobo), 0n);

    // Receivables/inventory UP consumes cash (a use); payables UP releases
    // cash (a source) — the standard indirect-method sign convention.
    const receivablesChangeKobo = -(closing.receivables - opening.receivables);
    const inventoryChangeKobo = -(closing.inventory - opening.inventory) - fairValueAdjustmentKobo;
    const payablesChangeKobo = closing.payables - opening.payables;

    // Profit after tax: the tax provision is not cash, and its payable is
    // working capital above, so the statement still ends at the bank.
    const netIncomeKobo = BigInt(netIncome.profitAfterTaxKobo);
    const nonCashEquityKobo = await this.nonCashEquity(params.companyId, params.financialPeriodId);
    const netCashFromOperationsKobo =
      netIncomeKobo +
      depreciationAddBackKobo +
      fairValueAdjustmentKobo +
      receivablesChangeKobo +
      inventoryChangeKobo +
      payablesChangeKobo +
      nonCashEquityKobo;

    const fixedAssetAcquisitionsKobo = -(closing.ppe - opening.ppe);
    const netCashFromInvestingKobo = fixedAssetAcquisitionsKobo;

    // Financing is the same under both methods (IAS 7): taken from the bank's
    // own movements against equity and loans.
    const direct = await this.direct(params.companyId, params.financialPeriodId);
    const netCashFromFinancingKobo = direct.financing;

    const netChangeInCashKobo = netCashFromOperationsKobo + netCashFromInvestingKobo + netCashFromFinancingKobo;
    const openingCashKobo = opening.bank;
    const closingCashKobo = openingCashKobo + netChangeInCashKobo;

    const directOperating = direct.customers + direct.suppliers + direct.employees + direct.taxes + direct.otherOperating;
    const directChange = directOperating + direct.investing + direct.financing;
    const directClosing = openingCashKobo + directChange;

    return {
      openingCashKobo: openingCashKobo.toString(),
      netIncomeKobo: netIncomeKobo.toString(),
      depreciationAddBackKobo: depreciationAddBackKobo.toString(),
      fairValueAdjustmentKobo: fairValueAdjustmentKobo.toString(),
      receivablesChangeKobo: receivablesChangeKobo.toString(),
      inventoryChangeKobo: inventoryChangeKobo.toString(),
      payablesChangeKobo: payablesChangeKobo.toString(),
      nonCashEquityKobo: nonCashEquityKobo.toString(),
      netCashFromOperationsKobo: netCashFromOperationsKobo.toString(),
      fixedAssetAcquisitionsKobo: fixedAssetAcquisitionsKobo.toString(),
      netCashFromInvestingKobo: netCashFromInvestingKobo.toString(),
      netCashFromFinancingKobo: netCashFromFinancingKobo.toString(),
      netChangeInCashKobo: netChangeInCashKobo.toString(),
      closingCashKobo: closingCashKobo.toString(),
      bankAccountClosingKobo: closing.bank.toString(),
      reconciled: closingCashKobo === closing.bank,
      direct: {
        customerReceiptsKobo: direct.customers.toString(),
        supplierPaymentsKobo: direct.suppliers.toString(),
        employeePaymentsKobo: direct.employees.toString(),
        taxesPaidKobo: direct.taxes.toString(),
        otherOperatingKobo: direct.otherOperating.toString(),
        netCashFromOperationsKobo: directOperating.toString(),
        investingKobo: direct.investing.toString(),
        financingKobo: direct.financing.toString(),
        netChangeInCashKobo: directChange.toString(),
        openingCashKobo: openingCashKobo.toString(),
        closingCashKobo: directClosing.toString(),
        journals: direct.journals,
      },
      checks: {
        directKobo: (directClosing - closing.bank).toString(),
        indirectKobo: (closingCashKobo - closing.bank).toString(),
        directVsIndirectOperatingKobo: (directOperating - netCashFromOperationsKobo).toString(),
      },
    };
  }

  /**
   * The direct method, from the bank's own journal lines this period.
   *
   * Every posted journal that moved a bank account is classified by the
   * other side of it: receivables and revenue are customers; payables,
   * goods-received, stock, biological assets and expenses are suppliers;
   * salary and statutory payroll payables and costs are employees; PAYE,
   * VAT, withholding and income tax are taxes; fixed assets are investing;
   * equity and other long-term funding are financing. Where a journal has
   * several such lines its cash is shared across those moving the same way
   * as the cash, in proportion — so a receipt with withholding deducted
   * shows what the customer actually paid, not a phantom tax payment. A
   * journal touching a fixed asset is investing throughout, so a disposal's
   * gain is not mistaken for a sale. A transfer between bank accounts moves
   * nothing and is left out.
   */
  private async direct(companyId: string, financialPeriodId: string) {
    const totals: Record<DirectLine, bigint> = {
      customers: 0n, suppliers: 0n, employees: 0n, taxes: 0n, otherOperating: 0n, investing: 0n, financing: 0n,
    };
    const bank = await this.prisma.gLAccount.findMany({
      where: { companyId, accountNumber: { in: BANK_ACCOUNTS } },
      select: { id: true },
    });
    const bankIds = new Set(bank.map((b) => b.id));
    if (bankIds.size === 0) return { ...totals, journals: 0 };

    const lines = await this.prisma.journalLine.findMany({
      where: {
        companyId,
        financialPeriodId,
        journalEntry: { status: 'POSTED', lines: { some: { glAccountId: { in: [...bankIds] } } } },
      },
      select: { journalEntryId: true, glAccountId: true, debitKobo: true, creditKobo: true },
    });
    const accountIds = [...new Set(lines.map((l) => l.glAccountId))];
    const accounts = new Map(
      (
        await this.prisma.gLAccount.findMany({
          where: { companyId, id: { in: accountIds } },
          select: { id: true, accountNumber: true, accountType: true },
        })
      ).map((a) => [a.id, a]),
    );
    const bioAccounts = new Set(
      (await this.prisma.biologicalAssetStageAccount.findMany({ where: { companyId }, select: { glAccountId: true } })).map((r) => r.glAccountId),
    );

    const classify = (accountId: string): DirectLine => {
      const account = accounts.get(accountId);
      if (!account) return 'otherOperating';
      const n = account.accountNumber;
      if (PPE_ACCOUNTS.includes(n) || ACCUMULATED_DEPRECIATION_ACCOUNTS.includes(n)) return 'investing';
      if (EMPLOYEE_ACCOUNTS.includes(n)) return 'employees';
      if (TAX_ACCOUNTS.includes(n)) return 'taxes';
      if (RECEIVABLE_ACCOUNTS.includes(n) || account.accountType === 'REVENUE') return 'customers';
      if (account.accountType === 'EQUITY') return 'financing';
      if (
        SUPPLIER_ACCOUNTS.includes(n) ||
        INVENTORY_ACCOUNTS.includes(n) ||
        bioAccounts.has(accountId) ||
        account.accountType === 'EXPENSE'
      ) return 'suppliers';
      return 'otherOperating';
    };

    const byJournal = new Map<string, typeof lines>();
    for (const line of lines) byJournal.set(line.journalEntryId, [...(byJournal.get(line.journalEntryId) ?? []), line]);

    let journals = 0;
    for (const journalLines of byJournal.values()) {
      const cash = journalLines.filter((l) => bankIds.has(l.glAccountId)).reduce((sum, l) => sum + l.debitKobo - l.creditKobo, 0n);
      if (cash === 0n) continue; // between bank accounts, or cash in and straight out
      journals += 1;
      const others = journalLines.filter((l) => !bankIds.has(l.glAccountId));
      if (others.some((l) => classify(l.glAccountId) === 'investing')) {
        totals.investing += cash;
        continue;
      }
      // Lines moving the same way as the cash: credits fund a receipt, debits a payment.
      const weights = others
        .map((l) => ({ line: classify(l.glAccountId), weight: cash > 0n ? l.creditKobo - l.debitKobo : l.debitKobo - l.creditKobo }))
        .filter((w) => w.weight > 0n);
      const total = weights.reduce((sum, w) => sum + w.weight, 0n);
      if (total === 0n) {
        totals.otherOperating += cash;
        continue;
      }
      // Proportional shares, the rounding remainder to the largest, so the parts equal the cash exactly.
      let allocated = 0n;
      const shares = weights.map((w) => {
        const share = (cash * w.weight) / total;
        allocated += share;
        return { ...w, share };
      });
      shares.sort((a, b) => (a.weight > b.weight ? -1 : a.weight < b.weight ? 1 : 0))[0]!.share += cash - allocated;
      for (const share of shares) totals[share.line] += share.share;
    }
    return { ...totals, journals };
  }

  /**
   * Equity booked in the period by journals that moved no bank account, as
   * an increase (credit) positive. The year-end close is left out: it only
   * moves the year's profit, already counted as net income, into retained
   * earnings.
   */
  private async nonCashEquity(companyId: string, financialPeriodId: string): Promise<bigint> {
    const bank = await this.prisma.gLAccount.findMany({ where: { companyId, accountNumber: { in: BANK_ACCOUNTS } }, select: { id: true } });
    const sums = await this.prisma.journalLine.aggregate({
      where: {
        companyId,
        financialPeriodId,
        glAccount: { accountType: 'EQUITY' },
        journalEntry: {
          status: 'POSTED',
          sourceModule: { not: 'closing' },
          ...(bank.length ? { lines: { none: { glAccountId: { in: bank.map((b) => b.id) } } } } : {}),
        },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (sums._sum.creditKobo ?? 0n) - (sums._sum.debitKobo ?? 0n);
  }

  private async balancesAsOf(companyId: string, financialPeriodId: string) {
    // Cumulative through this period — the same "no period filter needed for
    // a permanent account" reasoning BalanceSheetService uses, just bounded
    // at a period's financialYearId/periodNumber rather than "all time",
    // since a prior year's closing balance carries forward via its own
    // closing entry, not by re-summing every year that ever existed.
    const period = await this.prisma.financialPeriod.findUniqueOrThrow({
      where: { id: financialPeriodId },
      select: { financialYearId: true, periodNumber: true },
    });
    const periodsThroughThis = await this.prisma.financialPeriod.findMany({
      where: { financialYearId: period.financialYearId, periodNumber: { lte: period.periodNumber } },
      select: { id: true },
    });

    // Biological assets carry a per-species-per-stage GL account
    // (`BiologicalAssetStageAccount`), not a fixed number this service can
    // list statically — unlike raw material or finished goods, which sit at
    // the same account number for every company. A fair-value gain is booked
    // straight to income with the offsetting debit landing in one of these
    // accounts, so without folding them into the inventory bucket below, that
    // gain flows into net income with nothing to reverse it, and cash flow
    // overstates the period by the entire non-cash revaluation.
    const biologicalAssetAccountIds = await this.prisma.biologicalAssetStageAccount
      .findMany({ where: { companyId }, select: { glAccountId: true }, distinct: ['glAccountId'] })
      .then((rows) => rows.map((row) => row.glAccountId));

    // TrialBalanceService's own filter takes one period id, not a range, so
    // "cumulative through this period" is built directly off journal lines —
    // every period in this year up to and including the one asked for.
    const lines = await this.prisma.journalLine.groupBy({
      by: ['glAccountId'],
      where: {
        companyId,
        financialPeriodId: { in: periodsThroughThis.map((p) => p.id) },
        journalEntry: { status: 'POSTED' },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });

    const byAccount = new Map(lines.map((l) => [l.glAccountId, (l._sum.debitKobo ?? 0n) - (l._sum.creditKobo ?? 0n)]));
    const accounts = await this.prisma.gLAccount.findMany({
      where: {
        companyId,
        OR: [
          { accountNumber: { in: [...RECEIVABLE_ACCOUNTS, ...TAX_RECEIVABLE_ACCOUNTS, ...INVENTORY_ACCOUNTS, ...PAYABLE_ACCOUNTS, ...TAX_PAYABLE_ACCOUNTS, ...BANK_ACCOUNTS, ...PPE_ACCOUNTS] } },
          { id: { in: biologicalAssetAccountIds } },
        ],
      },
      select: { id: true, accountNumber: true, normalBalance: true },
    });

    const netFor = (numbers: string[]): bigint =>
      accounts
        .filter((a) => numbers.includes(a.accountNumber))
        .reduce((sum, a) => {
          const net = byAccount.get(a.id) ?? 0n;
          // debit-positive net, flipped for a credit-normal account (payables).
          return sum + (a.normalBalance === 'DEBIT' ? net : -net);
        }, 0n);

    const netForIds = (ids: string[]): bigint =>
      accounts
        .filter((a) => ids.includes(a.id))
        .reduce((sum, a) => {
          const net = byAccount.get(a.id) ?? 0n;
          return sum + (a.normalBalance === 'DEBIT' ? net : -net);
        }, 0n);

    return {
      receivables: netFor([...RECEIVABLE_ACCOUNTS, ...TAX_RECEIVABLE_ACCOUNTS]),
      // Stage mappings and the approved egg accounts can overlap; union ids
      // before summing so a mapped account is never counted twice.
      inventory: netForIds([
        ...biologicalAssetAccountIds,
        ...accounts.filter((account) => INVENTORY_ACCOUNTS.includes(account.accountNumber)).map((account) => account.id),
      ]),
      payables: netFor([...PAYABLE_ACCOUNTS, ...TAX_PAYABLE_ACCOUNTS]),
      bank: netFor(BANK_ACCOUNTS),
      ppe: netFor(PPE_ACCOUNTS),
    };
  }

  private zeroBalances() {
    return { receivables: 0n, inventory: 0n, payables: 0n, bank: 0n, ppe: 0n };
  }
}
