import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, IncubationBatchStatus, IncubationReadingKind, Prisma } from '@bioassetpro/database';
import type { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { allowsSelfApproval } from '../workflow/self-approval';
import { AccountingRuleViolation } from '../common/errors';

/** Who sets the incubation standard and acknowledges an exception. */
export const HATCHERY_SUPERVISORS = ['FARM_MANAGER', 'POULTRY_SUPERVISOR', 'PRODUCTION_SUPERVISOR', 'PRODUCTION_LEAD', 'QA_OFFICER', 'CFO'];

const HOUR = 60 * 60 * 1000;
type Client = Prisma.TransactionClient | PrismaClient;

/**
 * The incubation log (FR-LIFE-04 "capture incubation readings and alert on
 * missing/out-of-range values — exceptions routed and retained"; SOP-EGG-04;
 * P-EGG-05 "monitor/candle").
 *
 * Temperature, humidity and turning are logged against each batch in the
 * setter, and candling results as they are taken. A reading outside the
 * company's standard is an exception a supervisor acknowledges — with what
 * was done about it — and a batch cannot be hatched while one is open. A
 * reading due and not taken shows as overdue, and every gap longer than the
 * reading interval is counted against the batch.
 */
@Injectable()
export class IncubationLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Incubators, with the eggs in each now. */
  async incubators(companyId: string) {
    const [rows, inside] = await Promise.all([
      this.prisma.incubator.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
      this.prisma.incubationBatch.groupBy({ by: ['incubator'], where: { companyId, status: IncubationBatchStatus.SET }, _sum: { setQuantity: true } }),
    ]);
    return rows.map((i) => {
      const used = inside.filter((g) => g.incubator === i.code || g.incubator === i.name).reduce((sum, g) => sum + (g._sum.setQuantity ?? 0), 0);
      return { id: i.id, code: i.code, name: i.name, capacityEggs: i.capacityEggs, active: i.active, eggsIn: used, free: Math.max(0, i.capacityEggs - used) };
    });
  }

  /** Register an incubator, or change its name, capacity or whether it is in use. */
  async saveIncubator(params: { companyId: string; code: string; name: string; capacityEggs: number; active: boolean; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => HATCHERY_SUPERVISORS.includes(r))) {
      throw new ForbiddenException('The farm manager, a supervisor or QA registers incubators.');
    }
    const code = params.code?.trim().toUpperCase();
    const name = params.name?.trim();
    if (!code || !name) throw new BadRequestException('An incubator needs a code and a name.');
    if (!Number.isInteger(params.capacityEggs) || params.capacityEggs <= 0) throw new BadRequestException('Capacity is a whole number of eggs above zero.');
    const before = await this.prisma.incubator.findFirst({ where: { companyId: params.companyId, code } });
    const saved = await this.prisma.incubator.upsert({
      where: { companyId_code: { companyId: params.companyId, code } },
      create: { companyId: params.companyId, code, name, capacityEggs: params.capacityEggs, active: params.active },
      update: { name, capacityEggs: params.capacityEggs, active: params.active },
    });
    await this.audit.write({
      transactionId: saved.id,
      module: 'poultry-egg',
      entityType: 'Incubator',
      entityId: saved.id,
      status: saved.active ? 'ACTIVE' : 'INACTIVE',
      action: before ? AuditAction.UPDATE : AuditAction.CREATE,
      userId: params.actor.userId,
      oldValue: before ? { name: before.name, capacityEggs: before.capacityEggs, active: before.active } : undefined,
      newValue: { code, name, capacityEggs: params.capacityEggs, active: params.active },
    });
    return { id: saved.id };
  }

  async standard(companyId: string) {
    const s = await this.prisma.incubationStandard.findFirst({ where: { companyId } });
    return s
      ? {
          minTemperatureC: s.minTemperatureC.toString(),
          maxTemperatureC: s.maxTemperatureC.toString(),
          minHumidityPercent: s.minHumidityPercent.toString(),
          maxHumidityPercent: s.maxHumidityPercent.toString(),
          readingIntervalHours: s.readingIntervalHours,
        }
      : null;
  }

  async setStandard(params: {
    companyId: string;
    minTemperatureC: Decimal.Value;
    maxTemperatureC: Decimal.Value;
    minHumidityPercent: Decimal.Value;
    maxHumidityPercent: Decimal.Value;
    readingIntervalHours: number;
    actor: WorkflowActor;
  }) {
    if (!params.actor.roles.some((r) => HATCHERY_SUPERVISORS.includes(r))) {
      throw new ForbiddenException('The farm manager, a supervisor or QA sets the incubation standard.');
    }
    const given = [params.minTemperatureC, params.maxTemperatureC, params.minHumidityPercent, params.maxHumidityPercent];
    if (given.some((v) => v === undefined || v === null || v === '' || Number.isNaN(Number(v)))) {
      throw new BadRequestException('Give a temperature range and a humidity range as numbers.');
    }
    const tMin = new Decimal(params.minTemperatureC);
    const tMax = new Decimal(params.maxTemperatureC);
    const hMin = new Decimal(params.minHumidityPercent);
    const hMax = new Decimal(params.maxHumidityPercent);
    if ([tMin, tMax, hMin, hMax].some((d) => d.isNaN()) || tMin.gt(tMax) || hMin.gt(hMax) || hMin.lt(0) || hMax.gt(100)) {
      throw new BadRequestException('Give a temperature range and a humidity range (0–100%), low before high.');
    }
    if (!Number.isInteger(params.readingIntervalHours) || params.readingIntervalHours < 1 || params.readingIntervalHours > 48) {
      throw new BadRequestException('Readings are due every 1 to 48 hours.');
    }
    const data = {
      minTemperatureC: new Prisma.Decimal(tMin.toFixed(2)),
      maxTemperatureC: new Prisma.Decimal(tMax.toFixed(2)),
      minHumidityPercent: new Prisma.Decimal(hMin.toFixed(2)),
      maxHumidityPercent: new Prisma.Decimal(hMax.toFixed(2)),
      readingIntervalHours: params.readingIntervalHours,
      setById: params.actor.userId,
    };
    const before = await this.standard(params.companyId);
    const saved = await this.prisma.incubationStandard.upsert({ where: { companyId: params.companyId }, create: { companyId: params.companyId, ...data }, update: data });
    await this.audit.write({
      transactionId: saved.id,
      module: 'poultry-egg',
      entityType: 'IncubationStandard',
      entityId: saved.id,
      status: 'ACTIVE',
      action: before ? AuditAction.UPDATE : AuditAction.CREATE,
      userId: params.actor.userId,
      oldValue: before ?? undefined,
      newValue: { ...data, minTemperatureC: tMin.toString(), maxTemperatureC: tMax.toString(), minHumidityPercent: hMin.toString(), maxHumidityPercent: hMax.toString() },
    });
    return this.standard(params.companyId);
  }

  /** Every batch in the setter: when last read, whether a reading is overdue, gaps, open exceptions and candling. */
  async overview(companyId: string, now = new Date()) {
    const [standard, batches] = await Promise.all([
      this.prisma.incubationStandard.findFirst({ where: { companyId } }),
      this.prisma.incubationBatch.findMany({
        where: { companyId, status: IncubationBatchStatus.SET },
        orderBy: { setOn: 'asc' },
        include: { eggBatch: { select: { code: true } }, readings: { orderBy: { readAt: 'asc' } } },
      }),
    ]);
    const interval = standard ? standard.readingIntervalHours * HOUR : null;
    return {
      standard: standard ? { readingIntervalHours: standard.readingIntervalHours } : null,
      batches: batches.map((b) => {
        const env = b.readings.filter((r) => r.kind === IncubationReadingKind.ENVIRONMENT);
        const last = env.at(-1)?.readAt ?? null;
        let gaps = 0;
        if (interval) {
          let previous = b.setOn.getTime();
          for (const r of env) {
            if (r.readAt.getTime() - previous > interval) gaps += 1;
            previous = r.readAt.getTime();
          }
        }
        const since = (last ?? b.setOn).getTime();
        const candling = b.readings.filter((r) => r.kind === IncubationReadingKind.CANDLING).at(-1) ?? null;
        return {
          id: b.id,
          code: b.code,
          eggBatch: b.eggBatch.code,
          incubator: b.incubator,
          setOn: b.setOn.toISOString().slice(0, 10),
          setQuantity: b.setQuantity,
          readings: env.length,
          lastReadAt: last,
          overdue: interval !== null && now.getTime() - since > interval,
          hoursSinceReading: Math.floor((now.getTime() - since) / HOUR),
          missedReadings: gaps,
          openExceptions: b.readings.filter((r) => r.exceptions.length > 0 && !r.acknowledgedAt).length,
          candling: candling
            ? { on: candling.readAt, fertile: candling.fertileCount, clear: candling.clearCount, deadInShell: candling.deadInShellCount }
            : null,
        };
      }),
    };
  }

  async readings(companyId: string, incubationBatchId: string) {
    const batch = await this.prisma.incubationBatch.findFirst({ where: { id: incubationBatchId, companyId }, select: { id: true, code: true, setOn: true, setQuantity: true, status: true } });
    if (!batch) throw new NotFoundException('No such incubation batch.');
    const rows = await this.prisma.incubationReading.findMany({ where: { companyId, incubationBatchId: batch.id }, orderBy: { readAt: 'desc' } });
    return {
      batch: { ...batch, setOn: batch.setOn.toISOString().slice(0, 10) },
      readings: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        readAt: r.readAt,
        temperatureC: r.temperatureC?.toString() ?? null,
        humidityPercent: r.humidityPercent?.toString() ?? null,
        turned: r.turned,
        fertileCount: r.fertileCount,
        clearCount: r.clearCount,
        deadInShellCount: r.deadInShellCount,
        note: r.note,
        exceptions: r.exceptions,
        recordedById: r.recordedById,
        acknowledgedAt: r.acknowledgedAt,
        actionTaken: r.actionTaken,
      })),
    };
  }

  async record(params: {
    companyId: string;
    incubationBatchId: string;
    kind: IncubationReadingKind;
    readAt: Date;
    temperatureC?: Decimal.Value | null;
    humidityPercent?: Decimal.Value | null;
    turned?: boolean | null;
    fertileCount?: number | null;
    clearCount?: number | null;
    deadInShellCount?: number | null;
    note?: string | null;
    actor: WorkflowActor;
  }) {
    const batch = await this.prisma.incubationBatch.findFirst({ where: { id: params.incubationBatchId, companyId: params.companyId } });
    if (!batch) throw new NotFoundException('No such incubation batch.');
    if (batch.status !== IncubationBatchStatus.SET) throw new BadRequestException(`${batch.code} has hatched; its log is closed.`);
    if (params.readAt.getTime() > Date.now() + 5 * 60 * 1000) throw new BadRequestException('A reading cannot be in the future.');
    if (params.readAt < batch.setOn) throw new BadRequestException(`${batch.code} was set on ${batch.setOn.toISOString().slice(0, 10)}; a reading cannot be before that.`);

    const exceptions: string[] = [];
    let temperature: Decimal | null = null;
    let humidity: Decimal | null = null;
    if (params.kind === IncubationReadingKind.ENVIRONMENT) {
      for (const v of [params.temperatureC, params.humidityPercent]) {
        if (v !== undefined && v !== null && v !== '' && Number.isNaN(Number(v))) throw new BadRequestException('Readings are numbers.');
      }
      temperature = params.temperatureC === undefined || params.temperatureC === null || params.temperatureC === '' ? null : new Decimal(params.temperatureC);
      humidity = params.humidityPercent === undefined || params.humidityPercent === null || params.humidityPercent === '' ? null : new Decimal(params.humidityPercent);
      if (!temperature && !humidity) throw new BadRequestException('Give the temperature, the humidity, or both.');
      if ([temperature, humidity].some((d) => d?.isNaN())) throw new BadRequestException('Readings are numbers.');
      const standard = await this.prisma.incubationStandard.findFirst({ where: { companyId: params.companyId } });
      if (standard) {
        if (temperature && (temperature.lt(standard.minTemperatureC.toString()) || temperature.gt(standard.maxTemperatureC.toString()))) {
          exceptions.push(`Temperature ${temperature}°C outside ${standard.minTemperatureC}–${standard.maxTemperatureC}°C.`);
        }
        if (humidity && (humidity.lt(standard.minHumidityPercent.toString()) || humidity.gt(standard.maxHumidityPercent.toString()))) {
          exceptions.push(`Humidity ${humidity}% outside ${standard.minHumidityPercent}–${standard.maxHumidityPercent}%.`);
        }
        if (!temperature) exceptions.push('Temperature not read.');
        if (!humidity) exceptions.push('Humidity not read.');
      }
      if (params.turned === false) exceptions.push('Eggs not turned.');
    } else {
      const counts = [params.fertileCount, params.clearCount, params.deadInShellCount].map((v) => (v === undefined || v === null ? 0 : v));
      if (counts.some((c) => !Number.isInteger(c) || c < 0)) throw new BadRequestException('Candling counts are whole numbers, zero or more.');
      const total = counts.reduce((s, c) => s + c, 0);
      if (total === 0) throw new BadRequestException('Give the candling counts.');
      if (total > batch.setQuantity) {
        throw new BadRequestException(`${total} eggs candled, but ${batch.code} set ${batch.setQuantity}.`);
      }
    }

    const reading = await this.prisma.incubationReading.create({
      data: {
        companyId: params.companyId,
        incubationBatchId: batch.id,
        kind: params.kind,
        readAt: params.readAt,
        temperatureC: temperature ? new Prisma.Decimal(temperature.toFixed(2)) : null,
        humidityPercent: humidity ? new Prisma.Decimal(humidity.toFixed(2)) : null,
        turned: params.kind === IncubationReadingKind.ENVIRONMENT ? (params.turned ?? null) : null,
        fertileCount: params.kind === IncubationReadingKind.CANDLING ? (params.fertileCount ?? 0) : null,
        clearCount: params.kind === IncubationReadingKind.CANDLING ? (params.clearCount ?? 0) : null,
        deadInShellCount: params.kind === IncubationReadingKind.CANDLING ? (params.deadInShellCount ?? 0) : null,
        note: params.note?.trim() || null,
        exceptions,
        recordedById: params.actor.userId,
      },
    });
    await this.audit.write({
      transactionId: batch.id,
      module: 'poultry-egg',
      entityType: 'IncubationReading',
      entityId: reading.id,
      status: exceptions.length ? 'EXCEPTION' : 'RECORDED',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      comments: exceptions.length ? `${batch.code}: ${exceptions.join(' ')}` : `${batch.code} ${params.kind.toLowerCase()} reading.`,
    });
    return { id: reading.id, exceptions };
  }

  /** A supervisor acknowledges an out-of-range reading, saying what was done. */
  async acknowledge(params: { companyId: string; readingId: string; actionTaken: string; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => HATCHERY_SUPERVISORS.includes(r))) {
      throw new ForbiddenException('A supervisor, the farm manager or QA acknowledges an incubation exception.');
    }
    const reading = await this.prisma.incubationReading.findFirst({ where: { id: params.readingId, companyId: params.companyId } });
    if (!reading) throw new NotFoundException('No such reading.');
    if (reading.exceptions.length === 0) throw new BadRequestException('That reading was within the standard.');
    if (reading.acknowledgedAt) throw new BadRequestException('Already acknowledged.');
    if (!params.actionTaken?.trim()) throw new BadRequestException('Say what was done about it.');
    if (reading.recordedById === params.actor.userId && !(await allowsSelfApproval(this.prisma, params.companyId))) {
      throw new ForbiddenException('You took this reading, so a supervisor acknowledges it.');
    }
    await this.prisma.incubationReading.update({
      where: { id: reading.id },
      data: { acknowledgedById: params.actor.userId, acknowledgedAt: new Date(), actionTaken: params.actionTaken.trim() },
    });
    await this.audit.write({
      transactionId: reading.incubationBatchId,
      module: 'poultry-egg',
      entityType: 'IncubationReading',
      entityId: reading.id,
      status: 'ACKNOWLEDGED',
      action: AuditAction.APPROVE,
      userId: params.actor.userId,
      comments: params.actionTaken.trim(),
    });
    return { id: reading.id };
  }
}

