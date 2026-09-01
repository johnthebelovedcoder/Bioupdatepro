import { Injectable } from '@nestjs/common';
import { AccountType } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { TrialBalanceService, type TrialBalanceFilter } from './trial-balance.service';
import { ProfitLossService } from './profit-loss.service';
import { currentFinancialYearId } from './current-financial-year';

export interface BalanceSheetLine {
  accountNumber: string;
  accountName: string;
  amountKobo: string;
}

export interface BalanceSheet {
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  totalAssetsKobo: string;
  totalLiabilitiesKobo: string;
  /** The current financial year's result, not yet swept to Retained Earnings
   * by a year-end close — shown as its own equity line rather than folded
   * silently into an account balance that doesn't actually contain it yet. */
  currentYearEarningsKobo: string;
  totalEquityKobo: string;
  totalLiabilitiesAndEquityKobo: string;
  balanced: boolean;
}

/**
 * Balance Sheet, as at now.
 *
 * Assets, liabilities and equity are permanent accounts — their balance is
 * cumulative since the company began, not reset each period — so this is
 * `TrialBalanceService.build()` with no period or year filter at all, then
 * split by `accountType`. No current/non-current split is attempted: the
 * chart carries no field for it, and nothing in it needs one yet.
 *
 * The one figure this computes rather than reads: mid-year, before any close
 * has run, the current year's revenue and expense are still sitting in their
 * own temporary accounts, not yet swept into Retained Earnings — the same
 * gap `YearEndService.close()` exists to close, just not closed yet. Without
 * accounting for it the sheet would never balance between closes, so the
 * current year's P&L result (from `ProfitLossService`, the exact figure a
 * close would sweep) is added as its own equity line.
 */
@Injectable()
export class BalanceSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trialBalance: TrialBalanceService,
    private readonly profitLoss: ProfitLossService,
  ) {}

  async build(filter: Omit<TrialBalanceFilter, 'financialPeriodId' | 'financialYearId'>): Promise<BalanceSheet> {
    const tb = await this.trialBalance.build(filter);

    const assets = toLines(tb.rows.filter((row) => row.accountType === AccountType.ASSET));
    const liabilities = toLines(
      tb.rows.filter((row) => row.accountType === AccountType.LIABILITY),
    );
    const equity = toLines(tb.rows.filter((row) => row.accountType === AccountType.EQUITY));

    const currentYearId = await currentFinancialYearId(this.prisma, filter.companyId);
    const currentYearEarningsKobo = currentYearId
      ? BigInt(
          (await this.profitLoss.build({ ...filter, financialYearId: currentYearId }))
            .profitBeforeTaxKobo,
        )
      : 0n;

    const totalAssetsKobo = sumByType(tb.rows, AccountType.ASSET);
    const totalLiabilitiesKobo = sumByType(tb.rows, AccountType.LIABILITY);
    const totalEquityKobo = sumByType(tb.rows, AccountType.EQUITY) + currentYearEarningsKobo;
    const totalLiabilitiesAndEquityKobo = totalLiabilitiesKobo + totalEquityKobo;

    return {
      assets,
      liabilities,
      equity,
      totalAssetsKobo: totalAssetsKobo.toString(),
      totalLiabilitiesKobo: totalLiabilitiesKobo.toString(),
      currentYearEarningsKobo: currentYearEarningsKobo.toString(),
      totalEquityKobo: totalEquityKobo.toString(),
      totalLiabilitiesAndEquityKobo: totalLiabilitiesAndEquityKobo.toString(),
      balanced: totalAssetsKobo === totalLiabilitiesAndEquityKobo,
    };
  }
}

/**
 * Type-canonical sign — debit-positive for assets, credit-positive for
 * liabilities and equity — regardless of any individual row's own
 * `normalBalance`. A contra account (e.g. Accumulated Depreciation: an
 * ASSET-type row with a CREDIT normal balance) must still net *against*
 * its type's total, not add on top of it the way `displayedBalanceKobo`
 * would if summed directly — that field is signed per-row for line-item
 * display, not per-type for totalling.
 */
function sumByType(
  rows: Array<{ accountType: AccountType; netKobo: bigint }>,
  type: AccountType,
): bigint {
  const sign = type === AccountType.ASSET ? 1n : -1n;
  return rows
    .filter((row) => row.accountType === type)
    .reduce((sum, row) => sum + sign * row.netKobo, 0n);
}

function toLines(
  rows: Array<{ accountNumber: string; accountName: string; displayedBalanceKobo: bigint }>,
): BalanceSheetLine[] {
  return rows.map((row) => ({
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    amountKobo: row.displayedBalanceKobo.toString(),
  }));
}
