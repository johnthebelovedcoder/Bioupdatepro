import { Injectable } from '@nestjs/common';
import { assertReportFilter } from './report-filter';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitLossService } from './profit-loss.service';

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
  netChangeInCashKobo: string;
  closingCashKobo: string;
  /** The Bank account's own trial-balance closing figure, for the one check
   * this statement exists to pass: closing CF cash equals BS cash. */
  bankAccountClosingKobo: string;
  reconciled: boolean;
}

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

    const netChangeInCashKobo = netCashFromOperationsKobo + netCashFromInvestingKobo;
    const openingCashKobo = opening.bank;
    const closingCashKobo = openingCashKobo + netChangeInCashKobo;

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
      netChangeInCashKobo: netChangeInCashKobo.toString(),
      closingCashKobo: closingCashKobo.toString(),
      bankAccountClosingKobo: closing.bank.toString(),
      reconciled: closingCashKobo === closing.bank,
    };
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
          { accountNumber: { in: [...RECEIVABLE_ACCOUNTS, ...INVENTORY_ACCOUNTS, ...PAYABLE_ACCOUNTS, ...BANK_ACCOUNTS, ...PPE_ACCOUNTS] } },
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
      receivables: netFor(RECEIVABLE_ACCOUNTS),
      inventory: netFor(INVENTORY_ACCOUNTS) + netForIds(biologicalAssetAccountIds),
      payables: netFor(PAYABLE_ACCOUNTS),
      bank: netFor(BANK_ACCOUNTS),
      ppe: netFor(PPE_ACCOUNTS),
    };
  }

  private zeroBalances() {
    return { receivables: 0n, inventory: 0n, payables: 0n, bank: 0n, ppe: 0n };
  }
}
