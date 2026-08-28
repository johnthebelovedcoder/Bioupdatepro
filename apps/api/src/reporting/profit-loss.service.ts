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
  costOfSalesKobo: string;
  grossProfitKobo: string;
  operatingExpenseKobo: string;
  profitBeforeTaxKobo: string;
  revenueLines: ProfitLossLine[];
  costOfSalesLines: ProfitLossLine[];
  operatingExpenseLines: ProfitLossLine[];
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
const COST_OF_SALES_ACCOUNTS = new Set(['5001', '5305']);

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

    const revenueRows = tb.rows.filter((row) => row.accountType === AccountType.REVENUE);
    const expenseRows = tb.rows.filter((row) => row.accountType === AccountType.EXPENSE);
    const costOfSalesRows = expenseRows.filter((row) =>
      COST_OF_SALES_ACCOUNTS.has(row.accountNumber),
    );
    const operatingExpenseRows = expenseRows.filter(
      (row) => !COST_OF_SALES_ACCOUNTS.has(row.accountNumber),
    );

    // Revenue is credit-normal, so `displayedBalanceKobo` is already positive
    // for a genuine credit balance; expenses are debit-normal, same reasoning.
    const revenueKobo = sumOf(revenueRows);
    const costOfSalesKobo = sumOf(costOfSalesRows);
    const operatingExpenseKobo = sumOf(operatingExpenseRows);
    const grossProfitKobo = revenueKobo - costOfSalesKobo;
    const profitBeforeTaxKobo = grossProfitKobo - operatingExpenseKobo;

    return {
      revenueKobo: revenueKobo.toString(),
      costOfSalesKobo: costOfSalesKobo.toString(),
      grossProfitKobo: grossProfitKobo.toString(),
      operatingExpenseKobo: operatingExpenseKobo.toString(),
      profitBeforeTaxKobo: profitBeforeTaxKobo.toString(),
      revenueLines: toLines(revenueRows),
      costOfSalesLines: toLines(costOfSalesRows),
      operatingExpenseLines: toLines(operatingExpenseRows),
    };
  }
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
