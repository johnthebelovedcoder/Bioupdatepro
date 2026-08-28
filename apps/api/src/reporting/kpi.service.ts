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
 * the honest answer to a question the data cannot answer). Three of the nine
 * — yield, cost variance, asset utilisation — need a production order or a
 * usage-tracking model that does not exist yet, so they always return
 * computable:false with the specific reason, never a guessed number.
 */
@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profitLoss: ProfitLossService,
    private readonly customerReceipts: CustomerReceiptService,
    private readonly supplierPayments: SupplierPaymentService,
  ) {}

  async build(companyId: string): Promise<Kpi[]> {
    const [survivalAndMortality, grossMargin, dso, dpo, payrollCostPerHead] = await Promise.all([
      this.survivalAndMortality(companyId),
      this.grossMarginPercent(companyId),
      this.daysSalesOutstanding(companyId),
      this.daysPayableOutstanding(companyId),
      this.payrollCostPerHead(companyId),
    ]);

    return [
      ...survivalAndMortality,
      grossMargin,
      dso,
      dpo,
      payrollCostPerHead,
      this.notComputable(
        'yield',
        'Yield',
        'percent',
        'Needs a production order with a standard yield to compare against — production orders do not exist yet.',
      ),
      this.notComputable(
        'costVariance',
        'Cost variance',
        'percent',
        'Needs a standard cost and an actual cost per production order to compare — production orders do not exist yet.',
      ),
      this.notComputable(
        'assetUtilisation',
        'Asset utilisation',
        'percent',
        'Needs usage tracking per asset beyond a depreciation schedule, which the fixed-asset register does not carry yet.',
      ),
    ];
  }

  /**
   * Survival is alive ÷ ever placed; mortality is confirmed deaths (from
   * `MortalityRecord`) ÷ ever placed. Deliberately NOT `openingPopulation -
   * population` for mortality — that conflates deaths with sales, transfers
   * and disposals, a gap already flagged against US-897-004. Counting actual
   * mortality records instead is the more honest figure this data supports.
   */
  private async survivalAndMortality(companyId: string): Promise<Kpi[]> {
    const [openingAgg, aliveAgg, deathsAgg] = await Promise.all([
      this.prisma.livestockGroup.aggregate({
        where: { companyId },
        _sum: { openingPopulation: true },
      }),
      this.prisma.livestockGroup.aggregate({
        where: { companyId },
        _sum: { population: true },
      }),
      this.prisma.mortalityRecord.aggregate({
        where: { dailyRecord: { companyId } },
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

  /** The year P&L itself defaults to: the one covering today, else the latest. */
  private async currentYear(companyId: string) {
    const yearId = await currentFinancialYearId(this.prisma, companyId);
    return yearId
      ? this.prisma.financialYear.findUnique({ where: { id: yearId } })
      : this.prisma.financialYear.findFirst({
          where: { companyId },
          orderBy: { startDate: 'desc' },
        });
  }

  private async grossMarginPercent(companyId: string): Promise<Kpi> {
    const year = await this.currentYear(companyId);
    if (!year) {
      return this.notComputable(
        'grossMargin',
        'Gross margin',
        'percent',
        'No financial year is set up for this company yet.',
      );
    }

    const pnl = await this.profitLoss.build({ companyId, financialYearId: year.id });
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

  /** DSO = outstanding receivables ÷ revenue this year × days elapsed this year. */
  private async daysSalesOutstanding(companyId: string): Promise<Kpi> {
    const year = await this.currentYear(companyId);
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
    const year = await this.currentYear(companyId);
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
   * actually calculated against. */
  private async payrollCostPerHead(companyId: string): Promise<Kpi> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { companyId, status: 'POSTED' },
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

  private elapsedDays(start: Date, today: Date): number {
    return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86_400_000));
  }
}
