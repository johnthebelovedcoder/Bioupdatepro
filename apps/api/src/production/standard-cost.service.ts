import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RecipeService } from '../masters/recipe.service';
import { AccountingRuleViolation } from '../common/errors';
import type { WorkflowActor } from '../workflow/workflow.types';

type Client = PrismaService | Prisma.TransactionClient;

/** POL-001 names the Finance Head; SOP-050 the Cost Accountant prepares, Finance approves. */
const POLICY_ROLES = ['CFO', 'FINANCE_CONTROLLER'];
const RELEASE_ROLES = ['FINANCE_CONTROLLER', 'FINANCE_MANAGER', 'CFO', 'ADMINISTRATOR'];

export interface RollUpLine {
  kind: 'MATERIAL' | 'PACKAGING' | 'LABOUR' | 'MACHINE' | 'OVERHEAD' | 'DEPRECIATION';
  reference: string;
  description: string;
  quantity: string;
  unit: string;
  rateKobo: string;
  costKobo: string;
}

const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Standard costing (Costing_Policy_v2 POL-001/003, SOP-049/050, AC-MFG-002).
 *
 * Production posts at standard cost only. A year's policy is configured
 * before its first production posting and locked by it. A product's standard
 * is rolled up from its recipe (materials at approved standard rates) and
 * routing (hours × approved pool rates), prepared by one person and released
 * by another; release writes the product's item standard cost, which is what
 * a feed-mill order's good output is received at (PCR-034).
 */
