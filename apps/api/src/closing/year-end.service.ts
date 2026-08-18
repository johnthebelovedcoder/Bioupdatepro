import { Injectable, Logger } from '@nestjs/common';
import {
  AccountType,
  AuditAction,
  CloseAction,
  NormalBalance,
  PeriodStatus,
  Prisma,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { TrialBalanceService } from '../reporting/trial-balance.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface YearEndValidation {
  yearCode: string;
  canClose: boolean;
  findings: Array<{
    code: string;
    name: string;
    blocking: boolean;
    passed: boolean;
    detail: string;
  }>;
}

export interface YearEndResult {
  yearCode: string;
  closingJournalId: string | null;
  openingJournalId: string | null;
  retainedEarningsKobo: string;
  balancesCarried: number;
  nextYearCode: string | null;
}

/**
 * Year-End Closing (§8).
 *
 * §8 developer note 1: "Year-End Close Wizard must run as a single controlled
 * transaction — any validation failure rolls back completely, never partially
 * closes." That sentence is why `close()` below does everything inside one
 * database transaction: close the year, post the closing journal, write the
 * balances, create the new year, and post the opening journal. A year that is
 * half-closed — revenue swept but no opening balances, say — is worse than one
 * not closed at all, because the ledger looks finished and is not.
 *
 * WHAT A YEAR-END ACTUALLY DOES, AND WHY THE TWO JOURNALS DIFFER:
 *
 *   Revenue and expense accounts measure a PERIOD. At year end their balances
 *   are swept to retained earnings and they start the new year at zero — that
 *   is the closing journal.
 *
 *   Assets, liabilities and equity measure a POSITION. They carry forward
 *   unchanged — that is the opening journal.
 *
 *   Getting this backwards is the classic year-end error: carrying revenue
 *   forward makes every subsequent year's profit cumulative, and it is not
 *   obvious from the face of the accounts for months.
 */
@Injectable()
export class YearEndService {
  private readonly logger = new Logger(YearEndService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly trialBalance: TrialBalanceService,
  ) {}

  /**
   * Everything that must be true before a year can close.
   *
   * Run separately from `close()` so a finance team can see the list, fix it,
   * and re-check without triggering anything.
   */
  async validate(financialYearId: string): Promise<YearEndValidation> {
    const year = await this.prisma.financialYear.findUniqueOrThrow({
      where: { id: financialYearId },
      include: { periods: true },
    });

    const findings: YearEndValidation['findings'] = [];

    // --- Every period closed ------------------------------------------------
    const openPeriods = year.periods.filter(
      (p) => p.status !== PeriodStatus.CLOSED && p.status !== PeriodStatus.ARCHIVED,
    );
    findings.push({
      code: 'ALL_PERIODS_CLOSED',
      name: 'Every period is closed',
      blocking: true,
      passed: openPeriods.length === 0,
      detail:
        openPeriods.length === 0
          ? `All ${year.periods.length} periods are closed.`
          : `${openPeriods.length} period(s) still open: ` +
            openPeriods.map((p) => `${p.name} (${p.status})`).join(', '),
    });

    // --- The year's trial balance balances ---------------------------------
    const tb = await this.trialBalance.build({
      companyId: year.companyId,
      financialYearId,
    });
    findings.push({
      code: 'TRIAL_BALANCE',
      name: 'Trial balance balances for the year',
      blocking: true,
      passed: tb.balanced,
      detail: tb.balanced
        ? `Debits and credits both ${tb.totalDebitKobo} kobo.`
        : `OUT OF BALANCE by ${tb.totalDebitKobo - tb.totalCreditKobo} kobo.`,
    });

    // --- A retained earnings account exists --------------------------------
    const retained = await this.findRetainedEarnings(year.companyId);
    findings.push({
      code: 'RETAINED_EARNINGS_ACCOUNT',
      name: 'Retained earnings account configured',
      blocking: true,
      passed: retained !== null,
      detail: retained
        ? `Using ${retained.accountNumber} ${retained.name}.`
        : `No equity account is configured to receive the year's result. Revenue and ` +
          `expense have nowhere to be swept to.`,
    });

    // --- Not already closed -------------------------------------------------
    const alreadyClosed = await this.prisma.accountBalance.count({
      where: { financialYearId, isOpening: false },
    });
    findings.push({
      code: 'NOT_ALREADY_CLOSED',
      name: 'Year not already closed',
      blocking: true,
      passed: alreadyClosed === 0,
      detail:
        alreadyClosed === 0
          ? 'No closing balances recorded yet.'
          : `This year already has ${alreadyClosed} closing balances. Reopen it before ` +
            `closing again.`,
    });

    // --- Tax periods filed --------------------------------------------------
    // Not blocking: a return can legitimately be filed after the management
    // close. Surfaced because closing a year with an unfiled return is a thing
    // people want to know about.
    const unfiled = await this.prisma.taxPeriod.count({
      where: {
        companyId: year.companyId,
        startDate: { gte: year.startDate },
        endDate: { lte: year.endDate },
        status: { not: 'FILED' },
      },
    });
    findings.push({
      code: 'TAX_PERIODS_FILED',
      name: 'Tax returns filed',
      blocking: false,
      passed: unfiled === 0,
      detail:
        unfiled === 0
          ? 'Every tax period for this year has been filed.'
          : `${unfiled} tax period(s) for this year are not yet filed.`,
    });

    return {
      yearCode: year.code,
      canClose: findings.every((f) => !f.blocking || f.passed),
      findings,
    };
  }

