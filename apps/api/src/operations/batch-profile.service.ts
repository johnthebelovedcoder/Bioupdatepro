import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { clearsOn } from './withdrawal';
import { WorkflowActor } from '../workflow/workflow.types';

export const DISPOSAL_METHODS = ['SOLD', 'SLAUGHTERED', 'CULLED', 'GIFTED', 'DESTROYED'] as const;
export const CARCASS_DISPOSALS = ['BURIED', 'BURNT', 'RENDERED', 'COLLECTED', 'OTHER'] as const;

/** Who may approve a weighing (POULTRY_WEIGHT_HISTORY "Approved By": farm manager / vet). */
export const WEIGHING_APPROVERS = ['FARM_MANAGER', 'POULTRY_SUPERVISOR', 'SNAIL_SUPERVISOR', 'PRODUCTION_SUPERVISOR', 'PRODUCTION_LEAD', 'CFO', 'ADMINISTRATOR'];

const DAY = 24 * 60 * 60 * 1000;
/** SNAIL_AGE_TRACKER / POULTRY_AGE_TRACKER: Age Months = Age Days / 30.4375. */
const DAYS_PER_MONTH = 30.4375;

export type AgeBasis = 'EXACT' | 'ESTIMATED' | 'PLACEMENT';

export interface WeighingRow {
  id: string;
  weighedOn: string;
  stage: string;
  ageDays: number;
  sampleSize: number;
  totalSampleWeightGrams: number;
  averageWeightGrams: number;
  unit: string;
  targetWeightGrams: number | null;
  varianceGrams: number | null;
  variancePercent: string | null;
  status: string;
  isCurrent: boolean;
  recordedBy: string;
  approvedBy: string | null;
  rejectionReason: string | null;
}

export interface BatchProfile {
  groupId: string;
  code: string;
  speciesKey: string;
  breed: string;
  placedOn: string;
  hatchedOn: string | null;
  ageBasis: AgeBasis;
  /** Days old today, or on the day the batch closed — a closed batch stops ageing. */
  ageDays: number;
  ageWeeks: string;
  ageMonths: string;
  configuredStage: string;
  /** The stage the breed's thresholds give for this age; null when none are set up. */
  suggestedStage: string | null;
  /** REVIEW when the configured stage and the age disagree (SNAIL/POULTRY_AGE_TRACKER). */
  stageStatus: 'OK' | 'REVIEW' | 'NO_THRESHOLDS';
  openingPopulation: number;
  population: number;
  current: WeighingRow | null;
  pending: WeighingRow[];
  /** Live count × the current approved average, in kilograms to three places. */
  biomassKg: string | null;
  /** Grams per animal per day, first to current approved weighing. */
  averageDailyGainGrams: string | null;
  weighings: WeighingRow[];
  disposals: Array<{ occurredOn: string; quantity: number; method: string | null }>;
  deaths: { total: number; byCarcassDisposal: Record<string, number> };
  /**
   * KPI-11 FCR = feed kg ÷ live-weight gain kg, between the first and the
   * current approved weighing. Null until two approved weighings exist.
   */
  fcr: { value: string; feedKg: string; gainKg: string; from: string; to: string } | null;
  /**
   * KPI-13 hen-day % = eggs ÷ hens alive, over the last seven days recorded,
   * each day's hens rebuilt from the deaths and sales after it. Null when no
   * eggs were recorded.
   */
  henDay: { percent: string; eggs: number; henDays: number; days: number } | null;
  /**
   * European Production Efficiency Factor (handbook §24, Farm Manager KPI):
   * liveability % × live weight kg ÷ (age days × FCR) × 100, with the FCR
   * here from placement — all feed issued ÷ the flock's live weight now.
   * Poultry only; null until there is an approved weighing and feed issued.
   */
  epef: { value: string; liveabilityPercent: string; liveWeightKg: string; ageDays: number; fcrFromPlacement: string } | null;
}

export type ReadinessCheck = { status: 'PASS' | 'FAIL' | 'NO_DATA'; detail: string };

