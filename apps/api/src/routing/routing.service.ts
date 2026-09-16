import { Injectable } from '@nestjs/common';
import { AuditAction, RoutingResourceType } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { Kobo } from '../common/money';

/** Long enough for a create plus its audit record on a cold connection pool — same margin every other master-data write in this codebase uses. */
const TRANSACTION_OPTIONS = { timeout: 20_000 };

/**
 * Routing and activity-based costing — BOM_Routing, ABC_Pools_Drivers,
 * MFG_ABC_Spec (US-897-014/015).
 *
 * Additive and standalone by design: `snapshotRouting()` is a separate call,
 * not wired into `ProductionOrderService`'s own creation flow, so this never
 * touches the already-Built, already-live-verified standard/actual
 * conversion-cost absorption those stories post through (PCR-053/054/055
 * etc). It gives the more granular, per-operation costing view these two
 * stories actually ask for, computed and reported alongside the GL rather
 * than replacing it.
 */
@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Cost pools — the ABC side (US-897-015)                              */
  /* ------------------------------------------------------------------ */

  async createCostPool(params: {
    companyId: string;
    code: string;
    name: string;
    driverName: string;
    actorId: string;
  }) {
    const pool = await this.prisma.costPool.create({
      data: {
        companyId: params.companyId,
        code: params.code,
        name: params.name,
        driverName: params.driverName,
      },
    });

    await this.audit.write({
      transactionId: pool.id,
      module: 'routing',
      entityType: 'CostPool',
      entityId: pool.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actorId,
      comments: `Created cost pool ${pool.code} — ${pool.name}, driven by ${pool.driverName}.`,
    });

    return pool;
  }

  /**
   * Set a pool's cost and practical capacity, effective from a date —
   * closing the previous rate the day before, the same discipline
   * `ItemService.setStandardCost()` already uses for standard cost, so a
   * production order costed last month still resolves the rate that
   * applied then.
   *
   * `ratePerUnitKobo` is computed here, never taken from the caller — the
   * story's own formula is "reconciled pool cost ÷ practical capacity",
   * and a rate typed in by hand could silently drift from the two numbers
   * it is supposed to be derived from.
   */
  async setCostPoolRate(params: {
    companyId: string;
    poolId: string;
    poolCost: Kobo;
    practicalCapacity: string;
    effectiveFrom: Date;
    sourceReference?: string | null;
    actorId: string;
  }) {
    const pool = await this.prisma.costPool.findFirstOrThrow({
      where: { id: params.poolId, companyId: params.companyId },
    });

    const capacity = Number(params.practicalCapacity);
    if (!(capacity > 0)) {
      throw new AccountingRuleViolation(
        'ABC_Pools_Drivers — practical capacity',
        `Practical capacity must be greater than zero — a pool with no capacity has no rate to divide into.`,
        { poolId: pool.id },
      );
    }
    const ratePerUnitKobo = BigInt(Math.round(Number(params.poolCost) / capacity));

    const day = new Date(
      Date.UTC(
        params.effectiveFrom.getUTCFullYear(),
        params.effectiveFrom.getUTCMonth(),
        params.effectiveFrom.getUTCDate(),
      ),
    );
    const previousDay = new Date(day);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);

    return this.prisma.$transaction(async (tx) => {
      await tx.costPoolRate.updateMany({
        where: { poolId: pool.id, effectiveTo: null, effectiveFrom: { lt: day } },
        data: { effectiveTo: previousDay },
      });

      const created = await tx.costPoolRate.create({
        data: {
          poolId: pool.id,
          poolCostKobo: params.poolCost,
          practicalCapacity: params.practicalCapacity,
          ratePerUnitKobo,
          effectiveFrom: day,
          sourceReference: params.sourceReference ?? null,
        },
      });

      await this.audit.write(
        {
          transactionId: pool.id,
          module: 'routing',
          entityType: 'CostPoolRate',
          entityId: created.id,
          status: 'ACTIVE',
          action: AuditAction.CREATE,
          userId: params.actorId,
          comments:
            `${pool.code}: pool cost ${params.poolCost} kobo over ${params.practicalCapacity} ` +
            `capacity from ${day.toISOString().slice(0, 10)} — rate ${ratePerUnitKobo} kobo/unit.`,
          metadata: {
            poolCostKobo: String(params.poolCost),
            practicalCapacity: params.practicalCapacity,
            ratePerUnitKobo: ratePerUnitKobo.toString(),
          },
        },
        tx,
      );

      return created;
    }, TRANSACTION_OPTIONS);
  }

  /* ------------------------------------------------------------------ */
  /* Routing operations — the labour/machine side (US-897-014)           */
  /* ------------------------------------------------------------------ */

  /** One recipe version's routing, in sequence — the master data `snapshotRouting()` freezes onto an order. */
  async listRoutingOperations(companyId: string, recipeVersionId: string) {
    return this.prisma.routingOperation.findMany({
      where: { companyId, recipeVersionId, active: true },
      include: { costCentre: true, costPool: true },
      orderBy: { sequence: 'asc' },
    });
  }

  async createRoutingOperation(params: {
    companyId: string;
    recipeVersionId: string;
    costCentreId: string;
    costPoolId: string;
    operationName: string;
    resourceType: RoutingResourceType;
    setupHours?: string;
    runHoursPerUnit?: string;
    actorId: string;
  }) {
    // Ownership check on the recipe version the same way RecipeService.addComponent
    // does — a body-supplied recipeVersionId naming another company's version must
    // not be addable to just because the id happens to exist somewhere in the DB.
    await this.prisma.productRecipeVersion.findFirstOrThrow({
      where: { id: params.recipeVersionId, recipe: { companyId: params.companyId } },
      select: { id: true },
    });

    const last = await this.prisma.routingOperation.findFirst({
      where: { recipeVersionId: params.recipeVersionId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const operation = await this.prisma.routingOperation.create({
      data: {
        companyId: params.companyId,
        recipeVersionId: params.recipeVersionId,
        costCentreId: params.costCentreId,
        costPoolId: params.costPoolId,
        sequence: (last?.sequence ?? 0) + 1,
        operationName: params.operationName,
        resourceType: params.resourceType,
        setupHours: params.setupHours ?? '0',
        runHoursPerUnit: params.runHoursPerUnit ?? '0',
      },
    });

    await this.audit.write({
      transactionId: operation.id,
      module: 'routing',
      entityType: 'RoutingOperation',
      entityId: operation.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actorId,
      comments: `Added routing operation "${operation.operationName}" (${operation.resourceType}) at sequence ${operation.sequence}.`,
    });

    return operation;
  }

  /**
   * Snapshots every active routing operation for the order's recipe version
   * onto real `ProductionOrderRoutingLine` rows — frozen against later
   * routing or rate changes, the same discipline `ProductionOrderComponent`
   * already gives the packaging BOM.
   *
   * Refuses rather than guesses when an operation's cost pool has no
   * currently-effective rate — the same "recorded but unposted until an
   * account/rate exists" discipline every other resolver in this codebase
   * uses.
   */
  async snapshotRouting(productionOrderId: string, asOf: Date = new Date()) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: productionOrderId },
    });

    const existing = await this.prisma.productionOrderRoutingLine.count({
      where: { productionOrderId: order.id },
    });
    if (existing > 0) {
      return { snapshotted: false, reason: 'Routing already snapshotted for this order.' };
    }

    const operations = await this.prisma.routingOperation.findMany({
      where: { companyId: order.companyId, recipeVersionId: order.recipeVersionId, active: true },
      orderBy: { sequence: 'asc' },
      include: { costPool: true },
    });
    if (operations.length === 0) {
      return { snapshotted: false, reason: 'No routing exists for this recipe version.' };
    }

    const lines: { operationName: string; standardHours: string; standardCostKobo: string }[] = [];

    for (const op of operations) {
      const rate = await this.prisma.costPoolRate.findFirst({
        where: {
          poolId: op.costPoolId,
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!rate) {
        throw new AccountingRuleViolation(
          'ABC_Pools_Drivers — approved rate required',
          `Cost pool "${op.costPool.name}" has no effective rate as of ${asOf.toISOString().slice(0, 10)}; ` +
            `operation "${op.operationName}" cannot snapshot.`,
          { costPoolId: op.costPoolId, operationId: op.id },
        );
      }

      const standardHours =
        Number(op.setupHours) + Number(op.runHoursPerUnit) * Number(order.plannedOutputQuantity);
      const standardCostKobo = BigInt(Math.round(standardHours * Number(rate.ratePerUnitKobo)));

      await this.prisma.productionOrderRoutingLine.create({
        data: {
          productionOrderId: order.id,
          routingOperationId: op.id,
          standardHours: standardHours.toFixed(6),
          ratePerHourKobo: rate.ratePerUnitKobo,
          standardCostKobo,
        },
      });

      lines.push({
        operationName: op.operationName,
        standardHours: standardHours.toFixed(2),
        standardCostKobo: standardCostKobo.toString(),
      });
    }

    return { snapshotted: true, lines };
  }

  async listRoutingLines(productionOrderId: string) {
    return this.prisma.productionOrderRoutingLine.findMany({
      where: { productionOrderId },
      include: { routingOperation: { include: { costCentre: true, costPool: true } } },
      orderBy: { routingOperation: { sequence: 'asc' } },
    });
  }

  async listCostPools(companyId: string, asOf: Date = new Date()) {
    const pools = await this.prisma.costPool.findMany({
      where: { companyId, active: true },
      orderBy: { code: 'asc' },
    });

    return Promise.all(
      pools.map(async (pool) => {
        const rate = await this.prisma.costPoolRate.findFirst({
          where: {
            poolId: pool.id,
            effectiveFrom: { lte: asOf },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        });
        return {
          id: pool.id,
          code: pool.code,
          name: pool.name,
          driverName: pool.driverName,
          poolCostKobo: rate?.poolCostKobo.toString() ?? null,
          practicalCapacity: rate?.practicalCapacity.toString() ?? null,
          ratePerUnitKobo: rate?.ratePerUnitKobo.toString() ?? null,
          sourceReference: rate?.sourceReference ?? null,
        };
      }),
    );
  }

  /**
   * "Unused capacity cost not silently loaded into product cost" — computed
   * here, on demand, from real driver consumption, never folded into the
   * rate itself or into any order's own standard cost.
   */
  async unusedCapacity(poolId: string, asOf: Date = new Date()) {
    const rate = await this.prisma.costPoolRate.findFirst({
      where: {
        poolId,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!rate) {
      return { hasRate: false as const };
    }

    const consumed = await this.prisma.productionOrderRoutingLine.aggregate({
      where: { routingOperation: { costPoolId: poolId } },
      _sum: { standardHours: true },
    });
    const consumedHours = Number(consumed._sum.standardHours ?? 0);
    const practicalCapacity = Number(rate.practicalCapacity);
    const unusedCapacity = Math.max(0, practicalCapacity - consumedHours);
    const unusedCapacityCostKobo = BigInt(Math.round(unusedCapacity * Number(rate.ratePerUnitKobo)));

    return {
      hasRate: true as const,
      poolCostKobo: rate.poolCostKobo.toString(),
      practicalCapacity: rate.practicalCapacity.toString(),
      ratePerUnitKobo: rate.ratePerUnitKobo.toString(),
      consumedHours: consumedHours.toFixed(2),
      unusedCapacity: unusedCapacity.toFixed(2),
      unusedCapacityCostKobo: unusedCapacityCostKobo.toString(),
    };
  }
}
