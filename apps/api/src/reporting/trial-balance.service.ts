import { Injectable } from '@nestjs/common';
import { NormalBalance } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { EnterpriseDimensions } from '../enterprise-dimensions/dimensions.types';

export interface TrialBalanceRow {
  glAccountId: string;
  accountNumber: string;
  accountName: string;
  normalBalance: NormalBalance;
  totalDebitKobo: bigint;
  totalCreditKobo: bigint;
  /** Debit-positive. */
  netKobo: bigint;
  /** Signed so a normal-balance account reads positive. */
  displayedBalanceKobo: bigint;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitKobo: bigint;
  totalCreditKobo: bigint;
  /** Exact integer equality. Always true if the poster did its job. */
  balanced: boolean;
}

export type TrialBalanceFilter = {
  companyId: string;
  financialPeriodId?: string;
  financialYearId?: string;
} & Partial<
  Pick<
    EnterpriseDimensions,
    'branchId' | 'costCentreId' | 'farmId' | 'departmentId' | 'projectId'
  >
>;

/**
 * The trial balance, and the control that proves the ledger holds.
 *
 * This is the query the whole embedded-dimension decision was made for: a flat
 * indexed aggregate over journal_lines with no join to the header, filterable
 * on any dimension. Replaces the `TB_WIP_Control` sheet's SUMIF logic.
 */
@Injectable()
export class TrialBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async build(filter: TrialBalanceFilter): Promise<TrialBalance> {
    const grouped = await this.prisma.journalLine.groupBy({
      by: ['glAccountId'],
      where: {
        companyId: filter.companyId,
        ...(filter.financialPeriodId
          ? { financialPeriodId: filter.financialPeriodId }
          : {}),
        ...(filter.financialYearId
          ? { financialYearId: filter.financialYearId }
          : {}),
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        ...(filter.costCentreId ? { costCentreId: filter.costCentreId } : {}),
        ...(filter.farmId ? { farmId: filter.farmId } : {}),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        // Only posted journals appear in the trial balance. Drafts are not
        // accounting records.
        journalEntry: { status: 'POSTED' },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });

    const accounts = await this.prisma.gLAccount.findMany({
      where: { id: { in: grouped.map((g) => g.glAccountId) } },
      select: {
        id: true,
        accountNumber: true,
        name: true,
        normalBalance: true,
      },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const rows: TrialBalanceRow[] = grouped
      .map((g) => {
        const account = byId.get(g.glAccountId);
        const debit = g._sum.debitKobo ?? 0n;
        const credit = g._sum.creditKobo ?? 0n;
        const net = debit - credit;
        const normalBalance = account?.normalBalance ?? NormalBalance.DEBIT;
        return {
          glAccountId: g.glAccountId,
          accountNumber: account?.accountNumber ?? '(unknown)',
          accountName: account?.name ?? '(unknown)',
          normalBalance,
          totalDebitKobo: debit,
          totalCreditKobo: credit,
          netKobo: net,
          displayedBalanceKobo:
            normalBalance === NormalBalance.DEBIT ? net : -net,
        };
      })
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

    const totalDebitKobo = rows.reduce((s, r) => s + r.totalDebitKobo, 0n);
    const totalCreditKobo = rows.reduce((s, r) => s + r.totalCreditKobo, 0n);

    return {
      rows,
      totalDebitKobo,
      totalCreditKobo,
      balanced: totalDebitKobo === totalCreditKobo,
    };
  }

  /** Balance of a single account under any dimensional filter. Debit-positive. */
  async accountBalance(
    accountNumber: string,
    filter: TrialBalanceFilter,
  ): Promise<bigint> {
    const tb = await this.build(filter);
    const row = tb.rows.find((r) => r.accountNumber === accountNumber);
    return row?.netKobo ?? 0n;
  }
}