export interface HarvestReadiness {
  groupId: string;
  code: string;
  speciesKey: string;
  breed: string;
  farm: string;
  pen: string;
  stage: string;
  population: number;
  ageDays: number;
  /** READY only when every check passes; a check with no data is not a pass. */
  ready: boolean;
  /** The day the last withdrawal period ends; null when none is running. */
  safeToSellFrom: string | null;
  checks: { age: ReadinessCheck; weight: ReadinessCheck; stage: ReadinessCheck; health: ReadinessCheck; withdrawal: ReadinessCheck };
}

/**
 * The biological master data of one batch (SNAIL_COHORT_MASTER /
 * POULTRY_FLOCK_MASTER): its age on the right basis, the stage that age
 * suggests, its approved weight history and live weight, and how animals left.
 */
@Injectable()
export class BatchProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async profile(companyId: string, code: string, today = new Date()): Promise<BatchProfile> {
    const group = await this.prisma.livestockGroup.findFirst({
      where: { code, companyId },
      include: {
        weighings: {
          orderBy: [{ weighedOn: 'asc' }, { createdAt: 'asc' }],
          include: { recordedBy: { select: { fullName: true } }, approvedBy: { select: { fullName: true } } },
        },
        disposals: { orderBy: { occurredOn: 'asc' } },
      },
    });
    if (!group) throw new NotFoundException('No such group.');

    const mortality = await this.prisma.mortalityRecord.findMany({
      where: { dailyRecord: { groupId: group.id, companyId } },
      select: { quantity: true, carcassDisposal: true },
    });
    const byCarcassDisposal: Record<string, number> = {};
    for (const m of mortality) {
      const key = m.carcassDisposal ?? 'NOT_RECORDED';
      byCarcassDisposal[key] = (byCarcassDisposal[key] ?? 0) + m.quantity;
    }

    const age = ageOf(group, group.closedOn ?? today);
    const thresholds = await this.thresholds(companyId, group.speciesKey, group.breed);
    const suggestedStage = suggestStage(thresholds, age.days);
    const stageStatus = thresholds.length === 0 ? 'NO_THRESHOLDS' : suggestedStage === group.stage ? 'OK' : 'REVIEW';

    const rows = group.weighings.map(toRow);
    const approved = rows.filter((w) => w.status === 'APPROVED');
    const current = rows.find((w) => w.isCurrent) ?? null;
    const first = approved[0];
    const gainDays = first && current ? (Date.parse(current.weighedOn) - Date.parse(first.weighedOn)) / DAY : 0;
    const biomassGrams = current ? BigInt(group.population) * BigInt(current.averageWeightGrams) : null;