@Injectable()
export class StandardCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly recipes: RecipeService,
  ) {}

  async yearOf(client: Client, companyId: string, on: Date) {
    const day = dayOf(on);
    const year = await client.financialYear.findFirst({
      where: { companyId, startDate: { lte: day }, endDate: { gte: day } },
      select: { id: true, code: true, startDate: true, endDate: true },
    });
    if (!year) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Financial calendar',
        `There is no financial year covering ${iso(day)}.`,
        { date: iso(day) },
      );
    }
    return year;
  }

  // --- Policy (SOP-049) -----------------------------------------------------

  async policies(companyId: string) {
    const [years, policies] = await Promise.all([
      this.prisma.financialYear.findMany({ where: { companyId }, orderBy: { startDate: 'desc' }, select: { id: true, code: true, startDate: true, endDate: true } }),
      this.prisma.costingPolicy.findMany({ where: { companyId } }),
    ]);
    return years.map((year) => {
      const policy = policies.find((p) => p.financialYearId === year.id);
      return {
        financialYearId: year.id,
        code: year.code,
        startDate: iso(year.startDate),
        endDate: iso(year.endDate),
        policy: policy
          ? {
              method: policy.method,
              varianceDisposition: policy.varianceDisposition,
              varianceTolerancePercent: policy.varianceTolerancePercent.toString(),
              prorationThresholdKobo: policy.prorationThresholdKobo.toString(),
              configuredAt: policy.configuredAt.toISOString(),
              lockedAt: policy.lockedAt?.toISOString() ?? null,
            }
          : null,
      };
    });
  }

  /**
   * Configure a year's policy: standard cost, variances to cost of sales, and
   * the tolerance above which a variance needs explaining. Changeable until
   * the year's first production posting locks it.
   */
  async configurePolicy(params: {
    companyId: string;
    financialYearId: string;
    varianceTolerancePercent?: Decimal.Value;
    /** POL-009: COGS (all to cost of sales) or PRORATE (spread above the threshold). */
    varianceDisposition?: 'COGS' | 'PRORATE';
    prorationThresholdKobo?: bigint;
    actor: WorkflowActor;
  }) {
    if (!params.actor.roles.some((r) => POLICY_ROLES.includes(r))) {
      throw new ForbiddenException('Only the CFO or finance controller configures the costing policy (POL-001).');
    }
    const year = await this.prisma.financialYear.findFirst({ where: { id: params.financialYearId, companyId: params.companyId }, select: { id: true, code: true } });
    if (!year) throw new NotFoundException('No such financial year.');
    const tolerance = new Decimal(params.varianceTolerancePercent ?? 20);
    if (tolerance.lte(0) || tolerance.gt(100)) throw new BadRequestException('Give a variance tolerance between 0 and 100%.');

    const existing = await this.prisma.costingPolicy.findFirst({ where: { companyId: params.companyId, financialYearId: year.id } });
    if (existing?.lockedAt) {
      throw new AccountingRuleViolation(
        'POL-001 — Costing method lock',
        `${year.code}'s costing policy was locked by its first production posting on ${iso(existing.lockedAt)}. A change takes effect from next year's policy.`,
        { financialYear: year.code },
      );
    }
    const disposition = params.varianceDisposition ?? existing?.varianceDisposition ?? 'COGS';
    if (disposition !== 'COGS' && disposition !== 'PRORATE') throw new BadRequestException('Variances go to cost of sales (COGS) or are prorated (PRORATE).');
    const threshold = params.prorationThresholdKobo ?? existing?.prorationThresholdKobo ?? 0n;
    if (threshold < 0n) throw new BadRequestException('The proration threshold cannot be negative.');
    const data = {
      varianceTolerancePercent: new Prisma.Decimal(tolerance.toString()),
      varianceDisposition: disposition,
      prorationThresholdKobo: threshold,
      configuredById: params.actor.userId,
      configuredAt: new Date(),
    };
    const policy = existing
      ? await this.prisma.costingPolicy.update({ where: { id: existing.id }, data })
      : await this.prisma.costingPolicy.create({ data: { ...data, companyId: params.companyId, financialYearId: year.id } });
    await this.audit.write({
      transactionId: policy.id,
      module: 'production',
      entityType: 'CostingPolicy',
      entityId: policy.id,
      status: 'ACTIVE',
      action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId,
      comments: `${year.code}: standard cost only, variances ${disposition === 'PRORATE' ? `prorated over cost of sales, finished goods and WIP at ${threshold} kobo or more` : 'to cost of sales'}, tolerance ${tolerance.toString()}%.`,
    });
    return policy;
  }

  /**
   * The policy a production posting on `on` falls under — refused if the
   * year has none — locking it on first use (AC-MFG-002).
   */
  async requirePolicy(client: Client, companyId: string, on: Date) {
    const year = await this.yearOf(client, companyId, on);
    const policy = await client.costingPolicy.findFirst({ where: { companyId, financialYearId: year.id } });
    if (!policy) {
      throw new AccountingRuleViolation(
        'POL-001 — Costing policy before first posting',
        `${year.code} has no costing policy. The CFO configures it (Feed mill → Standard costs) before production posts in the year.`,
        { financialYear: year.code },
      );
    }
    if (!policy.lockedAt) {
      await client.costingPolicy.updateMany({ where: { id: policy.id, companyId, lockedAt: null }, data: { lockedAt: new Date() } });
    }
    return policy;
  }

  /** The policy a date falls under, without locking it — for reading. */
  async policyOn(client: Client, companyId: string, on: Date) {
    const year = await this.yearOf(client, companyId, on);
    return client.costingPolicy.findFirst({ where: { companyId, financialYearId: year.id } });
  }

  // --- Workbench (SOP-050) --------------------------------------------------

  /**
   * The standard for one batch of a recipe version on a date: every
   * component at its approved standard rate (with wastage), every routing
   * operation's setup plus run hours at its pool's approved rate.
   */
  async rollUp(companyId: string, recipeVersionId: string, on: Date) {
    const version = await this.prisma.productRecipeVersion.findFirst({
      where: { id: recipeVersionId, recipe: { companyId } },
      include: { recipe: { select: { code: true, outputItemId: true } } },
    });
    if (!version) throw new NotFoundException('No such recipe version.');
    const batch = new Decimal(version.batchSize.toString());

    const explosion = await this.recipes.explode({ recipeVersionId, quantity: batch, on });
    const lines: RollUpLine[] = explosion.components.map((c) => ({
      kind: c.componentType === 'PACKAGING' ? 'PACKAGING' : 'MATERIAL',
      reference: c.itemCode,
      description: c.description,
      quantity: c.grossQuantity,
      unit: c.unitOfMeasure,
      rateKobo: c.standardCostKobo,
      costKobo: c.extendedCostKobo,
    }));

    const operations = await this.prisma.routingOperation.findMany({
      where: { companyId, recipeVersionId, active: true },
      include: { costPool: { select: { name: true, driverName: true } } },
      orderBy: { sequence: 'asc' },
    });
    const day = dayOf(on);
    for (const op of operations) {
      const rate = await this.prisma.costPoolRate.findFirst({
        where: { poolId: op.costPoolId, pool: { companyId }, effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!rate) {
        throw new AccountingRuleViolation(
          'ABC_Pools_Drivers — approved rate required',
          `Cost pool "${op.costPool.name}" has no rate effective on ${iso(day)}, so ${version.recipe.code}'s standard cannot be rolled up.`,
          { pool: op.costPool.name },
        );
      }
      const hours = new Decimal(op.setupHours.toString()).plus(new Decimal(op.runHoursPerUnit.toString()).mul(batch));
      const cost = BigInt(hours.mul(rate.ratePerUnitKobo.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      lines.push({
        kind: op.resourceType,
        reference: `OP${op.sequence}`,
        description: `${op.operationName} — ${op.costPool.name}`,
        quantity: hours.toFixed(6),
        unit: op.costPool.driverName,
        rateKobo: rate.ratePerUnitKobo.toString(),
        costKobo: cost.toString(),
      });
    }

    const sum = (kind: RollUpLine['kind']) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + BigInt(l.costKobo), 0n);
    const materialKobo = sum('MATERIAL');
    const packagingKobo = sum('PACKAGING');
    const labourKobo = sum('LABOUR');
    const machineKobo = sum('MACHINE');
    const overheadKobo = sum('OVERHEAD');
    const depreciationKobo = sum('DEPRECIATION');
    const totalKobo = materialKobo + packagingKobo + labourKobo + machineKobo + overheadKobo + depreciationKobo;
    const unitCostKobo = BigInt(new Decimal(totalKobo.toString()).div(batch).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
    return {
      recipeVersionId,
      itemId: version.recipe.outputItemId,
      recipeCode: version.recipe.code,
      outputQuantity: batch.toFixed(6),
      materialKobo,
      packagingKobo,
      labourKobo,
      machineKobo,
      overheadKobo,
      depreciationKobo,
      totalKobo,
      unitCostKobo,
      lines,
    };
  }

  /** Prepare a standard from a recipe version's roll-up, for someone else to release. */
  async prepare(params: { companyId: string; recipeVersionId: string; effectiveFrom: Date; actor: WorkflowActor }) {
    const effectiveFrom = dayOf(params.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) throw new BadRequestException('Give the date the standard applies from.');
    const year = await this.yearOf(this.prisma, params.companyId, effectiveFrom);
    const policy = await this.prisma.costingPolicy.findFirst({ where: { companyId: params.companyId, financialYearId: year.id } });
    if (!policy) {
      throw new AccountingRuleViolation(
        'SOP-049 — Policy before standards',
        `Configure ${year.code}'s costing policy before preparing its standards.`,
        { financialYear: year.code },
      );
    }
    const rolled = await this.rollUp(params.companyId, params.recipeVersionId, effectiveFrom);

    const waiting = await this.prisma.standardCostVersion.findFirst({
      where: { companyId: params.companyId, itemId: rolled.itemId, financialYearId: year.id, status: 'PENDING' },
      select: { versionNumber: true },
    });
    if (waiting) {
      throw new AccountingRuleViolation(
        'SOP-050 — One revision at a time',
        `Version ${waiting.versionNumber} of this product's ${year.code} standard is waiting for release. Release or reject it first.`,
        { versionNumber: waiting.versionNumber },
      );
    }
    const [latest, current] = await Promise.all([
      this.prisma.standardCostVersion.findFirst({
        where: { companyId: params.companyId, itemId: rolled.itemId, financialYearId: year.id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      }),
      this.prisma.standardCostVersion.findFirst({
        where: { companyId: params.companyId, itemId: rolled.itemId, status: 'RELEASED' },
        orderBy: { effectiveFrom: 'desc' },
        select: { unitCostKobo: true, effectiveFrom: true },
      }),
    ]);
    if (current && effectiveFrom <= current.effectiveFrom) {
      throw new AccountingRuleViolation(
        'SOP-050 — Standards are dated forward',
        `The released standard applies from ${iso(current.effectiveFrom)}; a revision must apply from a later date.`,
        { current: iso(current.effectiveFrom) },
      );
    }

    const version = await this.prisma.standardCostVersion.create({
      data: {
        companyId: params.companyId,
        itemId: rolled.itemId,
        recipeVersionId: params.recipeVersionId,
        financialYearId: year.id,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        effectiveFrom,
        outputQuantity: new Prisma.Decimal(rolled.outputQuantity),
        materialKobo: rolled.materialKobo,
        packagingKobo: rolled.packagingKobo,
        labourKobo: rolled.labourKobo,
        machineKobo: rolled.machineKobo,
        overheadKobo: rolled.overheadKobo,
        depreciationKobo: rolled.depreciationKobo,
        totalKobo: rolled.totalKobo,
        unitCostKobo: rolled.unitCostKobo,
        previousUnitCostKobo: current?.unitCostKobo ?? null,
        lines: rolled.lines as unknown as Prisma.InputJsonValue,
        preparedById: params.actor.userId,
      },
    });
    await this.audit.write({
      transactionId: version.id,
      module: 'production',
      entityType: 'StandardCostVersion',
      entityId: version.id,
      status: 'PENDING',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      comments: `Prepared ${rolled.recipeCode} ${year.code} v${version.versionNumber}: ${rolled.unitCostKobo} kobo a unit from ${iso(effectiveFrom)}.`,
    });
    return version;
  }

  /**
   * Release or reject a prepared standard. Release supersedes the product's
   * previous standard for the year and sets its item standard cost from the
   * version's date — "standard-cost update only" (SOP-050).
   */
  async decide(params: { companyId: string; versionId: string; approve: boolean; reason?: string; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => RELEASE_ROLES.includes(r))) {
      throw new ForbiddenException('Only the finance controller, finance manager or CFO releases a standard cost.');
    }
    const version = await this.prisma.standardCostVersion.findFirst({
      where: { id: params.versionId, companyId: params.companyId },
      include: { item: { select: { code: true } } },
    });
    if (!version) throw new NotFoundException('No such standard-cost version.');
    if (version.status !== 'PENDING') throw new BadRequestException(`That version was already ${version.status.toLowerCase()}.`);
    if (params.approve && version.preparedById === params.actor.userId) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) throw new ForbiddenException('You prepared this standard, so someone else must release it.');
    }
    if (!params.approve && !params.reason?.trim()) throw new BadRequestException('Say why the standard is rejected.');

    return this.prisma.$transaction(async (tx) => {
      if (params.approve) {
        const clash = await tx.itemStandardCost.findFirst({
          where: { itemId: version.itemId, item: { companyId: params.companyId }, effectiveFrom: { gte: version.effectiveFrom } },
          select: { effectiveFrom: true },
        });
        if (clash) {
          throw new AccountingRuleViolation(
            'SOP-050 — Standards are dated forward',
            `${version.item.code} already has a standard cost from ${iso(clash.effectiveFrom)}; this version applies from ${iso(version.effectiveFrom)}.`,
            { item: version.item.code },
          );
        }
        await tx.standardCostVersion.updateMany({
          where: { companyId: params.companyId, itemId: version.itemId, financialYearId: version.financialYearId, status: 'RELEASED' },
          data: { status: 'SUPERSEDED' },
        });
        const previousDay = new Date(version.effectiveFrom);
        previousDay.setUTCDate(previousDay.getUTCDate() - 1);
        await tx.itemStandardCost.updateMany({
          where: { itemId: version.itemId, item: { companyId: params.companyId }, effectiveTo: null, effectiveFrom: { lt: version.effectiveFrom } },
          data: { effectiveTo: previousDay },
        });
        await tx.itemStandardCost.create({
          data: {
            itemId: version.itemId,
            standardCostKobo: version.unitCostKobo,
            effectiveFrom: version.effectiveFrom,
            sourceReference: `Standard cost version ${version.versionNumber} (${version.id})`,
          },
        });
      }
      const decided = await tx.standardCostVersion.update({
        where: { id: version.id },
        data: params.approve
          ? { status: 'RELEASED', approvedById: params.actor.userId, approvedAt: new Date() }
          : { status: 'REJECTED', approvedById: params.actor.userId, approvedAt: new Date(), rejectionReason: params.reason!.trim() },
      });
      await this.audit.write(
        {
          transactionId: version.id,
          module: 'production',
          entityType: 'StandardCostVersion',
          entityId: version.id,
          status: decided.status,
          action: params.approve ? AuditAction.APPROVE : AuditAction.REJECT,
          userId: params.actor.userId,
          comments: params.approve
            ? `Released ${version.item.code} v${version.versionNumber} at ${version.unitCostKobo} kobo a unit from ${iso(version.effectiveFrom)}.`
            : params.reason!.trim(),
        },
        tx,
      );
      return decided;
    });
  }

  /** The released standard a product's output is received at on a date (PCR-034). */
  async releasedFor(client: Client, companyId: string, itemId: string, on: Date) {
    const year = await this.yearOf(client, companyId, on);
    const version = await client.standardCostVersion.findFirst({
      where: { companyId, itemId, financialYearId: year.id, status: 'RELEASED', effectiveFrom: { lte: dayOf(on) } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!version) {
      const item = await client.item.findFirst({ where: { id: itemId, companyId }, select: { code: true } });
      throw new AccountingRuleViolation(
        'PCR-034 — Released standard required',
        `${item?.code ?? 'This product'} has no released ${year.code} standard cost on ${iso(dayOf(on))}. Prepare and release one (Feed mill → Standard costs) before receiving its output.`,
        { itemId },
      );
    }
    return version;
  }

  async list(companyId: string) {
    const versions = await this.prisma.standardCostVersion.findMany({
      where: { companyId },
      include: {
        item: { select: { code: true, description: true } },
        recipeVersion: { select: { version: true, recipe: { select: { code: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    const ids = [...new Set(versions.flatMap((v) => [v.preparedById, v.approvedById]).filter((id): id is string => Boolean(id)))];
    const [users, years] = await Promise.all([
      this.prisma.user.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, fullName: true } }),
      this.prisma.financialYear.findMany({ where: { companyId }, select: { id: true, code: true } }),
    ]);
    const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.fullName ?? 'someone' : null);
    return versions.map((v) => ({
      id: v.id,
      item: `${v.item.code} — ${v.item.description}`,
      recipe: `${v.recipeVersion.recipe.code} v${v.recipeVersion.version}`,
      financialYear: years.find((y) => y.id === v.financialYearId)?.code ?? '',
      versionNumber: v.versionNumber,
      effectiveFrom: iso(v.effectiveFrom),
      outputQuantity: v.outputQuantity.toString(),
      materialKobo: v.materialKobo.toString(),
      packagingKobo: v.packagingKobo.toString(),
      labourKobo: v.labourKobo.toString(),
      machineKobo: v.machineKobo.toString(),
      overheadKobo: v.overheadKobo.toString(),
      depreciationKobo: v.depreciationKobo.toString(),
      totalKobo: v.totalKobo.toString(),
      unitCostKobo: v.unitCostKobo.toString(),
      previousUnitCostKobo: v.previousUnitCostKobo?.toString() ?? null,
      lines: v.lines as unknown as RollUpLine[],
      status: v.status,
      preparedBy: name(v.preparedById),
      approvedBy: name(v.approvedById),
      rejectionReason: v.rejectionReason,
    }));
  }
}
