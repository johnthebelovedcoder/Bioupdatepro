import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ProductionOrderCycle } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { processingYield } from '../reporting/kpi-formulas';

/**
 * Processing yield and order profitability (REPORT_KPI_CATALOG SNL-009/010,
 * PLY-010/011): every completed processing order with its mass balance —
 * live kilograms in, main output, by-products and loss — and its money:
 * standard and actual conversion, the variance, what the finished goods cost,
 * and what they are worth at the approved selling prices (the joint-cost
 * prices the order was costed from, handbook §62.5).
 *
 * Sales value, not realised revenue: sales are posted against items, not
 * orders, so what an order's output actually sold for is not matched back
 * here — the report says "at approved prices" and means it.
 */
export interface ProcessingResult {
  orderId: string;
  orderNumber: string;
  cycle: ProductionOrderCycle;
  completedOn: string | null;
  settled: boolean;
  source: string | null;
  inputKg: string | null;
  mainKg: string;
  byProductKg: string;
  lossKg: string | null;
  /** Main output ÷ input, as a percentage. */
  yieldPercent: string | null;
  standardConversionKobo: string;
  actualConversionKobo: string;
  varianceKobo: string;
  finishedGoodsCostKobo: string;
  /** Output at approved selling prices less further costs; null where an output has no approved price. */
  salesValueKobo: string | null;
  marginKobo: string | null;
}

@Injectable()
export class ProcessingResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: { companyId: string; cycle?: ProductionOrderCycle; from?: Date; to?: Date }) {
    const orders = await this.prisma.productionOrder.findMany({
      where: {
        companyId: params.companyId,
        status: 'COMPLETED',
        processingCycle: params.cycle ?? { in: ['SNAILPRO', 'POULTRYPRO'] },
        ...(params.from || params.to ? { completedAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } } : {}),
      },
      select: {
        id: true, orderNumber: true, processingCycle: true, completedAt: true, settledAt: true,
        plantReceivedWeightKg: true, standardConversionCostKobo: true, actualLabourCostKobo: true, actualOverheadCostKobo: true, finishedGoodsCostKobo: true,
        sourceGroup: { select: { code: true } },
        harvestRecord: { select: { weightKg: true } },
        outputs: { select: { itemId: true, outputType: true, quantity: true } },
      },
      orderBy: { completedAt: 'desc' },
    });

    const itemIds = [...new Set(orders.flatMap((o) => o.outputs.map((out) => out.itemId)))];
    const prices = await this.prisma.jointOutputPrice.findMany({
      where: { companyId: params.companyId, itemId: { in: itemIds }, status: 'APPROVED' },
      orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }],
      select: { itemId: true, effectiveFrom: true, sellingPricePerUnitKobo: true, furtherCostPerUnitKobo: true },
    });
    /** The price in force on the day the order completed, as costing used it. */
    const priceOn = (itemId: string, on: Date) => prices.find((p) => p.itemId === itemId && p.effectiveFrom <= on) ?? null;

    const rows: ProcessingResult[] = orders.map((o) => {
      const kg = (type: 'MAIN' | 'BY_PRODUCT') => o.outputs.filter((out) => out.outputType === type).reduce((s, out) => s.plus(out.quantity.toString()), new Decimal(0));
      const main = kg('MAIN');
      const byProduct = kg('BY_PRODUCT');
      const inputRaw = o.plantReceivedWeightKg ?? o.harvestRecord?.weightKg ?? null;
      const input = inputRaw === null ? null : new Decimal(inputRaw.toString());
      const yieldRatio = input ? processingYield(main, input) : null;
      const actual = o.actualLabourCostKobo + o.actualOverheadCostKobo;

      let salesValue: bigint | null = 0n;
      for (const out of o.outputs) {
        const price = priceOn(out.itemId, o.completedAt ?? new Date());
        if (!price || salesValue === null) {
          salesValue = null;
          continue;
        }
        salesValue += BigInt(new Decimal(out.quantity.toString()).mul((price.sellingPricePerUnitKobo - price.furtherCostPerUnitKobo).toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      }

      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        cycle: o.processingCycle,
        completedOn: o.completedAt ? o.completedAt.toISOString().slice(0, 10) : null,
        settled: o.settledAt !== null,
        source: o.sourceGroup?.code ?? null,
        inputKg: input ? input.toFixed(3) : null,
        mainKg: main.toFixed(3),
        byProductKg: byProduct.toFixed(3),
        lossKg: input ? input.minus(main).minus(byProduct).toFixed(3) : null,
        yieldPercent: yieldRatio ? yieldRatio.mul(100).toFixed(2) : null,
        standardConversionKobo: o.standardConversionCostKobo.toString(),
        actualConversionKobo: actual.toString(),
        varianceKobo: (actual - o.standardConversionCostKobo).toString(),
        finishedGoodsCostKobo: o.finishedGoodsCostKobo.toString(),
        salesValueKobo: salesValue === null ? null : salesValue.toString(),
        marginKobo: salesValue === null ? null : (salesValue - o.finishedGoodsCostKobo).toString(),
      };
    });

    const totals = (cycle: ProductionOrderCycle) => {
      const mine = rows.filter((r) => r.cycle === cycle);
      const weighed = mine.filter((r) => r.inputKg !== null);
      const input = weighed.reduce((s, r) => s.plus(r.inputKg!), new Decimal(0));
      const main = weighed.reduce((s, r) => s.plus(r.mainKg), new Decimal(0));
      const yieldRatio = processingYield(main, input);
      const sum = (key: 'standardConversionKobo' | 'actualConversionKobo' | 'varianceKobo' | 'finishedGoodsCostKobo') => mine.reduce((s, r) => s + BigInt(r[key]), 0n).toString();
      return {
        cycle,
        orders: mine.length,
        yieldPercent: yieldRatio ? yieldRatio.mul(100).toFixed(2) : null,
        standardConversionKobo: sum('standardConversionKobo'),
        actualConversionKobo: sum('actualConversionKobo'),
        varianceKobo: sum('varianceKobo'),
        finishedGoodsCostKobo: sum('finishedGoodsCostKobo'),
      };
    };

    return { rows, totals: (['SNAILPRO', 'POULTRYPRO'] as const).map(totals) };
  }
}