/**
 * Before a hatch is recorded (FR-LIFE-03/04): no incubation exception left
 * unacknowledged, and the unhatched and damaged at least cover the clear and
 * dead-in-shell eggs the last candling found.
 */
export async function assertReadyToHatch(client: Client, params: { companyId: string; incubationBatchId: string; code: string; unhatchedCount: number; damagedCount: number }) {
  const readings = await client.incubationReading.findMany({
    where: { companyId: params.companyId, incubationBatchId: params.incubationBatchId },
    orderBy: { readAt: 'desc' },
    select: { kind: true, exceptions: true, acknowledgedAt: true, clearCount: true, deadInShellCount: true },
  });
  const open = readings.filter((r) => r.exceptions.length > 0 && !r.acknowledgedAt).length;
  if (open > 0) {
    throw new AccountingRuleViolation(
      'FR-LIFE-04 — Incubation exceptions',
      `${params.code} has ${open} incubation exception${open === 1 ? '' : 's'} not yet acknowledged by a supervisor. Acknowledge ${open === 1 ? 'it' : 'them'}, with what was done, before the hatch is recorded.`,
      { code: params.code, open },
    );
  }
  const candling = readings.find((r) => r.kind === IncubationReadingKind.CANDLING);
  if (candling) {
    const removed = (candling.clearCount ?? 0) + (candling.deadInShellCount ?? 0);
    if (params.unhatchedCount + params.damagedCount < removed) {
      throw new AccountingRuleViolation(
        'FR-LIFE-03 — Candling reconciles to the hatch',
        `Candling found ${removed} clear or dead-in-shell egg${removed === 1 ? '' : 's'} in ${params.code}, but only ${params.unhatchedCount + params.damagedCount} are recorded as unhatched or damaged.`,
        { code: params.code, removed },
      );
    }
  }
}

