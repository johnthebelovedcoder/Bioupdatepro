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
const RECEIVABLE_ACCOUNTS = ['1201', '120100'];
/**
 * VAT and withholding tax recoverable, and VAT and withholding owed: working
 * capital like any receivable or payable. Missing until 2026-09-26, so a
 * receipt with withholding deducted left the indirect statement's operating
 * cash above the bank's by the tax withheld — the direct method, reading the
 * bank itself, is what showed it.
 */
const TAX_RECEIVABLE_ACCOUNTS = ['1601', '125100', '1602', '125200'];
const TAX_PAYABLE_ACCOUNTS = ['2120', '226100', '2130', '225100'];
const INVENTORY_ACCOUNTS = [
  '1301', '1302', '1305', '1401', '1501',
  '130100', '130110', '130199', '130410', '130420', '130430', '130510', '130520',
  // Eggs, held at their value from collection (egg-posting.service.ts) and in
  // incubation. Left out until 2026-09-25, so every egg collected was income
  // the statement never reversed and it stopped agreeing with the bank.
  '130215', '130216',
];
const PAYABLE_ACCOUNTS = [
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
  // Income tax provided for but not yet paid (PCR-084-CR).
  '227100',
];
const BANK_ACCOUNTS = ['1101', '110100'];
/** Salary and statutory payroll payables and costs: paid to or for employees. */
const EMPLOYEE_ACCOUNTS = allNumbersFor(
  'salaryPayable', 'pensionPayable', 'nhfPayable', 'nsitfPayable', 'itfPayable',
  'salaryExpense', 'employerPensionExpense', 'nsitfExpense', 'itfExpense',
);
/** PAYE, VAT, withholding and income tax. */
const TAX_ACCOUNTS = [...allNumbersFor('payePayable', 'outputVat', 'whtPayable', 'inputVat', 'whtReceivable'), '227100', '650100'];
/** What the farm owes suppliers for goods and services. */
const SUPPLIER_ACCOUNTS = allNumbersFor('tradePayables', 'grni');
const PPE_ACCOUNTS = ['1701', '140100'];
const DEPRECIATION_ACCOUNTS = ['5501', '630100'];
/** Fair-value gain/loss on snails and poultry, and the gain on eggs at collection. */
const FAIR_VALUE_ACCOUNTS = ['420100', '420200', '420210'];

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
    const depreciationAddBackKobo = netIncome.operatingExpenseLines
      .filter((line) => DEPRECIATION_ACCOUNTS.includes(line.accountNumber))
      .reduce((sum, line) => sum + BigInt(line.amountKobo), 0n);

    // Gains are revenue here, so a gain is added back as a negative.
    const fairValueAdjustmentKobo = -netIncome.revenueLines
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
    const netCashFromOperationsKobo =
      netIncomeKobo +
      depreciationAddBackKobo +
      fairValueAdjustmentKobo +
      receivablesChangeKobo +
      inventoryChangeKobo +
      payablesChangeKobo;

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
      if (PPE_ACCOUNTS.includes(n) || allNumbersFor('accumulatedDepreciation').includes(n)) return 'investing';
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
      inventory: netFor(INVENTORY_ACCOUNTS) + netForIds(biologicalAssetAccountIds),
      payables: netFor([...PAYABLE_ACCOUNTS, ...TAX_PAYABLE_ACCOUNTS]),
      bank: netFor(BANK_ACCOUNTS),
      ppe: netFor(PPE_ACCOUNTS),
    };
  }

  private zeroBalances() {
    return { receivables: 0n, inventory: 0n, payables: 0n, bank: 0n, ppe: 0n };
  }
}
