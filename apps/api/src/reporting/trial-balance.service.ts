import { Injectable } from '@nestjs/common';
import { AccountType, NormalBalance } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { EnterpriseDimensions } from '../enterprise-dimensions/dimensions.types';

/// Carried across periods within a year for the roll-forward (US-897-029);
/// revenue and expense are deliberately excluded — see `build()`.
const PERMANENT_ACCOUNT_TYPES: readonly AccountType[] = [
  AccountType.ASSET,
  AccountType.LIABILITY,
  AccountType.EQUITY,
];

export interface TrialBalanceRow {
  glAccountId: string;
  accountNumber: string;
  accountName: string;
  /// Needed to separate temporary accounts (revenue, expense) from permanent
  /// ones at year end: the first are swept to retained earnings, the second
  /// carry forward.
  accountType: AccountType;
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
    // A single financialPeriodId used to mean "only this period's movement,"
    // for every account. That is right for revenue/expense — a P&L account
    // resets each period by convention — but wrong for a balance-sheet
    // account, whose whole point is a running position: filtered to period 3,
    // a bank account should show its balance as at period 3, not what moved
    // through it in period 3 alone. Unfiltered and year-only queries are
    // unaffected; they already summed everything they were asked to.
    let periodsThroughThis: string[] | undefined;
    if (filter.financialPeriodId) {
      const period = await this.prisma.financialPeriod.findUniqueOrThrow({
        where: { id: filter.financialPeriodId },
        select: { financialYearId: true, periodNumber: true },
      });
      const periods = await this.prisma.financialPeriod.findMany({
        where: {
          financialYearId: period.financialYearId,
          periodNumber: { lte: period.periodNumber },
        },
        select: { id: true },
      });
      periodsThroughThis = periods.map((p) => p.id);
    }

    const dimensionFilter = {
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.costCentreId ? { costCentreId: filter.costCentreId } : {}),
      ...(filter.farmId ? { farmId: filter.farmId } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
    };

