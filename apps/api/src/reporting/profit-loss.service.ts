import { Injectable } from '@nestjs/common';
import { AccountType } from '@bioassetpro/database';
import { TrialBalanceService, type TrialBalanceFilter } from './trial-balance.service';

export interface ProfitLossLine {
  accountNumber: string;
  accountName: string;
  amountKobo: string;
}

export interface ProfitLoss {
  revenueKobo: string;
  otherIncomeKobo: string;
  costOfSalesKobo: string;
  grossProfitKobo: string;
  operatingExpenseKobo: string;
  profitBeforeTaxKobo: string;
  /** Income tax provided for (PCR-084, 650100) — below profit before tax. */
  incomeTaxKobo: string;
  profitAfterTaxKobo: string;
  revenueLines: ProfitLossLine[];
  otherIncomeLines: ProfitLossLine[];
  costOfSalesLines: ProfitLossLine[];
  operatingExpenseLines: ProfitLossLine[];
  incomeTaxLines: ProfitLossLine[];
}

/**
 * Cost of sales, read off the account number rather than a field that
 * doesn't exist. There is no `fsCategory` anywhere on `GLAccount` — the chart
 * has exactly two EXPENSE accounts the client's own numbering already singles
 * out for cost of production (`5001 Cost of Sales`, `5305 Production Loss
 * Expense`); everything else EXPENSE-typed is an operating cost. Stated here
 * rather than hidden, because it is a convention this codebase is choosing,
 * not a fact the chart already recorded.
 */
export const COST_OF_SALES_ACCOUNTS = new Set([
  // The old chart.
  '5001', '5305',
  // The client's chart: cost of sales by species and product, and the
  // biological losses that replace 5305 (chart.ts, SPECIES_ACCOUNTS).
  '510100', '510200', '510300', '510400', '640300', '640500',
]);

/** Income tax expense (PCR-084-DR) — shown below profit before tax, not among operating costs. */
export const INCOME_TAX_ACCOUNTS = new Set(['650100']);

/** IAS 41 biological-asset gains and produce gains are P&L income, but are
 * presented separately from revenue earned by selling goods and services. */
export const OTHER_INCOME_ACCOUNTS = new Set(['42000', '42100', '420100', '420200', '420210']);
/**
 * Of those, the ones that are expense accounts: on the approved chart the
 * fair value loss (42100) is its own debit-normal account, so it counts
 * against other income rather than adding to it.
 */
const OTHER_INCOME_LOSS_TYPE = AccountType.EXPENSE;

/**
 * Profit & Loss, as a read over the same ledger the Trial Balance already
 * proves is balanced.
 *
 * Nothing here posts or invents a figure `TrialBalanceService` did not
 * already produce — this only partitions REVENUE/EXPENSE rows the same way
 * `YearEndService.close()` already does at year-end (see
 * `closing/year-end.service.ts`), so a live P&L and the sweep a closed year
 * actually posts cannot disagree about what counts as what.
 */
@Injectable()
export class ProfitLossService {
  constructor(private readonly trialBalance: TrialBalanceService) {}

  async build(filter: TrialBalanceFilter): Promise<ProfitLoss> {
    const tb = await this.trialBalance.build(filter);

    const revenueRows = tb.rows.filter((row) => row.accountType === AccountType.REVENUE && !OTHER_INCOME_ACCOUNTS.has(row.accountNumber));
    const otherIncomeRows = tb.rows.filter((row) => OTHER_INCOME_ACCOUNTS.has(row.accountNumber));
    const expenseRows = tb.rows.filter((row) => row.accountType === AccountType.EXPENSE && !OTHER_INCOME_ACCOUNTS.has(row.accountNumber));
    const costOfSalesRows = expenseRows.filter((row) =>
      COST_OF_SALES_ACCOUNTS.has(row.accountNumber),
    );
    const incomeTaxRows = expenseRows.filter((row) => INCOME_TAX_ACCOUNTS.has(row.accountNumber));
    const operatingExpenseRows = expenseRows.filter(
      (row) => !COST_OF_SALES_ACCOUNTS.has(row.accountNumber) && !INCOME_TAX_ACCOUNTS.has(row.accountNumber),
    );

    // Revenue is credit-normal, so `displayedBalanceKobo` is already positive
    // for a genuine credit balance; expenses are debit-normal, same reasoning.
    const revenueKobo = sumOf(revenueRows);
    const otherIncomeKobo = sumOf(otherIncomeRows.map(asIncome));
    const costOfSalesKobo = sumOf(costOfSalesRows);
    const operatingExpenseKobo = sumOf(operatingExpenseRows);
    const grossProfitKobo = revenueKobo - costOfSalesKobo;
    const profitBeforeTaxKobo = grossProfitKobo + otherIncomeKobo - operatingExpenseKobo;
    const incomeTaxKobo = sumOf(incomeTaxRows);
    const profitAfterTaxKobo = profitBeforeTaxKobo - incomeTaxKobo;

    return {
      revenueKobo: revenueKobo.toString(),
      otherIncomeKobo: otherIncomeKobo.toString(),
      costOfSalesKobo: costOfSalesKobo.toString(),
      grossProfitKobo: grossProfitKobo.toString(),
      operatingExpenseKobo: operatingExpenseKobo.toString(),
      profitBeforeTaxKobo: profitBeforeTaxKobo.toString(),
      incomeTaxKobo: incomeTaxKobo.toString(),
      profitAfterTaxKobo: profitAfterTaxKobo.toString(),
      revenueLines: toLines(revenueRows),
      otherIncomeLines: toLines(otherIncomeRows.map(asIncome)),
      costOfSalesLines: toLines(costOfSalesRows),
      operatingExpenseLines: toLines(operatingExpenseRows),
      incomeTaxLines: toLines(incomeTaxRows),
    };
  }
}

/** An other-income row as income: a loss account's debit balance is negative income. */
function asIncome<T extends { accountType: AccountType; displayedBalanceKobo: bigint }>(row: T): T {
  return row.accountType === OTHER_INCOME_LOSS_TYPE ? { ...row, displayedBalanceKobo: -row.displayedBalanceKobo } : row;
}

function sumOf(rows: Array<{ displayedBalanceKobo: bigint }>): bigint {
  return rows.reduce((sum, row) => sum + row.displayedBalanceKobo, 0n);
}

function toLines(
  rows: Array<{ accountNumber: string; accountName: string; displayedBalanceKobo: bigint }>,
): ProfitLossLine[] {
  return rows.map((row) => ({
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    amountKobo: row.displayedBalanceKobo.toString(),
  }));
}
