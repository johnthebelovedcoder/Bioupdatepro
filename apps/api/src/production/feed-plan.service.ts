import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ProductionOrderCycle, ProductionOrderStatus, StockDirection } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 24 * 60 * 60 * 1000;
/** Days of feeding the daily rate is averaged over. */
const LOOKBACK_DAYS = 7;

export interface FeedPlanGroup {
  code: string;
  speciesKey: string;
  stage: string;
  population: number;
  dailyKg: string;
  /** Where the daily rate came from. */
  basis: 'RECENT_FEEDING' | 'STAGE_STANDARD';
}

export interface FeedPlanLine {
  itemId: string;
  itemCode: string;
  description: string;
  unit: string;
  dailyKg: string;
  demandKg: string;
  onHandKg: string;
  openOrdersKg: string;
  shortfallKg: string;
  /** How many days what is on hand and on order lasts at the daily rate. */
  daysCovered: string | null;
  /** The active recipe version that mills this feed, if there is one. */
  recipeVersionId: string | null;
  recipeName: string | null;
  groups: FeedPlanGroup[];
}

/**
 * Feed demand plan (handbook §40 FM-01, FR-FM-03): what the live batches will
 * eat over a horizon, against feed on hand and feed orders already open, and
 * the shortfall to mill. A batch's daily rate is what it was actually fed over
 * the last week; where it has no feeding recorded, its stage's standard grams
 * per head. Each feed is traced to the recipe that mills it so an order can
 * be raised from the plan — the plan itself posts nothing.
 */
@Injectable()
export class FeedPlanService {
  constructor(private readonly prisma: PrismaService) {}

  async plan(companyId: string, horizonDays = 14, today = new Date()): Promise<{ horizonDays: number; lines: FeedPlanLine[]; unplanned: FeedPlanGroup[] }> {
    const since = new Date(today.getTime() - LOOKBACK_DAYS * DAY);
    const groups = await this.prisma.livestockGroup.findMany({
      where: { companyId, status: 'ACTIVE', population: { gt: 0 } },
      select: { id: true, code: true, speciesKey: true, breed: true, stage: true, population: true },
      orderBy: { code: 'asc' },
    });
    const issues = await this.prisma.feedIssue.findMany({
      where: { itemId: { not: null }, dailyRecord: { companyId, groupId: { in: groups.map((g) => g.id) }, recordedOn: { gte: since, lte: today } } },
      select: { itemId: true, quantityKg: true, dailyRecord: { select: { groupId: true, recordedOn: true } } },
    });
    const lastItem = await this.prisma.feedIssue.findMany({
      where: { itemId: { not: null }, dailyRecord: { companyId, groupId: { in: groups.map((g) => g.id) } } },
      orderBy: { dailyRecord: { recordedOn: 'desc' } },
      distinct: ['dailyRecordId'],
      select: { itemId: true, dailyRecord: { select: { groupId: true } } },
      take: 2000,
    });
    const stages = await this.prisma.speciesBreedStage.findMany({
      where: { speciesBreed: { companyId, active: true } },
      select: { stageName: true, dailyFeedGramsPerHead: true, speciesBreed: { select: { speciesKey: true, name: true } } },
    });

    const byItem = new Map<string, { daily: Decimal; groups: FeedPlanGroup[] }>();
    const unplanned: FeedPlanGroup[] = [];
    for (const group of groups) {
      const mine = issues.filter((i) => i.dailyRecord.groupId === group.id);
      const days = new Set(mine.map((i) => i.dailyRecord.recordedOn.toISOString().slice(0, 10))).size;
      const itemId = mine.at(-1)?.itemId ?? lastItem.find((i) => i.dailyRecord.groupId === group.id)?.itemId ?? null;
      let daily: Decimal | null = null;
      let basis: FeedPlanGroup['basis'] = 'RECENT_FEEDING';
      if (days > 0) {
        daily = mine.reduce((s, i) => s.plus(i.quantityKg.toString()), new Decimal(0)).div(days);
      } else {
        const standard = stages.find(
          (s) => s.speciesBreed.speciesKey === group.speciesKey && s.speciesBreed.name === group.breed && s.stageName === group.stage,
        )?.dailyFeedGramsPerHead;
        if (standard) {
          daily = new Decimal(standard).mul(group.population).div(1000);
          basis = 'STAGE_STANDARD';
        }
      }
      const row: FeedPlanGroup = {
        code: group.code,
        speciesKey: group.speciesKey,
        stage: group.stage,
        population: group.population,
        dailyKg: (daily ?? new Decimal(0)).toFixed(3),
        basis,
      };
      if (!daily || !itemId) {
        unplanned.push(row);
        continue;
      }
      const entry = byItem.get(itemId) ?? { daily: new Decimal(0), groups: [] };
      entry.daily = entry.daily.plus(daily);
      entry.groups.push(row);
      byItem.set(itemId, entry);
    }

    const itemIds = [...byItem.keys()];
    const [items, movements, openOrders, recipes] = await Promise.all([
      this.prisma.item.findMany({ where: { companyId, id: { in: itemIds } }, select: { id: true, code: true, description: true, unitOfMeasure: { select: { code: true } } } }),
      this.prisma.stockMovement.groupBy({
        by: ['itemId', 'direction'],
        where: { companyId, itemId: { in: itemIds } },
        _sum: { quantity: true },
      }),
      this.prisma.productionOrder.findMany({
        where: {
          companyId,
          processingCycle: ProductionOrderCycle.FEED_MILL,
          status: { notIn: [ProductionOrderStatus.COMPLETED, ProductionOrderStatus.CANCELLED] },
          recipeVersion: { recipe: { outputItemId: { in: itemIds } } },
        },
        select: { plannedOutputQuantity: true, recipeVersion: { select: { recipe: { select: { outputItemId: true } } } } },
      }),
      this.prisma.productRecipe.findMany({
        where: { companyId, active: true, outputItemId: { in: itemIds } },
        select: { name: true, outputItemId: true, versions: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 } },
      }),
    ]);