  /**
   * Close the year.
   *
   * ONE transaction, per §8 note 1. Everything below either happens together or
   * not at all:
   *   1. Sweep revenue and expense to retained earnings (the closing journal)
   *   2. Record every account's closing balance
   *   3. Create the next financial year and its periods
   *   4. Post the opening journal carrying the balance-sheet accounts forward
   *   5. Record every account's opening balance
   *   6. Mark the year closed and log it
   */
  async close(params: {
    financialYearId: string;
    actor: WorkflowActor;
    /** Where the year's result is swept to. Resolved by convention if omitted. */
    retainedEarningsGlAccountId?: string | null;
    /** Whether to create the following year and roll balances into it. */
    rollForward?: boolean;
    nextYearCode?: string | null;
  }): Promise<YearEndResult> {
    const validation = await this.validate(params.financialYearId);
    if (!validation.canClose) {
      const blockers = validation.findings.filter((f) => f.blocking && !f.passed);
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Year-end close',
        `${validation.yearCode} will not close: ` +
          blockers.map((b) => `${b.name} — ${b.detail}`).join(' | '),
        { findings: blockers as unknown as Prisma.InputJsonValue },
      );
    }

    const year = await this.prisma.financialYear.findUniqueOrThrow({
      where: { id: params.financialYearId },
      include: { company: true, periods: { orderBy: { periodNumber: 'asc' } } },
    });

    const retained = params.retainedEarningsGlAccountId
      ? await this.prisma.gLAccount.findUniqueOrThrow({
          where: { id: params.retainedEarningsGlAccountId },
        })
      : (await this.findRetainedEarnings(year.companyId))!;

    // The trial balance as at year end, per account.
    const tb = await this.trialBalance.build({
      companyId: year.companyId,
      financialYearId: params.financialYearId,
    });

    const lastPeriod = year.periods[year.periods.length - 1]!;
    const firstPeriod = year.periods[0]!;

