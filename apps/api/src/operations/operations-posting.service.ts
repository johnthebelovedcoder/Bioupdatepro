import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../posting/posting.service';
import { kobo } from '../common/money';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Where the farm's work becomes accounting.
 *
 * This is the join the whole product was built to make and did not have. Feed
 * was recorded going into a batch and the batch's work-in-progress account
 * stayed empty — so every cost figure on every screen (cost per bird, batch
 * profit, the variance checks that price a discrepancy) was computed from
 * operational rows that no ledger had ever seen. Two sets of books, one of them
 * unaudited, and the accounting spine that is supposed to be the point of this
 * product was decorative.
 *
 * What posts here, and why only these:
 *
 *   FEED ISSUED    Dr Work in Progress / Cr Raw Material Inventory
 *   TREATMENT      Dr Work in Progress / Cr Raw Material Inventory
 *
 * Both have an amount nobody has to decide: the feed issue carries the value it
 * was issued at, and the treatment carries what it cost. They are the whole of
 * the input side, and feed alone is 60–70% of a poultry farm's cost.
 *
 * What deliberately does NOT post here, because the amount is a policy and not
 * a fact:
 *
 *   HARVEST    moving cost out of WIP into finished goods needs a basis for
 *              how much cost leaves with each animal — weighted average over
 *              the live population is the obvious one, but "obvious" is not
 *              the same as "the farm's accounting policy", and choosing it
 *              silently would bake a costing method into the ledger that
 *              nobody approved.
 *
 *   MORTALITY  the same problem with a sharper edge: writing dead animals out
 *              of WIP to Production Loss requires valuing them, and the
 *              valuation decides how much of a bad month lands in the P&L.
 *
 * Both are raised with the farm's accountant rather than guessed at. Until then
 * they stay as operational records, which is honest — an unposted harvest is
 * visibly missing, whereas one posted on an invented basis is wrong and looks
 * right.
 */
