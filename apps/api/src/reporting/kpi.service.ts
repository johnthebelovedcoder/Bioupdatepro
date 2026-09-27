import { Injectable } from '@nestjs/common';
import { SupplierInvoiceStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitLossService } from './profit-loss.service';
import { CustomerReceiptService } from '../sales/customer-receipt.service';
import { SupplierPaymentService } from '../procurement/supplier-payment.service';
import { currentFinancialYearId } from './current-financial-year';
import * as formula from './kpi-formulas';

export interface Kpi {
  key: string;
  label: string;
  /** Raw number as a string — a percentage already ×100, days as a decimal,
   * currency in kobo. Null when not computable. */
  value: string | null;
  /** times: a ratio such as current ratio; status: 1 ready, 0 not. */
  format: 'percent' | 'days' | 'currency' | 'times' | 'status';
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
    const [
      survivalAndMortality, grossMargin, dso, dpo, payrollCostPerHead, yieldKpi, costVarianceKpi,
      currentRatio, inventoryDays, hatch, processingYields, closeReadiness,
    ] = await Promise.all([
      this.survivalAndMortality(companyId, farmId, groupId),
      this.grossMarginPercent(companyId, farmId, financialYearId),
      this.daysSalesOutstanding(companyId),
      this.daysPayableOutstanding(companyId),
      this.payrollCostPerHead(companyId, financialYearId),
      this.yieldPercent(companyId, farmId, groupId),
      this.costVariancePercent(companyId, farmId, groupId),
      this.currentRatio(companyId),
      this.inventoryDays(companyId),
      this.hatchRates(companyId),
      this.processingYields(companyId, farmId, groupId),
      this.productionCloseReadiness(companyId, farmId),
    ]);