    return this.prisma.$transaction(
      async (tx) => {
        // --- 1. Sweep revenue and expense to retained earnings --------------
        const temporaryRows = tb.rows.filter(
          (row) =>
            row.accountType === AccountType.REVENUE ||
            row.accountType === AccountType.EXPENSE,
        );

        let closingJournalId: string | null = null;
        let resultKobo = 0n;

        const closingLines: Array<{
          glAccountId: string;
          description: string;
          debit?: bigint;
          credit?: bigint;
        }> = [];

        for (const row of temporaryRows) {
          const net = row.totalDebitKobo - row.totalCreditKobo;
          if (net === 0n) continue;

          // Post the opposite of the balance to bring the account to zero.
          if (net > 0n) {
            closingLines.push({
              glAccountId: row.glAccountId,
              description: `Year-end close — ${row.accountNumber}`,
              credit: net,
            });
          } else {
            closingLines.push({
              glAccountId: row.glAccountId,
              description: `Year-end close — ${row.accountNumber}`,
              debit: -net,
            });
          }
          resultKobo += net;
        }

        if (closingLines.length > 0) {
          // resultKobo is net debits across revenue and expense. Expenses are
          // debits and revenue credits, so a POSITIVE figure means expenses
          // exceeded revenue — a loss, which reduces retained earnings.
          if (resultKobo > 0n) {
            closingLines.push({
              glAccountId: retained.id,
              description: `Loss for ${year.code} transferred to retained earnings`,
              debit: resultKobo,
            });
          } else if (resultKobo < 0n) {
            closingLines.push({
              glAccountId: retained.id,
              description: `Profit for ${year.code} transferred to retained earnings`,
              credit: -resultKobo,
            });
          }
        }

        // --- 1b. Carry the balance sheet forward ----------------------------
        //
        // The closing position of every permanent account, AFTER the sweep
        // above has moved the year's result into retained earnings. Note that
        // retained earnings frequently has no movement of its own during the
        // year, so it may be absent from the trial balance entirely — it still
        // has to appear here, or the year's profit would vanish at the year
        // boundary.
        //
        // The sign: `resultKobo` is net DEBITS across revenue and expense, so a
        // profit is negative. The sweep credited retained earnings by that
        // amount, which moves its net (debits less credits) by exactly
        // `resultKobo` — hence PLUS. A profit therefore leaves retained
        // earnings with a credit balance and a loss with a debit one, which is
        // what each should be.
        const carryForward = new Map<string, { net: bigint; accountNumber: string }>();
        for (const row of tb.rows) {
          if (
            row.accountType !== AccountType.ASSET &&
            row.accountType !== AccountType.LIABILITY &&
            row.accountType !== AccountType.EQUITY
          ) {
            continue; // Revenue and expense were just swept to zero.
          }
          carryForward.set(row.glAccountId, {
            net: row.totalDebitKobo - row.totalCreditKobo,
            accountNumber: row.accountNumber,
          });
        }
        if (resultKobo !== 0n) {
          const existing = carryForward.get(retained.id);
          carryForward.set(retained.id, {
            net: (existing?.net ?? 0n) + resultKobo,
            accountNumber: existing?.accountNumber ?? retained.accountNumber,
          });
        }

        // This is a hard close: the old year's books are brought to zero on
        // EVERY account, and the new year opens with an explicit opening
        // journal (step 3 below) that restates the balance sheet. The two are a
        // matched pair and neither may exist without the other, which is why
        // the reversal is emitted only when we are actually rolling forward —
        // otherwise the balances would be closed out with nowhere to go.
        //
        // This reversal is balanced on its own: after the sweep, assets equal
        // liabilities plus equity by construction, so the permanent accounts'
        // net balances sum to zero.
        //
        // The cost of a hard close is that the closed year can no longer be
        // reported from cumulative GL movement — which is exactly why §8
        // requires the AccountBalance snapshot written in step 2.
        if (params.rollForward !== false) {
          for (const [glAccountId, entry] of carryForward) {
            if (entry.net === 0n) continue;
            closingLines.push({
              glAccountId,
              description: `Balance carried forward — ${entry.accountNumber}`,
              ...(entry.net > 0n ? { credit: entry.net } : { debit: -entry.net }),
            });
          }
        }

        if (closingLines.length > 0) {
          const dimensions = {
            companyId: year.companyId,
            branchId: await this.defaultBranchId(year.companyId, tx),
            financialYearId: year.id,
            financialPeriodId: lastPeriod.id,
            currencyId: year.company.baseCurrencyId,
            exchangeRate: '1.00000000',
          };

          const posted = await this.posting.post(
            {
              sourceModule: 'closing',
              sourceDocumentType: 'YearEndClose',
              sourceDocumentId: year.id,
              journalNumber: `YE-CLOSE-${year.code}`,
              journalDate: year.endDate,
              narration: `Year-end close of ${year.code}`,
              ...dimensions,
              idempotencyKey: `year-end-close:${year.id}`,
              isClosingEntry: true,
              actor: params.actor,
              lines: closingLines.map((line) => ({
                glAccountId: line.glAccountId,
                description: line.description,
                debit: line.debit !== undefined ? kobo(line.debit) : undefined,
                credit: line.credit !== undefined ? kobo(line.credit) : undefined,
                dimensions,
              })),
            },
            tx,
          );
          closingJournalId = posted.journalEntryId;
        }

        // --- 2. Record closing balances -------------------------------------
        for (const row of tb.rows) {
          await tx.accountBalance.create({
            data: {
              companyId: year.companyId,
              financialYearId: year.id,
              glAccountId: row.glAccountId,
              isOpening: false,
              totalDebitKobo: row.totalDebitKobo,
              totalCreditKobo: row.totalCreditKobo,
              balanceKobo: row.displayedBalanceKobo,
            },
          });
        }

        // --- 3 to 5. Roll forward -------------------------------------------
        let openingJournalId: string | null = null;
        let nextYearCode: string | null = null;
        let carried = 0;

        if (params.rollForward !== false) {
          const nextYear = await this.createNextYear(
            year,
            params.nextYearCode ?? null,
            tx,
          );
          nextYearCode = nextYear.year.code;

          // The exact mirror of the carry-forward reversal in step 1b. Only
          // permanent accounts appear: revenue and expense were swept to zero
          // and must start the new year there.
          const openingLines: Array<{
            glAccountId: string;
            description: string;
            debit?: bigint;
            credit?: bigint;
          }> = [];

          for (const [glAccountId, entry] of carryForward) {
            if (entry.net === 0n) continue;

            openingLines.push({
              glAccountId,
              description: `Opening balance ${nextYear.year.code} — ${entry.accountNumber}`,
              ...(entry.net > 0n ? { debit: entry.net } : { credit: -entry.net }),
            });
            carried += 1;
          }

          if (openingLines.length > 0) {
            const dimensions = {
              companyId: year.companyId,
              branchId: await this.defaultBranchId(year.companyId, tx),
              financialYearId: nextYear.year.id,
              financialPeriodId: nextYear.firstPeriod.id,
              currencyId: year.company.baseCurrencyId,
              exchangeRate: '1.00000000',
            };

            const posted = await this.posting.post(
              {
                sourceModule: 'closing',
                sourceDocumentType: 'YearEndRollForward',
                sourceDocumentId: nextYear.year.id,
                journalNumber: `YE-OPEN-${nextYear.year.code}`,
                journalDate: nextYear.year.startDate,
                narration: `Opening balances for ${nextYear.year.code}`,
                ...dimensions,
                idempotencyKey: `year-end-open:${nextYear.year.id}`,
                isClosingEntry: true,
                actor: params.actor,
                lines: openingLines.map((line) => ({
                  glAccountId: line.glAccountId,
                  description: line.description,
                  debit: line.debit !== undefined ? kobo(line.debit) : undefined,
                  credit: line.credit !== undefined ? kobo(line.credit) : undefined,
                  dimensions,
                })),
              },
              tx,
            );
            openingJournalId = posted.journalEntryId;

            for (const line of openingLines) {
              const debit = line.debit ?? 0n;
              const credit = line.credit ?? 0n;
              await tx.accountBalance.create({
                data: {
                  companyId: year.companyId,
                  financialYearId: nextYear.year.id,
                  glAccountId: line.glAccountId,
                  isOpening: true,
                  totalDebitKobo: debit,
                  totalCreditKobo: credit,
                  balanceKobo: debit - credit,
                  journalEntryId: openingJournalId,
                },
              });
            }
          }
        }

        // --- 6. Close the year and log it -----------------------------------
        await tx.financialYear.update({
          where: { id: year.id },
          data: { status: PeriodStatus.CLOSED },
        });
        await tx.financialPeriod.updateMany({
          where: { financialYearId: year.id },
          data: { status: PeriodStatus.ARCHIVED },
        });

        await tx.periodCloseLog.create({
          data: {
            companyId: year.companyId,
            financialYearId: year.id,
            action: CloseAction.YEAR_END_CLOSE,
            fromStatus: year.status,
            toStatus: PeriodStatus.CLOSED,
            totalDebitKobo: tb.totalDebitKobo,
            totalCreditKobo: tb.totalCreditKobo,
            snapshot: {
              validation,
              resultKobo: resultKobo.toString(),
              closingJournalId,
              openingJournalId,
              balancesCarried: carried,
            } as unknown as Prisma.InputJsonValue,
            reason: `Year-end close of ${year.code}`,
            performedById: params.actor.userId,
          },
        });

        await this.audit.write(
          {
            transactionId: year.id,
            module: 'closing',
            entityType: 'FinancialYear',
            entityId: year.id,
            status: PeriodStatus.CLOSED,
            action: AuditAction.PERIOD_CLOSE,
            userId: params.actor.userId,
            comments: `Closed financial year ${year.code}.`,
            metadata: {
              yearCode: year.code,
              // The result is reported as a profit-positive figure, which is
              // how a human reads it, rather than the debit-positive internal
              // sign.
              resultKobo: (-resultKobo).toString(),
              closingJournalId,
              openingJournalId,
              nextYearCode,
            },
          },
          tx,
        );

        this.logger.log(
          `Closed ${year.code}: result ${-resultKobo} kobo, ${carried} balances carried forward.`,
        );

        return {
          yearCode: year.code,
          closingJournalId,
          openingJournalId,
          retainedEarningsKobo: (-resultKobo).toString(),
          balancesCarried: carried,
          nextYearCode,
        };
      },
      // A year-end touches every account twice and creates a year of periods.
      // The default timeout is tuned for a single document, not for this.
      { timeout: 120_000, maxWait: 20_000 },
    );
  }

  /** The stored closing or opening position for a year. */
  async balances(financialYearId: string, isOpening: boolean) {
    const balances = await this.prisma.accountBalance.findMany({
      where: { financialYearId, isOpening },
      include: {
        glAccount: {
          select: { accountNumber: true, name: true, accountType: true },
        },
      },
      orderBy: { glAccount: { accountNumber: 'asc' } },
    });

    return balances.map((balance) => ({
      accountNumber: balance.glAccount.accountNumber,
      accountName: balance.glAccount.name,
      accountType: balance.glAccount.accountType,
      totalDebitKobo: balance.totalDebitKobo.toString(),
      totalCreditKobo: balance.totalCreditKobo.toString(),
      balanceKobo: balance.balanceKobo.toString(),
    }));
  }

  // -------------------------------------------------------------------------

  /**
   * The equity account the year's result is swept to.
   *
   * Looks for the conventional number first, then any equity account whose name
   * says what it is. Returns null rather than guessing at some other equity
   * account — sweeping a year's profit into share capital would be worse than
   * refusing to close.
   */
  private async findRetainedEarnings(companyId: string) {
    const byNumber = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber: '3200', active: true, isPostingAccount: true },
    });
    if (byNumber) return byNumber;

    return this.prisma.gLAccount.findFirst({
      where: {
        companyId,
        accountType: AccountType.EQUITY,
        active: true,
        isPostingAccount: true,
        name: { contains: 'Retained', mode: 'insensitive' },
      },
    });
  }

  private async defaultBranchId(
    companyId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const branch = await tx.branch.findFirst({
      where: { companyId, active: true },
      orderBy: { code: 'asc' },
    });
    if (!branch) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §1.1 — Enterprise Dimensions',
        `The company has no active branch, and branch is mandatory on every GL line.`,
        { companyId },
      );
    }
    return branch.id;
  }

  /**
   * Create the following year and its periods, mirroring the outgoing year's
   * period structure rather than assuming twelve calendar months.
   */
  private async createNextYear(
    year: {
      id: string;
      companyId: string;
      code: string;
      startDate: Date;
      endDate: Date;
      periods: Array<{ periodNumber: number; name: string; startDate: Date; endDate: Date }>;
    },
    explicitCode: string | null,
    tx: Prisma.TransactionClient,
  ) {
    const nextStart = new Date(year.endDate);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    const nextEnd = new Date(
      Date.UTC(
        nextStart.getUTCFullYear() + 1,
        nextStart.getUTCMonth(),
        nextStart.getUTCDate(),
      ),
    );
    nextEnd.setUTCDate(nextEnd.getUTCDate() - 1);

    const code = explicitCode ?? `FY${nextStart.getUTCFullYear()}`;

    const existing = await tx.financialYear.findFirst({
      where: { companyId: year.companyId, code },
    });
    if (existing) {
      const firstPeriod = await tx.financialPeriod.findFirstOrThrow({
        where: { financialYearId: existing.id },
        orderBy: { periodNumber: 'asc' },
      });
      return { year: existing, firstPeriod };
    }

    const created = await tx.financialYear.create({
      data: {
        companyId: year.companyId,
        code,
        startDate: nextStart,
        endDate: nextEnd,
      },
    });

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    for (const period of year.periods) {
      const start = new Date(period.startDate);
      const end = new Date(period.endDate);
      start.setUTCFullYear(start.getUTCFullYear() + 1);
      // Recompute the month end rather than shifting the day, so February in a
      // leap year lands correctly.
      const shiftedEnd = new Date(
        Date.UTC(end.getUTCFullYear() + 1, end.getUTCMonth() + 1, 0),
      );

      await tx.financialPeriod.create({
        data: {
          financialYearId: created.id,
          periodNumber: period.periodNumber,
          name: `${monthNames[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
          startDate: start,
          endDate: shiftedEnd,
        },
      });
    }

    const firstPeriod = await tx.financialPeriod.findFirstOrThrow({
      where: { financialYearId: created.id },
      orderBy: { periodNumber: 'asc' },
    });

    return { year: created, firstPeriod };
  }
}