    const lines: FeedPlanLine[] = itemIds.map((itemId) => {
      const entry = byItem.get(itemId)!;
      const item = items.find((i) => i.id === itemId);
      const qty = (direction: StockDirection) =>
        new Decimal(movements.find((m) => m.itemId === itemId && m.direction === direction)?._sum.quantity?.toString() ?? '0');
      const onHand = Decimal.max(0, qty(StockDirection.IN).minus(qty(StockDirection.OUT)));
      const onOrder = openOrders
        .filter((o) => o.recipeVersion.recipe.outputItemId === itemId)
        .reduce((s, o) => s.plus(o.plannedOutputQuantity.toString()), new Decimal(0));
      const demand = entry.daily.mul(horizonDays);
      const shortfall = Decimal.max(0, demand.minus(onHand).minus(onOrder));
      const recipe = recipes.find((r) => r.outputItemId === itemId && r.versions.length > 0) ?? null;
      return {
        itemId,
        itemCode: item?.code ?? '',
        description: item?.description ?? '',
        unit: item?.unitOfMeasure.code ?? 'kg',
        dailyKg: entry.daily.toFixed(3),
        demandKg: demand.toFixed(3),
        onHandKg: onHand.toFixed(3),
        openOrdersKg: onOrder.toFixed(3),
        shortfallKg: shortfall.toFixed(3),
        daysCovered: entry.daily.gt(0) ? onHand.plus(onOrder).div(entry.daily).toFixed(1) : null,
        recipeVersionId: recipe?.versions[0]?.id ?? null,
        recipeName: recipe?.name ?? null,
        groups: entry.groups,
      };
    });
    lines.sort((a, b) => Number(b.shortfallKg) - Number(a.shortfallKg) || a.itemCode.localeCompare(b.itemCode));
    return { horizonDays, lines, unplanned };
  }
}