    return [
      ...survivalAndMortality,
      grossMargin,
      dso,
      dpo,
      payrollCostPerHead,
      yieldKpi,
      costVarianceKpi,
      currentRatio,
      inventoryDays,
      ...hatch,
      ...processingYields,
      closeReadiness,
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
        value: formula.survivalRate(alive, opening)!.mul(100).toFixed(2),
        format: 'percent',
        computable: true,
        reason: null,
      },
      {
        key: 'mortalityRate',
        label: 'Mortality rate',
        value: formula.mortalityRate(deaths, opening)!.mul(100).toFixed(2),
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

    const costOfSales = BigInt(pnl.costOfSalesKobo);
    return {
      key: 'grossMargin',
      label: 'Gross margin',
      value: formula.grossMargin(revenue.toString(), costOfSales.toString())!.mul(100).toFixed(2),
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
      value: formula.daysSalesOutstanding(outstanding.toString(), revenue.toString(), days)!.toFixed(1),
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

  /**
   * KPI-02: current assets ÷ current liabilities, from the accounts' own
   * statement category (Admin → Accounts). Categories are never defaulted —
   * a farm chooses them — so while any asset or liability account holding a
   * balance is unclassified, this says how many rather than guessing.
   */
  private async currentRatio(companyId: string): Promise<Kpi> {
    const label = 'Current ratio';
    const accounts = await this.prisma.gLAccount.findMany({
      where: { companyId, accountType: { in: ['ASSET', 'LIABILITY'] } },
      select: { id: true, accountType: true, fsCategory: true },
    });
    const sums = await this.prisma.journalLine.groupBy({
      by: ['glAccountId'],
      where: { glAccountId: { in: accounts.map((a) => a.id) }, journalEntry: { companyId, status: 'POSTED' } },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const balance = new Map(sums.map((s) => [s.glAccountId, (s._sum.debitKobo ?? 0n) - (s._sum.creditKobo ?? 0n)]));
    const carrying = accounts.filter((a) => (balance.get(a.id) ?? 0n) !== 0n);
    const unclassified = carrying.filter((a) => a.fsCategory === null);
    if (unclassified.length > 0) {
      return this.notComputable('currentRatio', label, 'times', `${unclassified.length} asset or liability account${unclassified.length === 1 ? '' : 's'} with a balance ${unclassified.length === 1 ? 'has' : 'have'} no statement category yet (current or non-current). Set them under Admin → Accounts.`);
    }
    const sumOf = (category: string, sign: bigint) => carrying.filter((a) => a.fsCategory === category).reduce((s, a) => s + sign * (balance.get(a.id) ?? 0n), 0n);
    const ratio = formula.currentRatio(sumOf('CURRENT_ASSET', 1n).toString(), sumOf('CURRENT_LIABILITY', -1n).toString());
    if (ratio === null) return this.notComputable('currentRatio', label, 'times', 'There are no current liabilities to compare current assets with.');
    return { key: 'currentRatio', label, value: ratio.toFixed(2), format: 'times', computable: true, reason: null };
  }

  /**
   * KPI-04: stock on hand (the stock ledger's value) ÷ cost of sales this
   * year × days elapsed — how many days of sales the stock would cover. This
   * year only, for the same reason as DSO: it relates stock as at today to
   * the year's cost of sales.
   */
  private async inventoryDays(companyId: string): Promise<Kpi> {
    const label = 'Inventory days';
    const year = await this.resolveYear(companyId);
    if (!year) return this.notComputable('inventoryDays', label, 'days', 'No financial year is set up for this company yet.');
    const today = new Date();
    const [pnl, movements] = await Promise.all([
      this.profitLoss.build({ companyId, financialYearId: year.id }),
      this.prisma.stockMovement.groupBy({ by: ['direction'], where: { companyId }, _sum: { valueKobo: true } }),
    ]);
    const onHand = movements.reduce((s, m) => s + (m.direction === 'IN' ? 1n : -1n) * (m._sum.valueKobo ?? 0n), 0n);
    const costOfSales = BigInt(pnl.costOfSalesKobo);
    const days = formula.inventoryDays(onHand.toString(), costOfSales.toString(), this.elapsedDays(year.startDate, today));
    if (days === null) return this.notComputable('inventoryDays', label, 'days', 'No cost of sales has been posted yet this financial year.');
    return { key: 'inventoryDays', label, value: days.toFixed(1), format: 'days', computable: true, reason: null };
  }

  /** KPI-07 (snail hatch rate) and PLY-007 (poultry hatchability): hatched ÷ eggs set, across every completed hatch. */
  private async hatchRates(companyId: string): Promise<Kpi[]> {
    const [snail, poultry] = await Promise.all([
      this.prisma.snailBreedingCycle.aggregate({ where: { companyId, hatchedCount: { not: null } }, _sum: { eggsLaid: true, hatchedCount: true } }),
      this.prisma.hatchEvent.findMany({ where: { companyId }, select: { hatchedCount: true, incubationBatch: { select: { setQuantity: true } } } }),
    ]);
    const snailRate = formula.hatchRate(snail._sum.hatchedCount ?? 0, snail._sum.eggsLaid ?? 0);
    const poultryRate = formula.hatchRate(
      poultry.reduce((s, h) => s + h.hatchedCount, 0),
      poultry.reduce((s, h) => s + h.incubationBatch.setQuantity, 0),
    );
    return [
      snailRate === null
        ? this.notComputable('snailHatchRate', 'Snail hatch rate', 'percent', 'No snail breeding cycle has hatched yet.')
        : { key: 'snailHatchRate', label: 'Snail hatch rate', value: snailRate.mul(100).toFixed(2), format: 'percent', computable: true, reason: null },
      poultryRate === null
        ? this.notComputable('poultryHatchability', 'Poultry hatchability', 'percent', 'No incubation batch has hatched yet.')
        : { key: 'poultryHatchability', label: 'Poultry hatchability', value: poultryRate.mul(100).toFixed(2), format: 'percent', computable: true, reason: null },
    ];
  }

  /**
   * KPI-10 (snail meat yield) and KPI-14 (poultry dressed yield): the main
   * output's kilograms ÷ the live kilograms that went in, across every completed
   * processing order raised from a harvest. Poultry input is what the plant
   * received where it was recorded (handbook §29), else the harvest weight.
   */
  private async processingYields(companyId: string, farmId?: string, groupId?: string): Promise<Kpi[]> {
    const orders = await this.prisma.productionOrder.findMany({
      where: { companyId, status: 'COMPLETED', harvestRecordId: { not: null }, ...(farmId ? { farmId } : {}), ...(groupId ? { sourceGroupId: groupId } : {}) },
      select: {
        processingCycle: true,
        plantReceivedWeightKg: true,
        harvestRecord: { select: { weightKg: true } },
        outputs: { where: { outputType: 'MAIN' }, select: { quantity: true } },
      },
    });
    const measure = (cycle: 'SNAILPRO' | 'POULTRYPRO', key: string, label: string): Kpi => {
      const mine = orders.filter((o) => o.processingCycle === cycle);
      const inputKg = mine.reduce((s, o) => s + Number(o.plantReceivedWeightKg ?? o.harvestRecord?.weightKg ?? 0), 0);
      const outputKg = mine.reduce((s, o) => s + o.outputs.reduce((t, out) => t + Number(out.quantity), 0), 0);
      const rate = formula.processingYield(outputKg, inputKg);
      return rate === null
        ? this.notComputable(key, label, 'percent', 'No completed processing order from a harvest yet.')
        : { key, label, value: rate.mul(100).toFixed(2), format: 'percent', computable: true, reason: null };
    };
    return [measure('SNAILPRO', 'snailMeatYield', 'Snail meat yield'), measure('POULTRYPRO', 'poultryDressedYield', 'Poultry dressed yield')];
  }

  /**
   * KPI-15: 1 when production can close, 0 while any order has been issued
   * into WIP and not settled. Settlement refuses to close an order unless its
   * WIP and recovery are exactly zero (ProductionOrderService.settle), so
   * "every issued order settled" is the workbook's WIP = 0 and recovery = 0.
   */
  private async productionCloseReadiness(companyId: string, farmId?: string): Promise<Kpi> {
    const open = await this.prisma.productionOrder.findMany({
      where: { companyId, issuedAt: { not: null }, settledAt: null, status: { not: 'CANCELLED' }, ...(farmId ? { farmId } : {}) },
      select: { orderNumber: true },
      orderBy: { orderNumber: 'asc' },
    });
    const ready = formula.closeReadiness(0, 0, open.length);
    return {
      key: 'productionCloseReadiness',
      label: 'Production close readiness',
      value: String(ready),
      format: 'status',
      computable: true,
      reason: ready ? null : `Not settled yet: ${open.slice(0, 5).map((o) => o.orderNumber).join(', ')}${open.length > 5 ? ` and ${open.length - 5} more` : ''}.`,
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
