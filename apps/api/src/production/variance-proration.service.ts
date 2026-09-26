import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, JournalStatus, ProductionOrderCycle, StockDirection } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { chartVersionOf, numberFor } from '../chart/chart';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

/** Who prorates a year's variance. */
const PRORATION_ROLES = ['FINANCE_CONTROLLER', 'CFO'];

/** Each line's settlement variance account (PCR-058-DR / PCR-080-DR / PCR-036-DR). */
const VARIANCE_KEY: Record<ProductionOrderCycle, string> = {
  SNAILPRO: 'PCR-058-DR',
  POULTRYPRO: 'PCR-080-DR',
  FEED_MILL: 'PCR-036-DR',
};

const RULE = 'POL-009 — Variance disposition';

interface CycleSplit {
  cycle: ProductionOrderCycle;
  varianceAccountId: string;
  varianceKobo: bigint;
  cogsBase: bigint;
  fgBase: bigint;
  wipBase: bigint;
  toCogs: bigint;
  toFg: bigint;
  toWip: bigint;
}

/**
 * POL-009 variance disposition, where the year's policy is PRORATE: the net
 * production variance settled in a year, if at or above the policy's
 * threshold, is spread over what the year's output became — cost of sales,
 * finished goods still in stock, and work in progress at the year end — in
 * proportion to their standard cost, line by line (snail, poultry, feed).
 *
 * The finished-goods and WIP shares are held in their own capitalised-variance
 * accounts beside the stock accounts, so the stock ledger still agrees with
 * its control accounts, and are reversed on the first day of the next year —
 * when that stock is sold or finished, its variance goes to cost of sales then.
 * Below the threshold, or under a COGS policy, variances stay in cost of sales.
 */