/**
 * INT-025 "set requires capacity": once a company has registered incubators,
 * a set names one of them (by code or name) and must fit in what it has free —
 * its capacity less the eggs already in it. Returns the incubator's code to
 * store on the batch. With none registered, the incubator stays free text.
 */
export async function assertIncubatorRoom(client: Client, params: { companyId: string; incubator: string | null; setQuantity: number }): Promise<string | null> {
  const incubators = await client.incubator.findMany({ where: { companyId: params.companyId, active: true } });
  if (incubators.length === 0) return params.incubator?.trim() || null;
  const named = params.incubator?.trim().toLowerCase();
  const incubator = incubators.find((i) => i.code.toLowerCase() === named || i.name.toLowerCase() === named);
  if (!incubator) {
    throw new AccountingRuleViolation(
      'INT-025 — Incubator capacity',
      `Name the incubator these eggs go into: ${incubators.map((i) => i.code).join(', ')}.`,
      { incubators: incubators.map((i) => i.code) },
    );
  }
  const inside = await client.incubationBatch.aggregate({
    where: { companyId: params.companyId, status: IncubationBatchStatus.SET, incubator: { in: [incubator.code, incubator.name] } },
    _sum: { setQuantity: true },
  });
  const used = inside._sum.setQuantity ?? 0;
  const free = incubator.capacityEggs - used;
  if (params.setQuantity > free) {
    throw new AccountingRuleViolation(
      'INT-025 — Incubator capacity',
      `${incubator.code} holds ${incubator.capacityEggs} eggs and has ${used} in it, so ${Math.max(0, free)} can go in; ${params.setQuantity} were asked. Set fewer, or use another incubator.`,
      { incubator: incubator.code, capacity: incubator.capacityEggs, used, requested: params.setQuantity },
    );
  }
  return incubator.code;
}
