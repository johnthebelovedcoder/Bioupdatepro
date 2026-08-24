import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reading the livestock back.
 *
 * Separate from OperationsService, which writes. The two have almost nothing in
 * common: writing is about transactions and invariants, reading is about
 * shaping history into what a screen needs, and mixing them produces a class
 * that is half a repository and half a domain service.
 *
 * The shapes below deliberately match what the web app's fixtures already
 * returned. That is not laziness — the fixtures were written against real
 * screens, so matching them means the components do not change at all, and the
 * change under test is "where does this come from" rather than "what does this
 * look like". One variable at a time.
 *
 * Every method is scoped by company. There is no overload that omits it.
 */
@Injectable()
export class OperationsReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** The register: every population of a species, newest placement first. */
  async groups(companyId: string, speciesKey: string) {
    const groups = await this.prisma.livestockGroup.findMany({
      where: { companyId, speciesKey },
      orderBy: [{ status: 'asc' }, { startedOn: 'desc' }],
      include: {
        penHouse: { select: { name: true } },
        dailyRecords: { select: { feedIssues: { select: { valueKobo: true } } } },
        treatments: { select: { costKobo: true } },
      },
    });

    return groups.map((group) => this.toSummary(group));
  }

  async groupDetail(companyId: string, code: string) {
    const group = await this.prisma.livestockGroup.findFirst({
      where: { companyId, code },
      include: {
        penHouse: { select: { name: true } },
        dailyRecords: {
          orderBy: { recordedOn: 'asc' },
          include: {
            feedIssues: true,
            mortality: true,
            production: true,
            recordedBy: { select: { fullName: true } },
          },
        },
        treatments: {
          orderBy: { givenOn: 'desc' },
          include: { recordedBy: { select: { fullName: true } } },
        },
        harvests: {
          orderBy: { harvestedOn: 'desc' },
          include: { recordedBy: { select: { fullName: true } } },
        },
        stageChanges: {
          orderBy: { changedOn: 'desc' },
          include: { recordedBy: { select: { fullName: true } } },
        },
      },
    });
    if (!group) return null;

    const summary = this.toSummary({
      ...group,
      dailyRecords: group.dailyRecords.map((d) => ({ feedIssues: d.feedIssues })),
      treatments: group.treatments.map((t) => ({ costKobo: t.costKobo })),
    });

    /*
     * The population on each of the last fourteen days, worked BACKWARDS from
     * today's figure and the deaths since. Running it forwards from the opening
     * count would drift from the register the moment anything was recorded that
     * this window does not cover.
     */
    const recent = group.dailyRecords.slice(-14);
    const deathsByDate = new Map<string, number>();
    for (const record of recent) {
      const key = iso(record.recordedOn);
      const died = record.mortality.reduce((sum, m) => sum + m.quantity, 0);
      deathsByDate.set(key, (deathsByDate.get(key) ?? 0) + died);
    }

    const dates = [...deathsByDate.keys()].sort();
    const populationSeries: Array<{ date: string; value: number }> = [];
    let running = group.population;
    for (let index = dates.length - 1; index >= 0; index -= 1) {
      const date = dates[index]!;
      populationSeries.unshift({ date, value: running });
      running += deathsByDate.get(date) ?? 0;
    }

    const mortalitySeries = dates.map((date) => ({
      date,
      value: deathsByDate.get(date) ?? 0,
    }));

    const feedKobo = group.dailyRecords
      .flatMap((d) => d.feedIssues)
      .reduce((sum, f) => sum + f.valueKobo, 0n);
    const treatmentKobo = group.treatments.reduce((sum, t) => sum + t.costKobo, 0n);

    return {
      ...summary,
      populationSeries,
      mortalitySeries,
      // Only what is actually known. An invented "labour" or "overhead" line
      // would be a number nobody recorded, and the total would then disagree
      // with the ledger it claims to reconcile to.
      costBreakdown: [
        { label: 'Stock at placement', kobo: group.acquisitionCostKobo.toString() },
        { label: 'Feed', kobo: feedKobo.toString() },
        { label: 'Health and treatment', kobo: treatmentKobo.toString() },
      ],
      expectedEndOn: null,
      events: this.eventsFor(group),
    };
  }

  async production(companyId: string, speciesKey: string, days: number) {
    const records = await this.prisma.dailyRecord.findMany({
      where: {
        companyId,
        group: { speciesKey },
        recordedOn: { gte: since(days) },
        production: { some: {} },
      },
      orderBy: { recordedOn: 'desc' },
      include: {
        production: true,
        group: { select: { code: true, population: true, penHouse: { select: { name: true } } } },
      },
    });

    return records.map((record) => {
      const values: Record<string, number> = {};
      for (const line of record.production) values[line.fieldKey] = Number(line.quantity);

      // Hen-day: eggs laid against the birds that were alive to lay them.
      const laid = Object.values(values).reduce((sum, value) => sum + value, 0);
      const rate =
        record.group.population > 0
          ? Number(((laid / record.group.population) * 100).toFixed(1))
          : null;

      return {
        date: iso(record.recordedOn),
        groupCode: record.group.code,
        house: record.group.penHouse.name,
        values,
        rate,
        /*
         * The denominator, carried with the row.
         *
         * Its absence took the dashboard down: the variance check multiplies by
         * it, `days * undefined` is NaN, and `NaN <= tolerance` is false — so a
         * missing field walked straight past the guard meant to stop it and
         * reached BigInt(NaN), which throws. The type said this field was
         * required and nothing checked that the response actually had it.
         */
        population: record.group.population,
      };
    });
  }

  async feeding(companyId: string, speciesKey: string, days: number) {
    const issues = await this.prisma.feedIssue.findMany({
      where: {
        dailyRecord: {
          companyId,
          group: { speciesKey },
          recordedOn: { gte: since(days) },
        },
      },
      orderBy: { dailyRecord: { recordedOn: 'desc' } },
      include: {
        dailyRecord: {
          include: {
            group: { select: { code: true, population: true, penHouse: { select: { name: true } } } },
          },
        },
      },
    });

    return issues.map((issue) => {
      const kg = Number(issue.quantityKg);
      const population = issue.dailyRecord.group.population;
      return {
        date: iso(issue.dailyRecord.recordedOn),
        groupCode: issue.dailyRecord.group.code,
        house: issue.dailyRecord.group.penHouse.name,
        feedType: issue.feedName,
        kg,
        gramsPerHead: population > 0 ? Number(((kg * 1000) / population).toFixed(1)) : 0,
        costKobo: issue.valueKobo.toString(),
      };
    });
  }

  async health(companyId: string, speciesKey: string) {
    const events = await this.prisma.healthEvent.findMany({
      where: { companyId, group: { speciesKey } },
      orderBy: { dueOn: 'asc' },
      include: {
        group: { select: { code: true, penHouse: { select: { name: true } } } },
        treatments: { orderBy: { givenOn: 'desc' }, take: 1 },
      },
    });

    return events.map((event) => {
      const given = event.treatments[0];
      return {
        id: event.id,
        groupCode: event.group.code,
        house: event.group.penHouse.name,
        kind: event.kind,
        name: event.name,
        detail: event.detail ?? '',
        dueOn: iso(event.dueOn),
        administeredOn: given ? iso(given.givenOn) : null,
        administeredBy: given?.givenBy ?? null,
        status: event.status,
      };
    });
  }

  async harvests(companyId: string, speciesKey: string) {
    const rows = await this.prisma.harvestRecord.findMany({
      where: { companyId, group: { speciesKey } },
      orderBy: { harvestedOn: 'desc' },
      include: { group: { select: { code: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      date: iso(row.harvestedOn),
      colonyCode: row.group.code,
      kg: Number(row.weightKg),
      count: row.count,
      grade: row.grade,
      destination: row.destination,
      // No value: a harvest has no price. Revenue happens at the sale, and
      // putting a number here would recognise profit at the moment of picking.
      valueKobo: '0',
    }));
  }

  async stageBreakdown(companyId: string, speciesKey: string, stages: string[]) {
    const groups = await this.prisma.livestockGroup.findMany({
      where: { companyId, speciesKey, status: 'ACTIVE' },
      select: { code: true, stage: true, population: true },
    });

    const order = stages.length > 0 ? stages : [...new Set(groups.map((g) => g.stage))];
    const buckets = order.map((stage) => {
      const inStage = groups.filter((group) => group.stage === stage);
      return {
        stage,
        population: inStage.reduce((sum, group) => sum + group.population, 0),
        groups: inStage.map((group) => group.code),
      };
    });

    // A group whose `stage` isn't any of the caller's declared stages should
    // never just disappear from the total — that reads as missing population,
    // not as a data problem. Placement now always writes a real stage (see
    // `placeGroup`), so this bucket should stay empty going forward; it exists
    // for whatever the fix doesn't reach — older rows, a bad import.
    const known = new Set(order);
    const unclassified = groups.filter((group) => !known.has(group.stage));
    if (unclassified.length > 0) {
      buckets.push({
        stage: 'Not yet staged',
        population: unclassified.reduce((sum, group) => sum + group.population, 0),
        groups: unclassified.map((group) => group.code),
      });
    }

    return buckets.filter((bucket) => bucket.groups.length > 0);
  }

  /* ------------------------------------------------------------------ */

  private toSummary(group: {
    id: string;
    code: string;
    speciesKey: string;
    breed: string;
    purpose: string;
    stage: string;
    population: number;
    openingPopulation: number;
    startedOn: Date;
    status: string;
    source: string | null;
    acquisitionCostKobo: bigint;
    penHouse: { name: string };
    dailyRecords: Array<{ feedIssues: Array<{ valueKobo: bigint }> }>;
    treatments: Array<{ costKobo: bigint }>;
  }) {
    const lost = group.openingPopulation - group.population;
    const feedKobo = group.dailyRecords
      .flatMap((d) => d.feedIssues)
      .reduce((sum, f) => sum + f.valueKobo, 0n);
    const treatmentKobo = group.treatments.reduce((sum, t) => sum + t.costKobo, 0n);

    return {
      id: group.code,
      code: group.code,
      species: group.speciesKey === 'snail' ? ('SNAIL' as const) : ('POULTRY' as const),
      breed: group.breed,
      purpose: group.purpose,
      house: group.penHouse.name,
      stage: group.stage,
      population: group.population,
      openingPopulation: group.openingPopulation,
      ageDays: daysSince(group.startedOn),
      mortalityRate:
        group.openingPopulation > 0
          ? Number(((lost / group.openingPopulation) * 100).toFixed(2))
          : 0,
      status: group.status as 'ACTIVE' | 'CLOSED',
      startedOn: iso(group.startedOn),
      source: group.source ?? '',
      costToDateKobo: (group.acquisitionCostKobo + feedKobo + treatmentKobo).toString(),
      // Nothing links a sale to a population yet, so this is honestly zero
      // rather than a plausible-looking figure.
      revenueToDateKobo: '0',
    };
  }

  /** The population's history, most recent first. */
  private eventsFor(group: {
    startedOn: Date;
    openingPopulation: number;
    source: string | null;
    dailyRecords: Array<{
      id: string;
      recordedOn: Date;
      recordedBy: { fullName: string };
      feedIssues: Array<{ id: string; feedName: string; quantityKg: unknown }>;
      mortality: Array<{ id: string; quantity: number; causes: string[] }>;
      production: Array<{ id: string; fieldKey: string; quantity: unknown }>;
    }>;
    treatments: Array<{
      id: string;
      givenOn: Date;
      name: string;
      route: string;
      treatedCount: number;
      recordedBy: { fullName: string };
    }>;
    harvests: Array<{
      id: string;
      harvestedOn: Date;
      grade: string;
      count: number;
      weightKg: unknown;
      recordedBy: { fullName: string };
    }>;
    stageChanges: Array<{
      id: string;
      changedOn: Date;
      fromStage: string;
      toStage: string;
      recordedBy: { fullName: string };
    }>;
  }) {
    type Event = {
      id: string;
      occurredOn: string;
      type: 'PLACEMENT' | 'FEED' | 'MORTALITY' | 'PRODUCTION' | 'TREATMENT' | 'STAGE' | 'HARVEST';
      summary: string;
      detail: string;
      quantity: string | null;
      recordedBy: string;
    };
    const events: Event[] = [];

    for (const record of group.dailyRecords.slice(-14)) {
      for (const death of record.mortality) {
        events.push({
          id: death.id,
          occurredOn: iso(record.recordedOn),
          type: 'MORTALITY',
          summary: `${death.quantity} lost`,
          detail: death.causes.join(', ') || 'No cause recorded',
          quantity: String(death.quantity),
          recordedBy: record.recordedBy.fullName,
        });
      }
      for (const issue of record.feedIssues) {
        events.push({
          id: issue.id,
          occurredOn: iso(record.recordedOn),
          type: 'FEED',
          summary: `${issue.feedName} issued`,
          detail: `${Number(issue.quantityKg)} kg`,
          quantity: `${Number(issue.quantityKg)} kg`,
          recordedBy: record.recordedBy.fullName,
        });
      }
    }

    for (const treatment of group.treatments) {
      events.push({
        id: treatment.id,
        occurredOn: iso(treatment.givenOn),
        type: 'TREATMENT',
        summary: treatment.name,
        detail: `${treatment.route} · ${treatment.treatedCount.toLocaleString('en-NG')} treated`,
        quantity: null,
        recordedBy: treatment.recordedBy.fullName,
      });
    }

    for (const harvest of group.harvests) {
      events.push({
        id: harvest.id,
        occurredOn: iso(harvest.harvestedOn),
        type: 'HARVEST',
        summary: `${Number(harvest.weightKg)} kg harvested`,
        detail: `${harvest.grade} · ${harvest.count.toLocaleString('en-NG')}`,
        quantity: `${Number(harvest.weightKg)} kg`,
        recordedBy: harvest.recordedBy.fullName,
      });
    }

    for (const change of group.stageChanges) {
      events.push({
        id: change.id,
        occurredOn: iso(change.changedOn),
        type: 'STAGE',
        summary: `Moved to ${change.toStage}`,
        detail: `From ${change.fromStage}`,
        quantity: null,
        recordedBy: change.recordedBy.fullName,
      });
    }

    events.push({
      id: 'placement',
      occurredOn: iso(group.startedOn),
      type: 'PLACEMENT',
      summary: `${group.openingPopulation.toLocaleString('en-NG')} placed`,
      detail: group.source ?? 'Source not recorded',
      quantity: String(group.openingPopulation),
      recordedBy: 'System',
    });

    return events.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)).slice(0, 40);
  }
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function since(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

function daysSince(date: Date): number {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - date.getTime()) / 86_400_000));
}