@Injectable()
export class VarianceProrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  async list(companyId: string) {
    const rows = await this.prisma.varianceProration.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
    const years = await this.prisma.financialYear.findMany({ where: { companyId, id: { in: rows.map((r) => r.financialYearId) } }, select: { id: true, code: true } });
    return rows.map((r) => ({
      id: r.id,
      financialYear: years.find((y) => y.id === r.financialYearId)?.code ?? '',
      totalVarianceKobo: r.totalVarianceKobo.toString(),
      toCogsKobo: r.toCogsKobo.toString(),
      toFgKobo: r.toFgKobo.toString(),
      toWipKobo: r.toWipKobo.toString(),
      reversed: !!r.reversedAt,
      createdAt: r.createdAt,
    }));
  }

  /** What proration would do for a year, without posting. */
  async preview(companyId: string, financialYearId: string) {
    const { year, policy, splits } = await this.compute(companyId, financialYearId);
    const total = splits.reduce((s, x) => s + x.varianceKobo, 0n);
    const threshold = policy?.prorationThresholdKobo ?? 0n;
    return {
      financialYear: year.code,
      disposition: policy?.varianceDisposition ?? 'COGS',
      thresholdKobo: threshold.toString(),
      totalVarianceKobo: total.toString(),
      applies: policy?.varianceDisposition === 'PRORATE' && (total < 0n ? -total : total) >= threshold && total !== 0n,
      lines: splits.map((s) => ({
        cycle: s.cycle,
        varianceKobo: s.varianceKobo.toString(),
        cogsBaseKobo: s.cogsBase.toString(),
        fgBaseKobo: s.fgBase.toString(),
        wipBaseKobo: s.wipBase.toString(),
        toCogsKobo: s.toCogs.toString(),
        toFgKobo: s.toFg.toString(),
        toWipKobo: s.toWip.toString(),
      })),
    };
  }

  async prorate(params: { companyId: string; financialYearId: string; actor: WorkflowActor }) {
    this.assertRole(params.actor);
    const { year, policy, splits } = await this.compute(params.companyId, params.financialYearId);
    if (policy?.varianceDisposition !== 'PRORATE') {
      throw new AccountingRuleViolation(RULE, `${year.code}'s costing policy sends variances to cost of sales; there is nothing to prorate.`, {});
    }
    const existing = await this.prisma.varianceProration.findFirst({ where: { companyId: params.companyId, financialYearId: year.id } });
    if (existing) throw new BadRequestException(`${year.code}'s variance was already prorated.`);
    const total = splits.reduce((s, x) => s + x.varianceKobo, 0n);
    const magnitude = total < 0n ? -total : total;
    if (total === 0n || magnitude < policy.prorationThresholdKobo) {
      throw new AccountingRuleViolation(
        RULE,
        `${year.code}'s net variance is ${total} kobo, below the ${policy.prorationThresholdKobo} kobo threshold; it stays in cost of sales.`,
        {},
      );
    }
    const last = year.periods[year.periods.length - 1]!;
    if (last.status !== 'OPEN') throw new AccountingRuleViolation(RULE, `${last.name} is ${last.status.toLowerCase()}; proration posts in the year's last period.`, {});

    const accounts = await this.capitalisedAccounts(params.companyId);
    const lines = splits.flatMap((s) => this.journalLines(s, accounts, 1n, year.code));
    const toFg = splits.reduce((a, s) => a + s.toFg, 0n);
    const toWip = splits.reduce((a, s) => a + s.toWip, 0n);
    const toCogs = splits.reduce((a, s) => a + s.toCogs, 0n);

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.varianceProration.create({
        data: {
          companyId: params.companyId,
          financialYearId: year.id,
          totalVarianceKobo: total,
          cogsBaseKobo: splits.reduce((a, s) => a + s.cogsBase, 0n),
          fgBaseKobo: splits.reduce((a, s) => a + s.fgBase, 0n),
          wipBaseKobo: splits.reduce((a, s) => a + s.wipBase, 0n),
          toCogsKobo: toCogs,
          toFgKobo: toFg,
          toWipKobo: toWip,
          createdById: params.actor.userId,
        },
      });
      let journalEntryId: string | null = null;
      if (lines.length) {
        const dims = await this.dimensions(params.companyId, year.id, last.id);
        const result = await this.posting.post(
          {
            sourceModule: 'production',
            sourceDocumentType: 'VarianceProration',
            sourceDocumentId: record.id,
            journalNumber: `VAR-PRORATE-${year.code}`,
            journalDate: year.endDate,
            narration: `POL-009 — ${year.code} production variance prorated to finished goods and WIP`,
            ...dims,
            idempotencyKey: `variance-proration:${record.id}`,
            actor: params.actor,
            lines: lines.map((l) => ({ ...l, dimensions: dims })),
          },
          tx,
        );
        journalEntryId = result.journalEntryId;
        await tx.varianceProration.update({ where: { id: record.id }, data: { journalEntryId } });
      }
      await this.audit.write(
        {
          transactionId: record.id,
          module: 'production',
          entityType: 'VarianceProration',
          entityId: record.id,
          status: 'POSTED',
          action: AuditAction.POST,
          userId: params.actor.userId,
          comments: `${year.code}: variance ${total} kobo — ${toCogs} to cost of sales, ${toFg} to finished goods, ${toWip} to WIP.`,
        },
        tx,
      );
      return { id: record.id, journalEntryId, totalVarianceKobo: total.toString(), toCogsKobo: toCogs.toString(), toFgKobo: toFg.toString(), toWipKobo: toWip.toString() };
    });
  }

  /** Reverse the capitalised shares on the first day of the next year's first open period. */
  async reverse(params: { companyId: string; prorationId: string; actor: WorkflowActor }) {
    this.assertRole(params.actor);
    const record = await this.prisma.varianceProration.findFirst({ where: { id: params.prorationId, companyId: params.companyId } });
    if (!record) throw new NotFoundException('No such proration.');
    if (record.reversedAt) throw new BadRequestException('Already reversed.');
    if (!record.journalEntryId) throw new BadRequestException('Nothing was capitalised, so there is nothing to reverse.');
    const year = await this.prisma.financialYear.findFirstOrThrow({ where: { id: record.financialYearId, companyId: params.companyId } });
    const next = await this.prisma.financialPeriod.findFirst({
      where: { financialYear: { companyId: params.companyId }, startDate: { gt: year.endDate }, status: 'OPEN' },
      orderBy: { startDate: 'asc' },
    });
    if (!next) throw new AccountingRuleViolation(RULE, 'The next year has no open period yet; open it, then reverse.', {});
    const original = await this.prisma.journalLine.findMany({
      where: { companyId: params.companyId, journalEntryId: record.journalEntryId },
      select: { glAccountId: true, description: true, debitKobo: true, creditKobo: true },
    });
    const dims = await this.dimensions(params.companyId, next.financialYearId, next.id);
    return this.prisma.$transaction(async (tx) => {
      const result = await this.posting.post(
        {
          sourceModule: 'production',
          sourceDocumentType: 'VarianceProration',
          sourceDocumentId: record.id,
          journalNumber: `VAR-PRORATE-${year.code}-REV`,
          journalDate: next.startDate,
          narration: `POL-009 — reversal of ${year.code} variance proration`,
          ...dims,
          idempotencyKey: `variance-proration:${record.id}:reverse`,
          actor: params.actor,
          lines: original.map((l) => ({
            glAccountId: l.glAccountId,
            description: `Reversal — ${l.description ?? ''}`,
            ...(l.debitKobo > 0n ? { credit: kobo(l.debitKobo) } : { debit: kobo(l.creditKobo) }),
            dimensions: dims,
          })),
        },
        tx,
      );
      await tx.varianceProration.update({ where: { id: record.id }, data: { reversalJournalEntryId: result.journalEntryId, reversedAt: new Date() } });
      await this.audit.write(
        {
          transactionId: record.id,
          module: 'production',
          entityType: 'VarianceProration',
          entityId: record.id,
          status: 'REVERSED',
          action: AuditAction.REVERSE,
          userId: params.actor.userId,
          comments: `Reversed in ${next.name}.`,
        },
        tx,
      );
      return { id: record.id, journalEntryId: result.journalEntryId };
    });
  }

  // -------------------------------------------------------------------------

  private assertRole(actor: WorkflowActor) {
    if (!actor.roles.some((r) => PRORATION_ROLES.includes(r))) throw new ForbiddenException('The finance controller or CFO prorates variances.');
  }

  private async compute(companyId: string, financialYearId: string) {
    const year = await this.prisma.financialYear.findFirst({
      where: { id: financialYearId, companyId },
      include: { periods: { orderBy: { periodNumber: 'asc' }, select: { id: true, name: true, status: true } } },
    });
    if (!year) throw new NotFoundException('No such financial year.');
    const policy = await this.prisma.costingPolicy.findFirst({ where: { companyId, financialYearId: year.id } });
    const periodIds = year.periods.map((p) => p.id);
    const splits: CycleSplit[] = [];
    for (const cycle of Object.keys(VARIANCE_KEY) as ProductionOrderCycle[]) {
      const key = await this.prisma.postingKey.findFirst({ where: { companyId, key: VARIANCE_KEY[cycle] }, select: { glAccountId: true } });
      if (!key?.glAccountId) continue;
      const orders = await this.prisma.productionOrder.findMany({
        where: { companyId, processingCycle: cycle },
        select: {
          id: true,
          status: true,
          createdAt: true,
          completedAt: true,
          biologicalInputValueKobo: true,
          rearingCostKobo: true,
          packagingCostKobo: true,
          standardConversionCostKobo: true,
          abnormalLossCostKobo: true,
          outputs: { select: { itemId: true } },
        },
      });
      if (orders.length === 0) continue;
      const variance = await this.prisma.journalLine.aggregate({
        where: {
          companyId,
          glAccountId: key.glAccountId,
          financialPeriodId: { in: periodIds },
          journalEntry: { status: JournalStatus.POSTED, sourceDocumentType: 'ProductionOrder', sourceDocumentId: { in: orders.map((o) => o.id) } },
        },
        _sum: { debitKobo: true, creditKobo: true },
      });
      const varianceKobo = (variance._sum.debitKobo ?? 0n) - (variance._sum.creditKobo ?? 0n);
      if (varianceKobo === 0n) continue;

      const items = [...new Set(orders.flatMap((o) => o.outputs.map((x) => x.itemId)))];
      const moves = items.length
        ? await this.prisma.stockMovement.findMany({
            where: { companyId, itemId: { in: items }, movementDate: { lte: year.endDate } },
            select: { direction: true, valueKobo: true, movementDate: true, sourceDocumentType: true },
          })
        : [];
      const cogsBase = moves
        .filter((m) => m.direction === StockDirection.OUT && m.sourceDocumentType === 'DeliveryNote' && m.movementDate >= year.startDate)
        .reduce((s, m) => s + m.valueKobo, 0n);
      const fgBase = moves.reduce((s, m) => s + (m.direction === StockDirection.IN ? m.valueKobo : -m.valueKobo), 0n);
      const wipBase = orders
        .filter((o) => o.createdAt <= year.endDate && (!o.completedAt || o.completedAt > year.endDate) && o.status !== 'CANCELLED')
        .reduce((s, o) => s + o.biologicalInputValueKobo + o.rearingCostKobo + o.packagingCostKobo + o.standardConversionCostKobo - o.abnormalLossCostKobo, 0n);
      const fg = fgBase > 0n ? fgBase : 0n;
      const wip = wipBase > 0n ? wipBase : 0n;
      const base = cogsBase + fg + wip;
      const share = (part: bigint) =>
        base > 0n ? BigInt(new Decimal(varianceKobo.toString()).mul(part.toString()).div(base.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)) : 0n;
      const toFg = share(fg);
      const toWip = share(wip);
      splits.push({ cycle, varianceAccountId: key.glAccountId, varianceKobo, cogsBase, fgBase: fg, wipBase: wip, toFg, toWip, toCogs: varianceKobo - toFg - toWip });
    }
    return { year, policy, splits };
  }

  /** Adverse: Dr capitalised FG/WIP, Cr variance. Favourable: the other way. `sign` -1 reverses. */
  private journalLines(split: CycleSplit, accounts: { fg: string; wip: string }, sign: bigint, yearCode: string) {
    const out: Array<{ glAccountId: string; description: string; debit?: ReturnType<typeof kobo>; credit?: ReturnType<typeof kobo> }> = [];
    const side = (account: string, amount: bigint, description: string) => {
      const a = amount * sign;
      if (a === 0n) return;
      out.push(a > 0n ? { glAccountId: account, description, debit: kobo(a) } : { glAccountId: account, description, credit: kobo(-a) });
    };
    side(accounts.fg, split.toFg, `${yearCode} ${split.cycle} variance held in finished goods`);
    side(accounts.wip, split.toWip, `${yearCode} ${split.cycle} variance held in WIP`);
    side(split.varianceAccountId, -(split.toFg + split.toWip), `${yearCode} ${split.cycle} variance moved to finished goods and WIP`);
    return out;
  }

  private async capitalisedAccounts(companyId: string) {
    const version = await chartVersionOf(this.prisma, companyId);
    const [fgNumber, wipNumber] = [numberFor(version, 'fgCapitalisedVariance'), numberFor(version, 'wipCapitalisedVariance')];
    const accounts = await this.prisma.gLAccount.findMany({
      where: { companyId, accountNumber: { in: [fgNumber, wipNumber] }, active: true, isPostingAccount: true },
      select: { id: true, accountNumber: true },
    });
    const fg = accounts.find((a) => a.accountNumber === fgNumber);
    const wip = accounts.find((a) => a.accountNumber === wipNumber);
    if (!fg || !wip) {
      throw new AccountingRuleViolation(
        RULE,
        `Proration holds variance in ${fgNumber} (finished goods) and ${wipNumber} (WIP); ${!fg ? fgNumber : wipNumber} is missing or inactive. Add it under Setup → Accounts.`,
        {},
      );
    }
    return { fg: fg.id, wip: wip.id };
  }

  private async dimensions(companyId: string, financialYearId: string, financialPeriodId: string) {
    const [company, centre] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { baseCurrencyId: true, branches: { where: { active: true }, take: 1, select: { id: true } } } }),
      this.prisma.costCentre.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } }),
    ]);
    return {
      companyId,
      branchId: company.branches[0]!.id,
      financialYearId,
      financialPeriodId,
      currencyId: company.baseCurrencyId,
      exchangeRate: '1.00000000',
      costCentreId: centre?.id ?? null,
    };
  }
}
