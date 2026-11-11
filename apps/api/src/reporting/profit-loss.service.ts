import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AccountType, FsCategory } from '@bioassetpro/database';
import { TrialBalanceService, type TrialBalanceFilter } from './trial-balance.service';

export interface ProfitLossLine {
  accountNumber: string;
  accountName: string;
  amountKobo: string;
}

export interface ProfitLoss {
  revenueKobo: string;
  otherIncomeKobo: string;
  otherExpenseKobo: string;
  costOfSalesKobo: string;
  grossProfitKobo: string;
  operatingExpenseKobo: string;
  profitBeforeTaxKobo: string;
  /** Income tax provided for (PCR-084, 650100) — below profit before tax. */
  incomeTaxKobo: string;
  profitAfterTaxKobo: string;
  revenueLines: ProfitLossLine[];
  otherIncomeLines: ProfitLossLine[];
  otherExpenseLines: ProfitLossLine[];
  costOfSalesLines: ProfitLossLine[];
  operatingExpenseLines: ProfitLossLine[];
  incomeTaxLines: ProfitLossLine[];
}

/**
 * Profit & Loss, as a read over the same ledger the Trial Balance already
 * proves is balanced.
 *
 * Uses finance-approved FS classifications. If an account with activity has
 * no classification, the report is blocked instead of silently misstating it.
 */
@Injectable()
export class ProfitLossService {
  constructor(private readonly trialBalance: TrialBalanceService) {}

  async build(filter: TrialBalanceFilter): Promise<ProfitLoss> {
    const built = await this.trialBalance.build(filter);
    const unclassified = built.rows.filter((row) => row.fsCategory === null);
    if (unclassified.length) {
      throw new UnprocessableEntityException({
        message: 'Classify all accounts with activity before producing financial statements.',
        accounts: unclassified.map(({ accountNumber, accountName }) => ({ accountNumber, accountName })),
      });
    }
    const invalid = built.rows.filter((row) => {
      if (!row.fsCategory) return false;
      const balanceSheetCategories: FsCategory[] = [FsCategory.CURRENT_ASSET, FsCategory.NON_CURRENT_ASSET, FsCategory.CURRENT_LIABILITY, FsCategory.NON_CURRENT_LIABILITY, FsCategory.EQUITY];
      const balanceSheet = balanceSheetCategories.includes(row.fsCategory);
      const temporaryTypes: AccountType[] = [AccountType.REVENUE, AccountType.EXPENSE];
      return balanceSheet ? row.accountType !== (row.fsCategory.includes('ASSET') ? AccountType.ASSET : row.fsCategory.includes('LIABILITY') ? AccountType.LIABILITY : AccountType.EQUITY) : !temporaryTypes.includes(row.accountType);
    });
    if (invalid.length) throw new UnprocessableEntityException({ message: 'FS category conflicts with the account type.', accounts: invalid.map(({ accountNumber, accountName }) => ({ accountNumber, accountName })) });

    const tb = {
      ...built,
      rows: built.rows.map((row) =>
        row.accountType === AccountType.EXPENSE
          ? { ...row, displayedBalanceKobo: row.netKobo }
          : { ...row, displayedBalanceKobo: -row.netKobo },
      ),
    };

    const rows = (category: FsCategory) => tb.rows.filter((row) => row.fsCategory === category);
    const revenueRows = rows(FsCategory.REVENUE);
    const otherIncomeRows = rows(FsCategory.OTHER_INCOME);
    const costOfSalesRows = rows(FsCategory.COST_OF_SALES);
    const otherExpenseRows = rows(FsCategory.OTHER_EXPENSE);
    const operatingExpenseRows = rows(FsCategory.OPERATING_EXPENSE);
    const incomeTaxRows = rows(FsCategory.INCOME_TAX);

    // Revenue is credit-normal, so `displayedBalanceKobo` is already positive
    // for a genuine credit balance; expenses are debit-normal, same reasoning.
    const revenueKobo = sumOf(revenueRows);
    const otherIncomeKobo = sumOf(otherIncomeRows);
    const otherExpenseKobo = sumOf(otherExpenseRows);
    const costOfSalesKobo = sumOf(costOfSalesRows);
    const operatingExpenseKobo = sumOf(operatingExpenseRows);
    const grossProfitKobo = revenueKobo - costOfSalesKobo;
    const profitBeforeTaxKobo = grossProfitKobo + otherIncomeKobo - otherExpenseKobo - operatingExpenseKobo;
    const incomeTaxKobo = sumOf(incomeTaxRows);
    const profitAfterTaxKobo = profitBeforeTaxKobo - incomeTaxKobo;

    return {
      revenueKobo: revenueKobo.toString(),
      otherIncomeKobo: otherIncomeKobo.toString(),
      otherExpenseKobo: otherExpenseKobo.toString(),
      costOfSalesKobo: costOfSalesKobo.toString(),
      grossProfitKobo: grossProfitKobo.toString(),
      operatingExpenseKobo: operatingExpenseKobo.toString(),
      profitBeforeTaxKobo: profitBeforeTaxKobo.toString(),
      incomeTaxKobo: incomeTaxKobo.toString(),
      profitAfterTaxKobo: profitAfterTaxKobo.toString(),
      revenueLines: toLines(revenueRows),
      otherIncomeLines: toLines(otherIncomeRows),
      otherExpenseLines: toLines(otherExpenseRows),
      costOfSalesLines: toLines(costOfSalesRows),
      operatingExpenseLines: toLines(operatingExpenseRows),
      incomeTaxLines: toLines(incomeTaxRows),
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