    return {
      groupId: group.id,
      code: group.code,
      speciesKey: group.speciesKey,
      breed: group.breed,
      placedOn: day(group.startedOn),
      hatchedOn: group.hatchedOn ? day(group.hatchedOn) : null,
      ageBasis: age.basis,
      ageDays: age.days,
      ageWeeks: (age.days / 7).toFixed(1),
      ageMonths: (age.days / DAYS_PER_MONTH).toFixed(1),
      configuredStage: group.stage,
      suggestedStage,
      stageStatus,
      openingPopulation: group.openingPopulation,
      population: group.population,
      current,
      pending: rows.filter((w) => w.status === 'PENDING'),
      biomassKg: biomassGrams === null ? null : kilograms(biomassGrams),
      averageDailyGainGrams:
        first && current && gainDays > 0 ? ((current.averageWeightGrams - first.averageWeightGrams) / gainDays).toFixed(1) : null,
      weighings: rows,
      disposals: group.disposals.map((d) => ({ occurredOn: day(d.occurredOn), quantity: d.quantity, method: d.method })),
      deaths: { total: mortality.reduce((s, m) => s + m.quantity, 0), byCarcassDisposal },
      fcr: await this.fcr(group.id, group.population, first, current),
      henDay: await this.henDay(companyId, group.id, group.population),
      epef:
        group.speciesKey === 'snail'
          ? null
          : await this.epef(group.id, group.openingPopulation, group.population, mortality.reduce((s, m) => s + m.quantity, 0), age.days, current),
    };
  }

  /**
   * Harvest/QA readiness (handbook §59.4, §59.5): for every active batch, as of
   * a day, whether it passes age, weight, stage, health and withdrawal together.
   * "Age alone cannot release stock" — each is shown separately, and the batch
   * is ready only when all pass. Age: the batch has reached its breed's last
   * stage. Weight: the current approved weighing meets that stage's target.
   * Health: no programme event past due. Withdrawal: no treatment's withdrawal
   * period still running (safeToSellFrom after the day).
   */
  async readiness(companyId: string, on = new Date(), farmId?: string): Promise<HarvestReadiness[]> {
    const groups = await this.prisma.livestockGroup.findMany({
      where: { companyId, status: 'ACTIVE', population: { gt: 0 }, ...(farmId ? { farmId } : {}) },
      orderBy: { code: 'asc' },
      include: {
        farm: { select: { name: true } },
        penHouse: { select: { name: true } },
        weighings: { where: { isCurrent: true }, take: 1 },
        healthEvents: { where: { status: { in: ['DUE', 'OVERDUE'] }, dueOn: { lt: on } }, select: { name: true, dueOn: true } },
        treatments: { where: { OR: [{ withdrawalDays: { gt: 0 } }, { safeToSellFrom: { not: null } }] }, select: { name: true, givenOn: true, withdrawalDays: true, safeToSellFrom: true } },
      },
    });
    const masters = new Map<string, Array<{ stageName: string; minDay: number; targetWeightGrams: number | null }>>();
    const out: HarvestReadiness[] = [];
    for (const group of groups) {
      const key = `${group.speciesKey}|${group.breed}`;
      if (!masters.has(key)) masters.set(key, await this.thresholds(companyId, group.speciesKey, group.breed));
      const stages = masters.get(key)!;
      const final = stages.length ? stages[stages.length - 1] : null;
      const age = ageOf(group, on);
      const current = group.weighings[0] ?? null;

      const ageCheck: ReadinessCheck = !final
        ? { status: 'NO_DATA', detail: 'No age thresholds set up for this breed.' }
        : age.days >= final.minDay
          ? { status: 'PASS', detail: `${age.days} days; ${final.stageName} from ${final.minDay}.` }
          : { status: 'FAIL', detail: `${age.days} days; ${final.stageName} from ${final.minDay} (${final.minDay - age.days} to go).` };

      const weightCheck: ReadinessCheck = !current
        ? { status: 'NO_DATA', detail: 'No approved weighing.' }
        : !final?.targetWeightGrams
          ? { status: 'NO_DATA', detail: `Weighs ${current.averageWeightGrams} g; no target weight set for the last stage.` }
          : current.averageWeightGrams >= final.targetWeightGrams
            ? { status: 'PASS', detail: `${current.averageWeightGrams} g against ${final.targetWeightGrams} g target.` }
            : { status: 'FAIL', detail: `${current.averageWeightGrams} g against ${final.targetWeightGrams} g target.` };

      const suggested = suggestStage(stages, age.days);
      const stageCheck: ReadinessCheck = !stages.length
        ? { status: 'NO_DATA', detail: 'No age thresholds set up for this breed.' }
        : suggested === group.stage
          ? { status: 'PASS', detail: `${group.stage}, as its age suggests.` }
          : { status: 'FAIL', detail: `Recorded as ${group.stage}; its age suggests ${suggested ?? 'an earlier stage'} (REVIEW).` };

      const healthCheck: ReadinessCheck = group.healthEvents.length
        ? { status: 'FAIL', detail: `Overdue: ${group.healthEvents.map((h) => `${h.name} (due ${day(h.dueOn)})`).join(', ')}.` }
        : { status: 'PASS', detail: 'No programme event overdue.' };

      const withdrawal = group.treatments
        .map((t) => ({ name: t.name, until: clearsOn(t) }))
        .filter((t): t is { name: string; until: Date } => !!t.until && t.until > on)
        .sort((a, b) => b.until.getTime() - a.until.getTime())[0] ?? null;
      const withdrawalCheck: ReadinessCheck = withdrawal
        ? { status: 'FAIL', detail: `${withdrawal.name}: withdrawal until ${day(withdrawal.until)}.` }
        : { status: 'PASS', detail: 'No withdrawal period running.' };

      const checks = { age: ageCheck, weight: weightCheck, stage: stageCheck, health: healthCheck, withdrawal: withdrawalCheck };
      out.push({
        groupId: group.id,
        code: group.code,
        speciesKey: group.speciesKey,
        breed: group.breed,
        farm: group.farm.name,
        pen: group.penHouse.name,
        stage: group.stage,
        population: group.population,
        ageDays: age.days,
        ready: Object.values(checks).every((c) => c.status === 'PASS'),
        safeToSellFrom: withdrawal ? day(withdrawal.until) : null,
        checks,
      });
    }
    return out;
  }

  private async epef(groupId: string, placed: number, alive: number, deaths: number, ageDays: number, current: WeighingRow | null) {
    if (!current || placed <= 0 || alive <= 0 || ageDays <= 0) return null;
    const feed = await this.prisma.feedIssue.aggregate({ where: { dailyRecord: { groupId } }, _sum: { quantityKg: true } });
    const feedKg = Number(feed._sum.quantityKg ?? 0);
    const liveWeightKg = current.averageWeightGrams / 1000;
    const flockWeightKg = liveWeightKg * alive;
    if (feedKg <= 0 || flockWeightKg <= 0) return null;
    const fcr = feedKg / flockWeightKg;
    const liveability = ((placed - deaths) / placed) * 100;
    return {
      value: ((liveability * liveWeightKg) / (ageDays * fcr) * 100).toFixed(0),
      liveabilityPercent: liveability.toFixed(1),
      liveWeightKg: liveWeightKg.toFixed(3),
      ageDays,
      fcrFromPlacement: fcr.toFixed(2),
    };
  }

  private async fcr(groupId: string, population: number, first: WeighingRow | undefined, current: WeighingRow | null) {
    if (!first || !current || first.id === current.id) return null;
    const feed = await this.prisma.feedIssue.aggregate({
      where: { dailyRecord: { groupId, recordedOn: { gte: new Date(first.weighedOn), lt: new Date(current.weighedOn) } } },
      _sum: { quantityKg: true },
    });
    const feedKg = Number(feed._sum.quantityKg ?? 0);
    const gainKg = ((current.averageWeightGrams - first.averageWeightGrams) * population) / 1000;
    if (feedKg <= 0 || gainKg <= 0) return null;
    return { value: (feedKg / gainKg).toFixed(2), feedKg: feedKg.toFixed(1), gainKg: gainKg.toFixed(1), from: first.weighedOn, to: current.weighedOn };
  }

  private async henDay(companyId: string, groupId: string, population: number) {
    const rounds = await this.prisma.dailyRecord.findMany({
      where: { companyId, groupId, production: { some: {} } },
      orderBy: { recordedOn: 'desc' },
      take: 7,
      include: { production: true },
    });
    // Eggs are the whole, cracked and dirty counts (a collection may be split by time: "whole:morning").
    const eggsOf = (lines: Array<{ fieldKey: string; quantity: unknown }>) =>
      lines.filter((l) => ['whole', 'cracked', 'dirty'].includes(l.fieldKey.split(':')[0]!)).reduce((n, l) => n + Number(l.quantity), 0);
    const eggs = rounds.reduce((n, r) => n + eggsOf(r.production), 0);
    if (rounds.length === 0 || eggs === 0) return null;

    // Hens alive on a day = today's count plus every bird that has left since.
    const oldest = rounds[rounds.length - 1]!.recordedOn;
    const [deaths, disposals] = await Promise.all([
      this.prisma.mortalityRecord.findMany({
        where: { dailyRecord: { groupId, recordedOn: { gte: oldest } } },
        select: { quantity: true, dailyRecord: { select: { recordedOn: true } } },
      }),
      this.prisma.livestockGroupDisposal.findMany({ where: { groupId, occurredOn: { gte: oldest } }, select: { quantity: true, occurredOn: true } }),
    ]);
    const leftAfter = (d: Date) =>
      deaths.filter((m) => m.dailyRecord.recordedOn > d).reduce((n, m) => n + m.quantity, 0) +
      disposals.filter((x) => x.occurredOn > d).reduce((n, x) => n + x.quantity, 0);
    const henDays = rounds.reduce((n, r) => n + population + leftAfter(r.recordedOn), 0);
    if (henDays === 0) return null;
    return { percent: ((eggs / henDays) * 100).toFixed(1), eggs, henDays, days: rounds.length };
  }

  /**
   * Record a sample weighing, PENDING approval. The average is worked out
   * from what the scale said — the sample's total weight over its count — and
   * the stage, age and breed target are fixed on the row as they stood.
   * Called by the daily round too, inside its transaction.
   */
  async recordWeighing(params: {
    companyId: string;
    code: string;
    weighedOn: Date;
    sampleSize: number;
    totalSampleWeight: number;
    unit: 'g' | 'kg';
    notes?: string | null;
    dailyRecordId?: string | null;
    actor: WorkflowActor;
    today?: Date;
    tx?: Prisma.TransactionClient;
  }) {
    const client = params.tx ?? this.prisma;
    const group = await client.livestockGroup.findFirst({ where: { code: params.code, companyId: params.companyId } });
    if (!group) throw new NotFoundException('No such group.');

    if (!Number.isInteger(params.sampleSize) || params.sampleSize < 1) {
      throw new BadRequestException('Weigh at least one animal.');
    }
    if (params.sampleSize > group.population) {
      throw new BadRequestException(
        `You weighed ${params.sampleSize}, but ${group.code} has ${group.population} animals. Weigh ${group.population} or fewer.`,
      );
    }
    if (params.unit !== 'g' && params.unit !== 'kg') throw new BadRequestException('Weigh in g or kg.');
    const totalGrams = Math.round(params.unit === 'kg' ? params.totalSampleWeight * 1000 : params.totalSampleWeight);
    if (!Number.isFinite(totalGrams) || totalGrams < 1) {
      throw new BadRequestException('Give what the whole sample weighed.');
    }
    const averageGrams = Math.round(totalGrams / params.sampleSize);
    if (averageGrams < 1) throw new BadRequestException('That sample weighs less than a gram an animal. Check the unit.');
    if (params.weighedOn.getTime() > (params.today ?? new Date()).getTime()) {
      throw new BadRequestException('A weighing cannot be dated in the future.');
    }
    if (params.weighedOn < group.startedOn) {
      throw new BadRequestException(`${group.code} was placed on ${day(group.startedOn)}; it cannot have been weighed before.`);
    }
    if (group.closedOn && params.weighedOn > group.closedOn) {
      throw new BadRequestException(`${group.code} closed on ${day(group.closedOn)}.`);
    }

    const thresholds = await this.thresholds(params.companyId, group.speciesKey, group.breed, client);
    const target = thresholds.find((t) => t.stageName === group.stage)?.targetWeightGrams ?? null;
    const weighing = await client.livestockWeighing.create({
      data: {
        companyId: params.companyId,
        groupId: group.id,
        weighedOn: params.weighedOn,
        stage: group.stage,
        ageDays: ageOf(group, params.weighedOn).days,
        sampleSize: params.sampleSize,
        totalSampleWeightGrams: totalGrams,
        averageWeightGrams: averageGrams,
        targetWeightGrams: target,
        unit: params.unit,
        notes: params.notes?.trim() || null,
        recordedById: params.actor.userId,
        dailyRecordId: params.dailyRecordId ?? null,
      },
    });
    await this.audit.write(
      {
        transactionId: weighing.id,
        module: 'operations',
        entityType: 'LivestockWeighing',
        entityId: weighing.id,
        status: 'PENDING',
        action: AuditAction.CREATE,
        userId: params.actor.userId,
        comments: `${group.code} weighed ${day(params.weighedOn)}: ${params.sampleSize} animals, ${totalGrams} g in all, average ${averageGrams} g.`,
      },
      params.tx,
    );
    return weighing;
  }

  /**
   * Approve a weighing. The latest approved weighing is the batch's current
   * one; approving an older one keeps it in the history without displacing a
   * newer current reading.
   */
  async approveWeighing(params: { companyId: string; weighingId: string; actor: WorkflowActor }) {
    this.assertApprover(params.actor);
    return this.prisma.$transaction(async (tx) => {
      const weighing = await this.pendingWeighing(tx, params.companyId, params.weighingId);
      if (weighing.recordedById === params.actor.userId) {
        const company = await tx.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
        if (!company.allowSelfApproval) {
          throw new ForbiddenException('You recorded this weighing, so someone else must approve it.');
        }
      }
      const current = await tx.livestockWeighing.findFirst({ where: { companyId: params.companyId, groupId: weighing.groupId, isCurrent: true } });
      const becomesCurrent = !current || weighing.weighedOn >= current.weighedOn;
      if (becomesCurrent && current) {
        await tx.livestockWeighing.update({ where: { id: current.id }, data: { isCurrent: false } });
      }
      const approved = await tx.livestockWeighing.update({
        where: { id: weighing.id },
        data: { status: 'APPROVED', approvedById: params.actor.userId, approvedAt: new Date(), isCurrent: becomesCurrent },
      });
      if (becomesCurrent) {
        // The batch's materialised current weight follows its current weighing.
        await tx.livestockGroup.update({
          where: { id: weighing.groupId },
          data: { currentWeightKg: new Prisma.Decimal(weighing.averageWeightGrams).div(1000) },
        });
      }
      await this.audit.write(
        {
          transactionId: weighing.id,
          module: 'operations',
          entityType: 'LivestockWeighing',
          entityId: weighing.id,
          status: 'APPROVED',
          action: AuditAction.APPROVE,
          userId: params.actor.userId,
          comments: becomesCurrent ? 'Approved; now the current weighing.' : 'Approved; a newer weighing stays current.',
        },
        tx,
      );
      return approved;
    });
  }

  async rejectWeighing(params: { companyId: string; weighingId: string; reason: string; actor: WorkflowActor }) {
    this.assertApprover(params.actor);
    const reason = params.reason?.trim();
    if (!reason) throw new BadRequestException('Say why the weighing is rejected.');
    return this.prisma.$transaction(async (tx) => {
      const weighing = await this.pendingWeighing(tx, params.companyId, params.weighingId);
      const rejected = await tx.livestockWeighing.update({
        where: { id: weighing.id },
        data: { status: 'REJECTED', approvedById: params.actor.userId, approvedAt: new Date(), rejectionReason: reason },
      });
      await this.audit.write(
        {
          transactionId: weighing.id,
          module: 'operations',
          entityType: 'LivestockWeighing',
          entityId: weighing.id,
          status: 'REJECTED',
          action: AuditAction.REJECT,
          userId: params.actor.userId,
          comments: reason,
        },
        tx,
      );
      return rejected;
    });
  }

  /** Weighings waiting for approval, across the farm. */
  async pendingWeighings(companyId: string) {
    const rows = await this.prisma.livestockWeighing.findMany({
      where: { companyId, status: 'PENDING' },
      orderBy: { weighedOn: 'asc' },
      include: {
        group: { select: { code: true, speciesKey: true } },
        recordedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    });
    return rows.map((w) => ({ ...toRow(w), groupCode: w.group.code, speciesKey: w.group.speciesKey }));
  }

  async setHatchDate(params: { companyId: string; code: string; hatchedOn: Date | null; estimated?: boolean; actor: WorkflowActor }) {
    const group = await this.prisma.livestockGroup.findFirst({ where: { code: params.code, companyId: params.companyId } });
    if (!group) throw new NotFoundException('No such group.');
    if (params.hatchedOn && params.hatchedOn > group.startedOn) {
      throw new BadRequestException(`${group.code} was placed on ${day(group.startedOn)}; it must have hatched on or before that.`);
    }
    await this.prisma.livestockGroup.update({
      where: { id: group.id },
      data: { hatchedOn: params.hatchedOn, hatchDateEstimated: params.hatchedOn ? params.estimated === true : false },
    });
    await this.audit.write({
      transactionId: group.id,
      module: 'operations',
      entityType: 'LivestockGroup',
      entityId: group.id,
      status: group.status,
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      comments: params.hatchedOn
        ? `${group.code} hatch date set to ${day(params.hatchedOn)} (${params.estimated ? 'estimated' : 'exact'}).`
        : `${group.code} hatch date cleared.`,
    });
  }

  private assertApprover(actor: WorkflowActor) {
    if (!actor.roles.some((role) => WEIGHING_APPROVERS.includes(role))) {
      throw new ForbiddenException('Only a supervisor or farm manager approves weighings.');
    }
  }

  private async pendingWeighing(tx: Prisma.TransactionClient, companyId: string, id: string) {
    const weighing = await tx.livestockWeighing.findFirst({ where: { id, companyId } });
    if (!weighing) throw new NotFoundException('No such weighing.');
    if (weighing.status !== 'PENDING') {
      throw new BadRequestException(`That weighing was already ${weighing.status.toLowerCase()}.`);
    }
    return weighing;
  }

  private async thresholds(companyId: string, speciesKey: string, breed: string, client: Prisma.TransactionClient = this.prisma) {
    const master = await client.speciesBreed.findFirst({
      where: { companyId, speciesKey, name: breed, active: true },
      include: { stages: { orderBy: [{ minDay: 'asc' }, { sortOrder: 'asc' }] } },
    });
    return master?.stages ?? [];
  }
}

