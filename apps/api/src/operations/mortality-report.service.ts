import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mortalityRate, survivalRate } from '../reporting/kpi-formulas';

/**
 * Mortality, survival and cull (REPORT_KPI_CATALOG SNL-005, PLY-004): deaths
 * and culls by batch, by cause and by the stage the animals were at when they
 * died, with the rates the KPIs page uses (kpi-formulas.ts).
 *
 * A death does not store its stage; the batch's stage-change history does.
 * The stage at a death is the stage the batch was moved to last on or before
 * that day, else the one it started at.
 */
const pct = (ratio: ReturnType<typeof mortalityRate>) => (ratio ? ratio.mul(100).toFixed(2) : null);

@Injectable()
export class MortalityReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(params: { companyId: string; speciesKey: string; from?: Date; to?: Date }) {
    const dated = params.from || params.to ? { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } : undefined;
    const groups = await this.prisma.livestockGroup.findMany({
      where: { companyId: params.companyId, speciesKey: params.speciesKey },
      select: { id: true, code: true, stage: true, status: true, openingPopulation: true, population: true },
      orderBy: { startedOn: 'desc' },
    });
    const ids = groups.map((g) => g.id);
    const [deaths, stageChanges, culls] = await Promise.all([
      this.prisma.mortalityRecord.findMany({
        where: { dailyRecord: { companyId: params.companyId, groupId: { in: ids }, ...(dated ? { recordedOn: dated } : {}) } },
        select: { quantity: true, causes: true, classification: true, dailyRecord: { select: { groupId: true, recordedOn: true } } },
      }),
      this.prisma.stageChange.findMany({
        where: { companyId: params.companyId, groupId: { in: ids } },
        select: { groupId: true, changedOn: true, fromStage: true, toStage: true },
        orderBy: { changedOn: 'asc' },
      }),
      this.prisma.livestockGroupDisposal.groupBy({
        by: ['groupId'],
        where: { groupId: { in: ids }, method: 'CULLED', group: { companyId: params.companyId }, ...(dated ? { occurredOn: dated } : {}) },
        _sum: { quantity: true },
      }),
    ]);

    const stageOn = (groupId: string, day: Date, current: string) => {
      const moves = stageChanges.filter((c) => c.groupId === groupId);
      const last = [...moves].reverse().find((c) => c.changedOn <= day);
      return last ? last.toStage : (moves[0]?.fromStage ?? current);
    };
    const tally = (into: Map<string, number>, key: string, n: number) => into.set(key, (into.get(key) ?? 0) + n);

    const deathsByGroup = new Map<string, number>();
    const abnormalByGroup = new Map<string, number>();
    const byCause = new Map<string, number>();
    const byStage = new Map<string, number>();
    const stageOf = new Map(groups.map((g) => [g.id, g.stage]));
    for (const d of deaths) {
      tally(deathsByGroup, d.dailyRecord.groupId, d.quantity);
      if (d.classification === 'ABNORMAL') tally(abnormalByGroup, d.dailyRecord.groupId, d.quantity);
      // A death recorded with two causes is one death; it is counted once, under both named together.
      tally(byCause, d.causes.length ? d.causes.join(' + ') : 'Not stated', d.quantity);
      tally(byStage, stageOn(d.dailyRecord.groupId, d.dailyRecord.recordedOn, stageOf.get(d.dailyRecord.groupId) ?? ''), d.quantity);
    }
    const cullsByGroup = new Map(culls.map((c) => [c.groupId, c._sum.quantity ?? 0]));

    const batches = groups.map((g) => {
      const died = deathsByGroup.get(g.id) ?? 0;
      const culled = cullsByGroup.get(g.id) ?? 0;
      return {
        code: g.code,
        stage: g.stage,
        status: g.status,
        placed: g.openingPopulation,
        alive: g.population,
        deaths: died,
        abnormalDeaths: abnormalByGroup.get(g.id) ?? 0,
        culls: culled,
        mortalityPercent: pct(mortalityRate(died, g.openingPopulation)),
        cullPercent: pct(mortalityRate(culled, g.openingPopulation)),
        survivalPercent: pct(survivalRate(g.population, g.openingPopulation)),
      };
    });
    const placed = batches.reduce((s, b) => s + b.placed, 0);
    const died = batches.reduce((s, b) => s + b.deaths, 0);
    const culled = batches.reduce((s, b) => s + b.culls, 0);
    const sorted = (m: Map<string, number>) => [...m.entries()].map(([key, deaths]) => ({ key, deaths })).sort((a, b) => b.deaths - a.deaths);

    return {
      totals: {
        placed,
        deaths: died,
        culls: culled,
        mortalityPercent: pct(mortalityRate(died, placed)),
        cullPercent: pct(mortalityRate(culled, placed)),
      },
      batches,
      byCause: sorted(byCause),
      byStage: sorted(byStage),
    };
  }
}
