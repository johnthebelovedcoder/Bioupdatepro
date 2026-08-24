import { Injectable } from '@nestjs/common';
import { PeriodStatus, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { ClosedPeriodError } from '../common/errors';

/**
 * Roles permitted to post into a soft-closed period.
 * Consolidated Reference §8: "only Finance Manager / Finance Controller /
 * Administrator may post adjustments; all others blocked."
 *
 * Configuration, not a constant to be edited in code later — Phase 11 moves
 * this into the period-close configuration table. Named here so the rule is
 * visible and testable now.
 */
export const SOFT_CLOSE_POSTING_ROLES = [
  'FINANCE_MANAGER',
  'FINANCE_CONTROLLER',
  'ADMINISTRATOR',
] as const;

@Injectable()
export class PeriodService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gate every posting on period status.
   *
   *   OPEN        — accepts postings from anyone otherwise authorised
   *   SOFT_CLOSED — accepts postings only from the finance roles above
   *   CLOSED      — accepts nothing; reopening is a workflow-governed action
   *   ARCHIVED    — accepts nothing, ever
   *
   * THE ONE EXEMPTION: a year-end closing entry. The journal that sweeps
   * revenue to retained earnings belongs to the final period BY DEFINITION,
   * and that period must already be closed before the year can close — so
   * without this the close could never post its own entry. The exemption is
   * deliberately narrow: it is set only by YearEndService, it never applies to
   * an ARCHIVED period or a closed YEAR, and it is recorded on the audit
   * record so a posting into a closed period is always visible as one.
   */
  async assertPostingAllowed(
    financialPeriodId: string,
    userRoles: string[],
    tx?: Prisma.TransactionClient,
    isClosingEntry = false,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const period = await client.financialPeriod.findUnique({
      where: { id: financialPeriodId },
      include: { financialYear: { select: { status: true, code: true } } },
    });

    if (!period) {
      throw new ClosedPeriodError(financialPeriodId, 'NOT_FOUND');
    }

    // A closed year overrides an open period beneath it.
    if (
      period.financialYear.status === PeriodStatus.CLOSED ||
      period.financialYear.status === PeriodStatus.ARCHIVED
    ) {
      throw new ClosedPeriodError(
        `${period.financialYear.code} / ${period.name}`,
        `financial year ${period.financialYear.status}`,
      );
    }

    switch (period.status) {
      case PeriodStatus.OPEN:
        return;

      case PeriodStatus.SOFT_CLOSED: {
        const permitted = userRoles.some((role) =>
          (SOFT_CLOSE_POSTING_ROLES as readonly string[]).includes(role),
        );
        if (!permitted) {
          throw new ClosedPeriodError(
            period.name,
            'SOFT_CLOSED (only Finance Manager, Finance Controller or Administrator may post)',
          );
        }
        return;
      }

      case PeriodStatus.CLOSED:
        if (isClosingEntry) return;
        throw new ClosedPeriodError(period.name, period.status);

      case PeriodStatus.ARCHIVED:
      default:
        throw new ClosedPeriodError(period.name, period.status);
    }
  }

  /** Resolve the period a given date falls into, for a company. */
  async resolveForDate(companyId: string, date: Date) {
    return this.prisma.financialPeriod.findFirst({
      where: {
        financialYear: { companyId },
        startDate: { lte: date },
        endDate: { gte: date },
      },
      include: { financialYear: true },
    });
  }
}