/** Age on a day, counted from hatch where known, else from placement. */
export function ageOf(
  group: { hatchedOn: Date | null; hatchDateEstimated: boolean; startedOn: Date },
  on: Date,
): { days: number; basis: AgeBasis } {
  const born = group.hatchedOn ?? group.startedOn;
  return {
    days: Math.max(0, Math.floor((on.getTime() - born.getTime()) / DAY)),
    basis: group.hatchedOn ? (group.hatchDateEstimated ? 'ESTIMATED' : 'EXACT') : 'PLACEMENT',
  };
}

/** The last stage whose minimum age the batch has reached. */
export function suggestStage(stages: Array<{ stageName: string; minDay: number }>, ageDays: number): string | null {
  let suggested: string | null = null;
  for (const stage of [...stages].sort((a, b) => a.minDay - b.minDay)) {
    if (ageDays >= stage.minDay) suggested = stage.stageName;
  }
  return suggested;
}

function toRow(w: {
  id: string;
  weighedOn: Date;
  stage: string;
  ageDays: number;
  sampleSize: number;
  totalSampleWeightGrams: number;
  averageWeightGrams: number;
  unit: string;
  targetWeightGrams: number | null;
  status: string;
  isCurrent: boolean;
  rejectionReason: string | null;
  recordedBy: { fullName: string };
  approvedBy: { fullName: string } | null;
}): WeighingRow {
  const variance = w.targetWeightGrams === null ? null : w.averageWeightGrams - w.targetWeightGrams;
  return {
    id: w.id,
    weighedOn: day(w.weighedOn),
    stage: w.stage,
    ageDays: w.ageDays,
    sampleSize: w.sampleSize,
    totalSampleWeightGrams: w.totalSampleWeightGrams,
    averageWeightGrams: w.averageWeightGrams,
    unit: w.unit,
    targetWeightGrams: w.targetWeightGrams,
    varianceGrams: variance,
    variancePercent: variance === null || !w.targetWeightGrams ? null : ((variance / w.targetWeightGrams) * 100).toFixed(1),
    status: w.status,
    isCurrent: w.isCurrent,
    recordedBy: w.recordedBy.fullName,
    approvedBy: w.approvedBy?.fullName ?? null,
    rejectionReason: w.rejectionReason,
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const kilograms = (grams: bigint) => `${grams / 1000n}.${(grams % 1000n).toString().padStart(3, '0')}`;
