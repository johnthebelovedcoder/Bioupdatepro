import { Injectable } from '@nestjs/common';
import { SupplierInvoiceStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitLossService } from './profit-loss.service';
import { CustomerReceiptService } from '../sales/customer-receipt.service';
import { SupplierPaymentService } from '../procurement/supplier-payment.service';
import { currentFinancialYearId } from './current-financial-year';

export interface Kpi {
  key: string;
  label: string;
  /** Raw number as a string — a percentage already ×100, days as a decimal,
   * currency in kobo. Null when not computable. */
  value: string | null;
  format: 'percent' | 'days' | 'currency';
  computable: boolean;
  reason: string | null;
}

/**
 * The nine KPIs the client's user story names, each computed or explicitly
 * refused — the same "honest blank over invented number" convention already
 * used elsewhere (operations-read.service.ts's own FCR comment: a blank is
 * the honest answer to a question the data cannot answer). Asset utilisation
 * needs usage tracking per asset beyond a depreciation schedule, which the
 * fixed-asset register does not carry, so it always returns computable:false.
 * Yield and cost variance used to be in that category too — this file's own
 * comment said "production orders do not exist yet" — but they do now
 * (US-897-016–020), so both are real computations below.
 */
@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profitLoss: ProfitLossService,
    private readonly customerReceipts: CustomerReceiptService,
    private readonly supplierPayments: SupplierPaymentService,
  ) {}

  /**
   * `farmId` scopes the four production-side KPIs (survival, mortality,
   * yield, cost variance) plus gross margin to one farm — all five resolve
   * a farm dimension directly (`LivestockGroup`/`ProductionOrder` carry it,
   * and `ProfitLossService` forwards it to `journal_lines`' own embedded
   * dimension). `groupId` narrows the same four production-side KPIs
   * further, to one batch/flock (`LivestockGroup.id`) — the app's own
   * batch/flock dimension, alongside farmId rather than instead of it, so a
   * caller can ask "this one cohort" without giving up the farm scope too.
   * `financialYearId` covers the "period" dimension for gross margin and
   * payroll cost/head, both clean for any year with no "as at today" to
   * reconcile against. DSO, DPO and asset utilisation stay company-wide/
   * current-year-only: DSO/DPO relate an "as at today" ageing figure to a
   * year's revenue/purchases, which only holds together when that year IS
   * the current one (see each method's own comment), and asset utilisation
   * has no usage-tracking model to filter at all. Gross margin has no
   * batch/flock dimension — it reads P&L journal lines, which carry a farm
   * dimension but not a per-cohort one.
   */
  async build(companyId: string, farmId?: string, financialYearId?: string, groupId?: string): Promise<Kpi[]> {
    const [survivalAndMortality, grossMargin, dso, dpo, payrollCostPerHead, yieldKpi, costVarianceKpi] = await Promise.all([
      this.survivalAndMortality(companyId, farmId, groupId),
      this.grossMarginPercent(companyId, farmId, financialYearId),
      this.daysSalesOutstanding(companyId),
      this.daysPayableOutstanding(companyId),
      this.payrollCostPerHead(companyId, financialYearId),
      this.yieldPercent(companyId, farmId, groupId),
      this.costVariancePercent(companyId, farmId, groupId),
    ]);

    return [
      ...survivalAndMortality,
      grossMargin,
      dso,
      dpo,
      payrollCostPerHead,
      yieldKpi,
      costVarianceKpi,
      this.notComputable(
        'assetUtilisation',
        'Asset utilisation',
        'percent',
        'Needs usage tracking per asset beyond a depreciation schedule, which the fixed-asset register does not carry yet.',
      ),
    ];
  }

  /**
   * Actual finished-goods quantity ÷ what was planned, across every completed
   * production order (any cycle — the field means the same thing whether the
   * order is SnailPro, PoultryPro or Feed Mill). Not `expectedYieldPercent`
   * itself — that already governs US-897-018's normal-loss tolerance inside
   * a single order; this is the outcome the client's KPI story actually asks
   * for, output realised versus output planned.
   */
  private async yieldPercent(companyId: string, farmId?: string, groupId?: string): Promise<Kpi> {
    const completed = await this.prisma.productionOrder.findMany({
      where: { companyId, status: 'COMPLETED', ...(farmId ? { farmId } : {}), ...(groupId ? { sourceGroupId: groupId } : {}) },
      select: { plannedOutputQuantity: true, outputs: { select: { quantity: true } } },
    });
    if (completed.length === 0) {
      return this.notComputable(
        'yield',
        'Yield',
        'percent',
        'No completed production order exists yet to measure actual output against planned.',
      );
    }
    const planned = completed.reduce((s, o) => s + Number(o.plannedOutputQuantity), 0);
    const actual = completed.reduce((s, o) => s + o.outputs.reduce((os, out) => os + Number(out.quantity), 0), 0);
    if (planned <= 0) {
      return this.notComputable('yield', 'Yield', 'percent', 'Every completed order planned zero output.');
    }
    return {
      key: 'yield',
      label: 'Yield',
      value: ((actual / planned) * 100).toFixed(2),
      format: 'percent',
      computable: true,
      reason: null,
    };
  }

  /**
   * Actual conversion cost incurred less standard absorbed, as a percentage
   * of standard — exactly `ProductionOrderService.settle()`'s own variance
   * calculation, aggregated across every settled order instead of one at a
   * time. Positive means orders cost more than standard.
   */
  private async costVariancePercent(companyId: string, farmId?: string, groupId?: string): Promise<Kpi> {
    const settled = await this.prisma.productionOrder.findMany({
      where: {
        companyId,
        settledAt: { not: null },
        ...(farmId ? { farmId } : {}),
        ...(groupId ? { sourceGroupId: groupId } : {}),
      },
      select: { standardConversionCostKobo: true, actualLabourCostKobo: true, actualOverheadCostKobo: true },
    });
    if (settled.length === 0) {
      return this.notComputable(
        'costVariance',
        'Cost variance',
        'percent',
        'No settled production order exists yet to compare actual conversion cost against standard.',
      );
    }
    const standard = settled.reduce((s, o) => s + o.standardConversionCostKobo, 0n);
    const actual = settled.reduce((s, o) => s + o.actualLabourCostKobo + o.actualOverheadCostKobo, 0n);
    if (standard === 0n) {
      return this.notComputable('costVariance', 'Cost variance', 'percent', 'Every settled order absorbed zero standard cost.');
    }
    const variance = (Number(actual - standard) / Number(standard)) * 100;
    return {
      key: 'costVariance',
      label: 'Cost variance',
      value: variance.toFixed(2),
      format: 'percent',
      computable: true,
      reason: null,
    };
  }

  /**
   * Survival is alive ÷ ever placed; mortality is confirmed deaths (from
   * `MortalityRecord`) ÷ ever placed. Deliberately NOT `openingPopulation -
   * population` for mortality — that conflates deaths with sales, transfers
   * and disposals, a gap already flagged against US-897-004. Counting actual
   * mortality records instead is the more honest figure this data supports.
   */
  private async survivalAndMortality(companyId: string, farmId?: string, groupId?: string): Promise<Kpi[]> {
    const groupFilter = { companyId, ...(farmId ? { farmId } : {}), ...(groupId ? { id: groupId } : {}) };
    const [openingAgg, aliveAgg, deathsAgg] = await Promise.all([
      this.prisma.livestockGroup.aggregate({
        where: groupFilter,
        _sum: { openingPopulation: true },
      }),
      this.prisma.livestockGroup.aggregate({
        where: groupFilter,
        _sum: { population: true },
      }),
      this.prisma.mortalityRecord.aggregate({
        where: {
          dailyRecord: {
            companyId,
            ...(farmId ? { group: { farmId } } : {}),
            ...(groupId ? { groupId } : {}),
          },
        },
        _sum: { quantity: true },
      }),
    ]);

    const opening = openingAgg._sum.openingPopulation ?? 0;
    const alive = aliveAgg._sum.population ?? 0;
    const deaths = deathsAgg._sum.quantity ?? 0;

    if (opening === 0) {
      const reason = 'No population has ever been placed for this company.';
      return [
        this.notComputable('survivalRate', 'Survival rate', 'percent', reason),
        this.notComputable('mortalityRate', 'Mortality rate', 'percent', reason),
      ];
    }

    return [
      {
        key: 'survivalRate',
        label: 'Survival rate',
        value: ((alive / opening) * 100).toFixed(2),
        format: 'percent',
        computable: true,
        reason: null,
      },
      {
        key: 'mortalityRate',
        label: 'Mortality rate',
        value: ((deaths / opening) * 100).toFixed(2),
        format: 'percent',
        computable: true,
        reason: null,
      },
    ];
  }

  /** The year P&L itself defaults to: the one covering today, else the
   * latest — unless the caller names one explicitly, the "period" dimension
   * these KPIs otherwise always resolved to "now" regardless of what was
   * asked for. */
  private async resolveYear(companyId: string, financialYearId?: string) {
    if (financialYearId) {
      return this.prisma.financialYear.findUnique({ where: { id: financialYearId, companyId } });
    }
    const yearId = await currentFinancialYearId(this.prisma, companyId);
    return yearId
      ? this.prisma.financialYear.findUnique({ where: { id: yearId } })
      : this.prisma.financialYear.findFirst({
          where: { companyId },
          orderBy: { startDate: 'desc' },
        });
  }

  private async grossMarginPercent(companyId: string, farmId?: string, financialYearId?: string): Promise<Kpi> {
    const year = await this.resolveYear(companyId, financialYearId);
    if (!year) {
      return this.notComputable(
        'grossMargin',
        'Gross margin',
        'percent',
        'No financial year is set up for this company yet.',
      );
    }

    // ProfitLossService.build() already accepts farmId -- it forwards
    // straight through to TrialBalanceService, which resolves it as one of
    // journal_lines' own embedded dimensions.
    const pnl = await this.profitLoss.build({
      companyId,
      financialYearId: year.id,
      ...(farmId ? { farmId } : {}),
    });
    const revenue = BigInt(pnl.revenueKobo);
    if (revenue === 0n) {
      return this.notComputable(
        'grossMargin',
        'Gross margin',
        'percent',
        'No revenue has been posted yet this financial year.',
      );
    }

    const grossProfit = BigInt(pnl.grossProfitKobo);
    return {
      key: 'grossMargin',
      label: 'Gross margin',
      value: ((Number(grossProfit) / Number(revenue)) * 100).toFixed(2),
      format: 'percent',
      computable: true,
      reason: null,
    };
  }

  /** DSO = outstanding receivables ÷ revenue this year × days elapsed this year.
   * Deliberately always THIS year, not a caller-chosen one: it relates
   * receivables outstanding as at today against the year's revenue, which
   * only holds together when "the year" and "today" are the same year --
   * asking for a past year here would answer a different, misleading
   * question, not just a differently-scoped one. */
  private async daysSalesOutstanding(companyId: string): Promise<Kpi> {
    const year = await this.resolveYear(companyId);
    if (!year) {
      return this.notComputable(
        'dso',
        'Days sales outstanding',
        'days',
        'No financial year is set up for this company yet.',
      );
    }

    const today = new Date();
    const [pnl, ageing] = await Promise.all([
      this.profitLoss.build({ companyId, financialYearId: year.id }),
      this.customerReceipts.ageing({ companyId, asAt: today }),
    ]);

    const revenue = BigInt(pnl.revenueKobo);
    if (revenue === 0n) {
      return this.notComputable(
        'dso',
        'Days sales outstanding',
        'days',
        'No revenue has been posted yet this financial year to relate outstanding receivables to.',
      );
    }

    const outstanding = ageing.reduce((sum, row) => sum + BigInt(row.totalKobo), 0n);
    const days = this.elapsedDays(year.startDate, today);

    return {
      key: 'dso',
      label: 'Days sales outstanding',
      value: ((Number(outstanding) / Number(revenue)) * days).toFixed(1),
      format: 'days',
      computable: true,
      reason: null,
    };
  }

  /**
   * DPO = outstanding payables ÷ purchases this year × days elapsed.
   *
   * Measured against actual purchases (supplier invoices raised this year),
   * not cost of sales — a farm holds most of what it buys as inventory or
   * work in progress for months before any of it becomes cost of sales, so
   * that denominator understates purchases by an order of magnitude and
   * turns DPO into a meaningless four-digit number. Purchases is the
   * quantity DPO is actually supposed to measure against.
   */
  private async daysPayableOutstanding(companyId: string): Promise<Kpi> {
    const year = await this.resolveYear(companyId);
    if (!year) {
      return this.notComputable(
        'dpo',
        'Days payable outstanding',
        'days',
        'No financial year is set up for this company yet.',
      );
    }

    const today = new Date();
    const [purchases, ageing] = await Promise.all([
      this.prisma.supplierInvoice.aggregate({
        where: {
          companyId,
          status: {
            in: [
              SupplierInvoiceStatus.POSTED,
              SupplierInvoiceStatus.PART_PAID,
              SupplierInvoiceStatus.PAID,
            ],
          },
          invoiceDate: { gte: year.startDate, lte: today },
        },
        _sum: { grossAmountKobo: true },
      }),
      this.supplierPayments.ageing({ companyId, asAt: today }),
    ]);

    const totalPurchases = purchases._sum.grossAmountKobo ?? 0n;
    if (totalPurchases === 0n) {
      return this.notComputable(
        'dpo',
        'Days payable outstanding',
        'days',
        'No supplier invoice has been posted yet this financial year.',
      );
    }

    const outstanding = ageing.reduce((sum, row) => sum + BigInt(row.totalKobo), 0n);
    const days = this.elapsedDays(year.startDate, today);

    return {
      key: 'dpo',
      label: 'Days payable outstanding',
      value: ((Number(outstanding) / Number(totalPurchases)) * days).toFixed(1),
      format: 'days',
      computable: true,
      reason: null,
    };
  }

  /** Against the most recently posted run's own recorded headcount — not a
   * live employee count, since a run's cost belongs to the headcount it was
   * actually calculated against. `financialYearId`, when given, picks the
   * latest POSTED run within that year instead of across all of them --
   * unlike DSO/DPO this has no "as at today" to reconcile against, so a
   * caller-chosen year is unambiguous. */
  private async payrollCostPerHead(companyId: string, financialYearId?: string): Promise<Kpi> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { companyId, status: 'POSTED', ...(financialYearId ? { financialYearId } : {}) },
      orderBy: { payrollDate: 'desc' },
    });

    if (!run || run.employeeCount === 0) {
      return this.notComputable(
        'payrollCostPerHead',
        'Payroll cost per head',
        'currency',
        'No payroll run has been posted yet.',
      );
    }

    return {
      key: 'payrollCostPerHead',
      label: 'Payroll cost per head',
      value: (run.totalGrossKobo / BigInt(run.employeeCount)).toString(),
      format: 'currency',
      computable: true,
      reason: null,
    };
  }

  private notComputable(key: string, label: string, format: Kpi['format'], reason: string): Kpi {
    return { key, label, value: null, format, computable: false, reason };
  }

  /**
   * The transactions actually behind one KPI's number, so a reader can go
   * from "yield is 91%" to the specific orders that made it so — the same
   * discipline trial-balance drill-through already gives an account balance.
   * Scoped to the KPIs whose source rows are a real, enumerable set (the
   * four production KPIs, and payroll cost/head's own single run); the
   * others (gross margin, DSO, DPO, asset utilisation) read journal-line or
   * ageing aggregates that don't reduce to one clean row set the same way,
   * so this says so honestly rather than fabricating a partial list.
   */
  async drillThrough(
    companyId: string,
    key: string,
    farmId?: string,
    groupId?: string,
  ): Promise<{ key: string; supported: boolean; reason?: string; rows: Record<string, unknown>[] }> {
    const orderFilter = {
      companyId,
      ...(farmId ? { farmId } : {}),
      ...(groupId ? { sourceGroupId: groupId } : {}),
    };

    switch (key) {
      case 'yield': {
        const orders = await this.prisma.productionOrder.findMany({
          where: { ...orderFilter, status: 'COMPLETED' },
          select: {
            id: true, orderNumber: true, processingCycle: true,
            plannedOutputQuantity: true, outputs: { select: { quantity: true } },
          },
          orderBy: { orderNumber: 'asc' },
        });
        return {
          key,
          supported: true,
          rows: orders.map((o) => ({
            productionOrderId: o.id,
            orderNumber: o.orderNumber,
            processingCycle: o.processingCycle,
            plannedOutputQuantity: o.plannedOutputQuantity.toString(),
            actualOutputQuantity: o.outputs.reduce((s, out) => s + Number(out.quantity), 0).toString(),
          })),
        };
      }
      case 'costVariance': {
        const orders = await this.prisma.productionOrder.findMany({
          where: { ...orderFilter, settledAt: { not: null } },
          select: {
            id: true, orderNumber: true, processingCycle: true,
            standardConversionCostKobo: true, actualLabourCostKobo: true, actualOverheadCostKobo: true,
          },
          orderBy: { orderNumber: 'asc' },
        });
        return {
          key,
          supported: true,
          rows: orders.map((o) => ({
            productionOrderId: o.id,
            orderNumber: o.orderNumber,
            processingCycle: o.processingCycle,
            standardConversionCostKobo: o.standardConversionCostKobo.toString(),
            actualCostKobo: (o.actualLabourCostKobo + o.actualOverheadCostKobo).toString(),
          })),
        };
      }
      case 'survivalRate':
      case 'mortalityRate': {
        const groups = await this.prisma.livestockGroup.findMany({
          where: { companyId, ...(farmId ? { farmId } : {}), ...(groupId ? { id: groupId } : {}) },
          select: {
            id: true, code: true, speciesKey: true, openingPopulation: true, population: true,
            dailyRecords: { select: { mortality: { select: { quantity: true } } } },
          },
          orderBy: { code: 'asc' },
        });
        return {
          key,
          supported: true,
          rows: groups.map((g) => ({
            groupId: g.id,
            code: g.code,
            speciesKey: g.speciesKey,
            openingPopulation: g.openingPopulation,
            currentPopulation: g.population,
            confirmedDeaths: g.dailyRecords.reduce(
              (s, dr) => s + dr.mortality.reduce((ds, m) => ds + m.quantity, 0),
              0,
            ),
          })),
        };
      }
      case 'payrollCostPerHead': {
        const run = await this.prisma.payrollRun.findFirst({
          where: { companyId, status: 'POSTED' },
          orderBy: { payrollDate: 'desc' },
          select: { id: true, financialYearId: true, payrollDate: true, totalGrossKobo: true, employeeCount: true },
        });
        return {
          key,
          supported: true,
          rows: run
            ? [{
                payrollRunId: run.id,
                payrollDate: run.payrollDate,
                totalGrossKobo: run.totalGrossKobo.toString(),
                employeeCount: run.employeeCount,
              }]
            : [],
        };
      }
      default:
        return {
          key,
          supported: false,
          reason: `${key} reads an aggregate (journal lines or ageing) that doesn't reduce to one clean, enumerable row set — no drill-through built for it yet.`,
          rows: [],
        };
    }
  }

  private elapsedDays(start: Date, today: Date): number {
    return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86_400_000));
  }
}
