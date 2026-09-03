import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';

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
  constructor(private readonly prisma: PrismaService) {}

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