    const grouped = await this.prisma.journalLine.groupBy({
      by: ['glAccountId'],
      where: {
        companyId: filter.companyId,
        ...(periodsThroughThis
          ? { financialPeriodId: { in: periodsThroughThis } }
          : filter.financialYearId
            ? { financialYearId: filter.financialYearId }
            : {}),
        ...dimensionFilter,
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
        accountType: true,
        normalBalance: true,
      },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    // The roll-forward above pulled every period's movement for revenue and
    // expense accounts too, which is wrong for THEM specifically — re-sum
    // just the one period asked for, and use that instead when displaying a
    // temporary account's row. Accounts with no activity in that single
    // period are not in this map at all, and correctly show as zero rather
    // than falling back to the rolled-forward figure.
    let temporaryPeriodOnly: Map<string, { debit: bigint; credit: bigint }> | undefined;
    if (filter.financialPeriodId && periodsThroughThis && periodsThroughThis.length > 1) {
      const temporaryIds = accounts
        .filter((a) => !PERMANENT_ACCOUNT_TYPES.includes(a.accountType))
        .map((a) => a.id);
      if (temporaryIds.length > 0) {
        const periodOnly = await this.prisma.journalLine.groupBy({
          by: ['glAccountId'],
          where: {
            companyId: filter.companyId,
            financialPeriodId: filter.financialPeriodId,
            glAccountId: { in: temporaryIds },
            ...dimensionFilter,
            journalEntry: { status: 'POSTED' },
          },
          _sum: { debitKobo: true, creditKobo: true },
        });
        temporaryPeriodOnly = new Map(
          periodOnly.map((g) => [
            g.glAccountId,
            { debit: g._sum.debitKobo ?? 0n, credit: g._sum.creditKobo ?? 0n },
          ]),
        );
      }
    }

    const rows: TrialBalanceRow[] = grouped
      .map((g) => {
        const account = byId.get(g.glAccountId);
        const accountType = account?.accountType ?? AccountType.ASSET;
        const isTemporary = !PERMANENT_ACCOUNT_TYPES.includes(accountType);
        // Only a temporary account, and only when roll-forward is actually
        // active, defers to the single-period figure — missing from the map
        // means zero activity that period, not "fall back to the rolled-
        // forward total."
        const debit =
          isTemporary && temporaryPeriodOnly
            ? (temporaryPeriodOnly.get(g.glAccountId)?.debit ?? 0n)
            : (g._sum.debitKobo ?? 0n);
        const credit =
          isTemporary && temporaryPeriodOnly
            ? (temporaryPeriodOnly.get(g.glAccountId)?.credit ?? 0n)
            : (g._sum.creditKobo ?? 0n);
        const net = debit - credit;
        const normalBalance = account?.normalBalance ?? NormalBalance.DEBIT;
        return {
          glAccountId: g.glAccountId,
          accountNumber: account?.accountNumber ?? '(unknown)',
          accountName: account?.name ?? '(unknown)',
          accountType,
          normalBalance,
          totalDebitKobo: debit,
          totalCreditKobo: credit,
          netKobo: net,
          displayedBalanceKobo:
            normalBalance === NormalBalance.DEBIT ? net : -net,
        };
      })
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

    // Deliberately summed from the roll-forward query, not from the possibly
    // period-overridden rows above: this is "is the ledger through this
    // period internally consistent," which every posted entry guarantees by
    // construction, regardless of which convention a given row displays.
    const totalDebitKobo = grouped.reduce((s, g) => s + (g._sum.debitKobo ?? 0n), 0n);
    const totalCreditKobo = grouped.reduce((s, g) => s + (g._sum.creditKobo ?? 0n), 0n);

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

  /**
   * The journal lines behind one TB row — US-897-033/037's own "drill-through
   * reaches the underlying transaction" criterion.
   *
   * Mirrors `build()`'s own period-scoping exactly rather than re-deriving a
   * simplified rule, so the lines returned always sum to the same figure the
   * screen showed for this row: a temporary account (revenue/expense) under a
   * period filter is scoped to that ONE period, matching the roll-forward
   * override `build()` applies for temporary accounts specifically; a
   * permanent account is scoped to every period up to and including the one
   * asked for, matching its own running-balance nature.
   */
  async drillThrough(
    accountNumber: string,
    filter: TrialBalanceFilter,
    page = 1,
    pageSize = 25,
  ) {
    const account = await this.prisma.gLAccount.findFirstOrThrow({
      where: { companyId: filter.companyId, accountNumber },
    });

    let periodsThroughThis: string[] | undefined;
    if (filter.financialPeriodId) {
      const period = await this.prisma.financialPeriod.findUniqueOrThrow({
        where: { id: filter.financialPeriodId },
        select: { financialYearId: true, periodNumber: true },
      });
      const periods = await this.prisma.financialPeriod.findMany({
        where: {
          financialYearId: period.financialYearId,
          periodNumber: { lte: period.periodNumber },
        },
        select: { id: true },
      });
      periodsThroughThis = periods.map((p) => p.id);
    }

    const isTemporary = !PERMANENT_ACCOUNT_TYPES.includes(account.accountType);
    const periodCondition =
      isTemporary && filter.financialPeriodId
        ? { financialPeriodId: filter.financialPeriodId }
        : periodsThroughThis
          ? { financialPeriodId: { in: periodsThroughThis } }
          : filter.financialYearId
            ? { financialYearId: filter.financialYearId }
            : {};

    const dimensionFilter = {
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.costCentreId ? { costCentreId: filter.costCentreId } : {}),
      ...(filter.farmId ? { farmId: filter.farmId } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
    };

    const where = {
      companyId: filter.companyId,
      glAccountId: account.id,
      ...periodCondition,
      ...dimensionFilter,
      journalEntry: { status: 'POSTED' as const },
    };

    const [total, lines] = await Promise.all([
      this.prisma.journalLine.count({ where }),
      this.prisma.journalLine.findMany({
        where,
        orderBy: [{ journalEntry: { journalDate: 'desc' } }, { journalEntry: { createdAt: 'desc' } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          journalEntry: {
            select: { id: true, journalNumber: true, journalDate: true, narration: true, sourceModule: true },
          },
          costCentre: { select: { code: true } },
        },
      }),
    ]);

    return {
      accountNumber: account.accountNumber,
      accountName: account.name,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      total,
      lines: lines.map((l) => ({
        journalEntryId: l.journalEntry.id,
        journalNumber: l.journalEntry.journalNumber,
        journalDate: l.journalEntry.journalDate,
        narration: l.journalEntry.narration,
        sourceModule: l.journalEntry.sourceModule,
        costCentre: l.costCentre?.code ?? null,
        description: l.description,
        debitKobo: l.debitKobo.toString(),
        creditKobo: l.creditKobo.toString(),
      })),
    };
  }
}