@Injectable()
export class OperationsPostingService {
  private readonly logger = new Logger(OperationsPostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  /**
   * Post everything a daily round put into a population.
   *
   * Called after the round has committed rather than inside it. That is a
   * deliberate trade: a posting failure must not lose the round. A worker who
   * walked four houses in the rain has done their part, and rolling their work
   * back because a period was closed would be the system punishing them for an
   * accounting configuration they have never heard of. The unposted rows stay
   * visible — `journalEntryId` is null — and can be posted later.
   */
  async postFeedIssues(params: {
    companyId: string;
    dailyRecordId: string;
    actor: WorkflowActor;
  }): Promise<{ posted: number; skipped: string[] }> {
    const issues = await this.prisma.feedIssue.findMany({
      where: { dailyRecordId: params.dailyRecordId, journalEntryId: null },
      include: {
        dailyRecord: {
          include: { group: { include: { penHouse: true } } },
        },
      },
    });

    let posted = 0;
    const skipped: string[] = [];

    for (const issue of issues) {
      if (issue.valueKobo <= 0n) {
        // Nothing to post. Not a failure — a farm can issue feed it has no
        // cost for yet, and a zero journal would be noise in the register.
        continue;
      }

      const group = issue.dailyRecord.group;
      const accounts = await this.accounts(params.companyId);
      if (!accounts) {
        skipped.push('The chart of accounts has no Work in Progress or Raw Material Inventory.');
        break;
      }

      const period = await this.periodFor(params.companyId, issue.dailyRecord.recordedOn);
      if (!period) {
        skipped.push(
          `No open accounting period covers ${issue.dailyRecord.recordedOn.toISOString().slice(0, 10)}.`,
        );
        continue;
      }

      const costCentre = await this.costCentreFor(params.companyId);
      if (!costCentre) {
        skipped.push('Work in Progress requires a cost centre and none is configured.');
        break;
      }

      const company = await this.prisma.company.findUniqueOrThrow({
        where: { id: params.companyId },
      });

      const dimensions = {
        companyId: params.companyId,
        branchId: group.branchId,
        financialYearId: period.financialYearId,
        financialPeriodId: period.id,
        currencyId: company.baseCurrencyId,
        exchangeRate: '1',
        costCentreId: costCentre.id,
        farmId: group.farmId,
        penHouseId: group.penHouseId,
      };

      try {
        const result = await this.posting.post({
          sourceModule: 'OPERATIONS',
          sourceDocumentType: 'FEED_ISSUE',
          sourceDocumentId: issue.id,
          journalNumber: `FEED-${issue.id.slice(0, 8).toUpperCase()}`,
          journalDate: issue.dailyRecord.recordedOn,
          narration: `${issue.feedName} issued to ${group.code}`,
          ...dimensions,
          lines: [
            {
              glAccountId: accounts.workInProgress,
              description: `Feed to ${group.code}`,
              debit: kobo(issue.valueKobo),
              dimensions,
            },
            {
              glAccountId: accounts.rawMaterials,
              description: `${issue.feedName} out of store`,
              credit: kobo(issue.valueKobo),
              dimensions,
            },
          ],
          // Derived from the row, so a retry of the same feed issue can never
          // post twice however many times this runs.
          idempotencyKey: `feed-issue:${issue.id}`,
          actor: params.actor,
        });

        await this.prisma.feedIssue.update({
          where: { id: issue.id },
          data: { journalEntryId: result.journalEntryId },
        });
        posted += 1;
      } catch (error) {
        // Recorded and moved past. The operational row survives with a null
        // journal, which is exactly what "posted later" looks like.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Feed issue ${issue.id} did not post: ${message}`);
        skipped.push(message);
      }
    }

    return { posted, skipped };
  }

  /** Dr Work in Progress / Cr Raw Material Inventory, for what a treatment cost. */
  async postTreatment(params: {
    companyId: string;
    treatmentId: string;
    actor: WorkflowActor;
  }): Promise<{ posted: boolean; reason?: string }> {
    const treatment = await this.prisma.treatmentRecord.findUnique({
      where: { id: params.treatmentId },
      include: { group: true },
    });
    if (!treatment || treatment.journalEntryId) return { posted: false };
    if (treatment.costKobo <= 0n) {
      // A vaccination from stock the farm has already expensed costs nothing
      // here. Silence is right; an empty journal is not.
      return { posted: false };
    }

    const accounts = await this.accounts(params.companyId);
    const period = await this.periodFor(params.companyId, treatment.givenOn);
    const costCentre = await this.costCentreFor(params.companyId);
    if (!accounts || !period || !costCentre) {
      return { posted: false, reason: 'No period, cost centre or accounts configured.' };
    }

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: params.companyId },
    });

    const dimensions = {
      companyId: params.companyId,
      branchId: treatment.group.branchId,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      currencyId: company.baseCurrencyId,
      exchangeRate: '1',
      costCentreId: costCentre.id,
      farmId: treatment.group.farmId,
      penHouseId: treatment.group.penHouseId,
    };

    try {
      const result = await this.posting.post({
        sourceModule: 'OPERATIONS',
        sourceDocumentType: 'TREATMENT',
        sourceDocumentId: treatment.id,
        journalNumber: `TREAT-${treatment.id.slice(0, 8).toUpperCase()}`,
        journalDate: treatment.givenOn,
        narration: `${treatment.name} given to ${treatment.group.code}`,
        ...dimensions,
        lines: [
          {
            glAccountId: accounts.workInProgress,
            description: `${treatment.name} — ${treatment.group.code}`,
            debit: kobo(treatment.costKobo),
            dimensions,
          },
          {
            glAccountId: accounts.rawMaterials,
            description: 'Medication out of store',
            credit: kobo(treatment.costKobo),
            dimensions,
          },
        ],
        idempotencyKey: `treatment:${treatment.id}`,
        actor: params.actor,
      });

      await this.prisma.treatmentRecord.update({
        where: { id: treatment.id },
        data: { journalEntryId: result.journalEntryId },
      });
      return { posted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Treatment ${treatment.id} did not post: ${message}`);
      return { posted: false, reason: message };
    }
  }

  /**
   * Post everything that has not been posted yet.
   *
   * Two things leave rows behind. Seeded history is written straight to the
   * database and never goes through the API, so it has values and no journals.
   * And a live posting that failed — a closed period, a missing cost centre —
   * deliberately leaves the operational row standing with a null
   * `journalEntryId` rather than losing the worker's record.
   *
   * Both cases are the same job: find the unposted rows and try again. Safe to
   * run repeatedly, because each posting's idempotency key is derived from the
   * row's own id — a second run over the same feed issue is a replay, not a
   * duplicate journal.
   */
  async postBacklog(params: {
    companyId: string;
    actor: WorkflowActor;
    /** A bound, so one call cannot spend an hour inside a request. */
    limit?: number;
  }): Promise<{
    feedIssues: { posted: number; failed: number };
    treatments: { posted: number; failed: number };
    reasons: string[];
  }> {
    const limit = Math.min(params.limit ?? 500, 2000);
    const reasons = new Set<string>();

    // Grouped by daily record, because that is what the per-record path takes.
    const pending = await this.prisma.feedIssue.findMany({
      where: {
        journalEntryId: null,
        valueKobo: { gt: 0 },
        dailyRecord: { companyId: params.companyId },
      },
      select: { dailyRecordId: true },
      take: limit,
    });

    const recordIds = [...new Set(pending.map((row) => row.dailyRecordId))];
    const feed = { posted: 0, failed: 0 };
    for (const dailyRecordId of recordIds) {
      const outcome = await this.postFeedIssues({
        companyId: params.companyId,
        dailyRecordId,
        actor: params.actor,
      });
      feed.posted += outcome.posted;
      feed.failed += outcome.skipped.length;
      for (const reason of outcome.skipped) reasons.add(reason);
    }

    const pendingTreatments = await this.prisma.treatmentRecord.findMany({
      where: { companyId: params.companyId, journalEntryId: null, costKobo: { gt: 0 } },
      select: { id: true },
      take: limit,
    });

    const treatments = { posted: 0, failed: 0 };
    for (const treatment of pendingTreatments) {
      const outcome = await this.postTreatment({
        companyId: params.companyId,
        treatmentId: treatment.id,
        actor: params.actor,
      });
      if (outcome.posted) treatments.posted += 1;
      else {
        treatments.failed += 1;
        if (outcome.reason) reasons.add(outcome.reason);
      }
    }

    return { feedIssues: feed, treatments, reasons: [...reasons] };
  }

  /* ---------------------------------------------------------------------- */

  /** The two accounts these postings need, by their workbook numbers. */
  private async accounts(companyId: string) {
    const rows = await this.prisma.gLAccount.findMany({
      where: { companyId, accountNumber: { in: ['1501', '1301'] } },
      select: { id: true, accountNumber: true },
    });
    const workInProgress = rows.find((r) => r.accountNumber === '1501')?.id;
    const rawMaterials = rows.find((r) => r.accountNumber === '1301')?.id;
    if (!workInProgress || !rawMaterials) return null;
    return { workInProgress, rawMaterials };
  }

  /**
   * The open period covering a date.
   *
   * Null rather than an exception when nothing covers it: a round recorded on a
   * date whose period is closed is still a true record of what happened, and
   * refusing it would make the accounting calendar govern whether a farm can
   * write down that its birds died.
   */
  private async periodFor(companyId: string, on: Date) {
    return this.prisma.financialPeriod.findFirst({
      where: {
        financialYear: { companyId },
        startDate: { lte: on },
        endDate: { gte: on },
        status: 'OPEN',
      },
      select: { id: true, financialYearId: true },
    });
  }

  /** Work in Progress cannot be posted without one (§10.5). */
  private async costCentreFor(companyId: string) {
    return this.prisma.costCentre.findFirst({
      where: { companyId, active: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
  }
}

/** Re-exported for the callers that only need the type. */
export type { Prisma };
