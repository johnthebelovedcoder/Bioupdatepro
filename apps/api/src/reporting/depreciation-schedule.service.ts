import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductionOrderCycle, WorkflowStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { allNumbersFor } from '../chart/chart';
import { PROCESSING_OVERHEAD } from '../fixed-assets/fixed-asset.service';

const LINE_LABEL: Record<ProductionOrderCycle, string> = {
  SNAILPRO: 'Snail processing',
  POULTRYPRO: 'Poultry processing',
  FEED_MILL: 'Feed mill',
};

export interface DepreciationScheduleRow {
  assetId: string;
  assetNumber: string;
  name: string;
  assetClass: string;
  acquisitionDate: string;
  usefulLifeMonths: number;
  processingLine: string | null;
  status: string;
  disposedOn: string | null;
  costKobo: string;
  openingAccumulatedKobo: string;
  /** The register's charge for the range (depreciation runs). */
  chargeKobo: string;
  /** Of the charge, what went to depreciation expense. */
  toProfitAndLossKobo: string;
  /** Of the charge, what each processing line absorbed (PCR-031). */
  absorbedKobo: Record<string, string>;
  /** Net book value written off to depreciation expense on disposal. */
  disposalWriteOffKobo: string;
  closingAccumulatedKobo: string;
  netBookValueKobo: string;
}

/**
 * The fixed-asset depreciation schedule (POL-010, AC-MFG-009): "FA
 * depreciation schedule = P&L depreciation + absorbed manufacturing
 * depreciation", "manufacturing share absorbed; admin share expensed".
 *
 * Per asset for a year through a period: cost, opening accumulated
 * depreciation, the register's charge, its split between depreciation
 * expense and each processing line's overhead — read from the journals that
 * were posted, not worked out again — any write-off on disposal, closing
 * accumulated depreciation and net book value. Then the checks that the
 * register and the ledger agree.
 */
@Injectable()
export class DepreciationScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async build(params: { companyId: string; financialYearId: string; throughPeriodId?: string }) {
    const year = await this.prisma.financialYear.findFirst({
      where: { id: params.financialYearId, companyId: params.companyId },
      include: { periods: { orderBy: { periodNumber: 'asc' }, select: { id: true, periodNumber: true, name: true, startDate: true, endDate: true } } },
    });
    if (!year) throw new NotFoundException('No such financial year.');
    const through = params.throughPeriodId ? year.periods.find((p) => p.id === params.throughPeriodId) : year.periods[year.periods.length - 1];
    if (!through) throw new NotFoundException('That period is not in the year.');
    const inRange = year.periods.filter((p) => p.periodNumber <= through.periodNumber);
    const rangeIds = new Set(inRange.map((p) => p.id));
    const rangeStart = inRange[0]!.startDate;
    const rangeEnd = through.endDate;

    const assets = await this.prisma.fixedAsset.findMany({
      where: { companyId: params.companyId, status: WorkflowStatus.POSTED, acquisitionDate: { lte: rangeEnd } },
      orderBy: { assetNumber: 'asc' },
    });
    const entries = await this.prisma.depreciationEntry.findMany({
      where: { run: { companyId: params.companyId, status: WorkflowStatus.POSTED }, assetId: { in: assets.map((a) => a.id) } },
      select: { assetId: true, amountKobo: true, run: { select: { financialPeriodId: true, financialPeriod: { select: { startDate: true } } } } },
    });

    // What was posted: the depreciation-run and disposal journals in the range.
    const expenseNumbers = allNumbersFor('depreciationExpense');
    const accumulatedNumbers = allNumbersFor('accumulatedDepreciation');
    const ppeNumbers = allNumbersFor('ppe');
    const lineNumbers = Object.values(PROCESSING_OVERHEAD).map((l) => l.number);
    const accounts = await this.prisma.gLAccount.findMany({
      where: { companyId: params.companyId, accountNumber: { in: [...expenseNumbers, ...accumulatedNumbers, ...ppeNumbers, ...lineNumbers] } },
      select: { id: true, accountNumber: true },
    });
    const numberOf = new Map(accounts.map((a) => [a.id, a.accountNumber]));
    const cycleOf = new Map(Object.entries(PROCESSING_OVERHEAD).map(([cycle, l]) => [l.number, cycle as ProductionOrderCycle]));
    const postedLines = await this.prisma.journalLine.findMany({
      where: {
        companyId: params.companyId,
        financialPeriodId: { in: [...rangeIds] },
        glAccountId: { in: accounts.map((a) => a.id) },
        journalEntry: { status: 'POSTED', sourceDocumentType: { in: ['DepreciationRun', 'FixedAsset'] } },
      },
      select: { glAccountId: true, debitKobo: true, creditKobo: true, description: true, journalEntry: { select: { sourceDocumentType: true } } },
    });
    // Each posted debit names its asset: "Depreciation — FA-0001 (…)" or "Disposal — FA-0001 (…)".
    const assetNumberIn = (description: string | null) => description?.match(/— ([^\s(]+)/)?.[1] ?? null;

    const rows: DepreciationScheduleRow[] = [];
    const totals = { cost: 0n, opening: 0n, charge: 0n, toPl: 0n, absorbed: {} as Record<string, bigint>, disposal: 0n, closing: 0n, nbv: 0n };
    for (const asset of assets) {
      const mine = entries.filter((e) => e.assetId === asset.id);
      const opening = mine.filter((e) => e.run.financialPeriod.startDate < rangeStart).reduce((s, e) => s + e.amountKobo, 0n);
      const charge = mine.filter((e) => rangeIds.has(e.run.financialPeriodId)).reduce((s, e) => s + e.amountKobo, 0n);
      const debits = postedLines.filter((l) => l.debitKobo > 0n && assetNumberIn(l.description) === asset.assetNumber);
      let toPl = 0n;
      let disposal = 0n;
      const absorbed: Record<string, bigint> = {};
      for (const line of debits) {
        const number = numberOf.get(line.glAccountId)!;
        if (line.journalEntry.sourceDocumentType === 'FixedAsset') {
          // Capitalisation debits the asset account; only a disposal debits expense.
          if (expenseNumbers.includes(number)) disposal += line.debitKobo;
          continue;
        }
        const cycle = cycleOf.get(number);
        if (cycle) absorbed[cycle] = (absorbed[cycle] ?? 0n) + line.debitKobo;
        else if (expenseNumbers.includes(number)) toPl += line.debitKobo;
      }
      const disposedInOrBefore = asset.disposedOn && asset.disposedOn <= rangeEnd;
      const closing = disposedInOrBefore ? 0n : opening + charge;
      const cost = disposedInOrBefore ? 0n : asset.costKobo;
      const nbv = cost - closing;

      totals.cost += cost;
      totals.opening += opening;
      totals.charge += charge;
      totals.toPl += toPl;
      totals.disposal += disposal;
      totals.closing += closing;
      totals.nbv += nbv;
      for (const [cycle, amount] of Object.entries(absorbed)) totals.absorbed[cycle] = (totals.absorbed[cycle] ?? 0n) + amount;

      rows.push({
        assetId: asset.id,
        assetNumber: asset.assetNumber,
        name: asset.name,
        assetClass: asset.assetClass,
        acquisitionDate: asset.acquisitionDate.toISOString().slice(0, 10),
        usefulLifeMonths: asset.usefulLifeMonths,
        processingLine: asset.processingCycle ? LINE_LABEL[asset.processingCycle] : null,
        status: disposedInOrBefore ? 'DISPOSED' : 'IN_SERVICE',
        disposedOn: asset.disposedOn ? asset.disposedOn.toISOString().slice(0, 10) : null,
        costKobo: asset.costKobo.toString(),
        openingAccumulatedKobo: opening.toString(),
        chargeKobo: charge.toString(),
        toProfitAndLossKobo: toPl.toString(),
        absorbedKobo: Object.fromEntries(Object.entries(absorbed).map(([k, v]) => [LINE_LABEL[k as ProductionOrderCycle], v.toString()])),
        disposalWriteOffKobo: disposal.toString(),
        closingAccumulatedKobo: closing.toString(),
        netBookValueKobo: nbv.toString(),
      });
    }

    // The ledger's own figures, for the checks.
    const periodsThrough = year.periods.filter((p) => p.periodNumber <= through.periodNumber).map((p) => p.id);
    const balances = await this.prisma.journalLine.groupBy({
      by: ['glAccountId'],
      where: {
        companyId: params.companyId,
        glAccountId: { in: accounts.map((a) => a.id) },
        journalEntry: { status: 'POSTED' },
        OR: [{ financialPeriodId: { in: periodsThrough } }, { financialPeriod: { endDate: { lt: year.startDate } } }],
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const ledger = (numbers: string[]) =>
      balances.filter((b) => numbers.includes(numberOf.get(b.glAccountId)!)).reduce((s, b) => s + (b._sum.debitKobo ?? 0n) - (b._sum.creditKobo ?? 0n), 0n);
    const ledgerPpe = ledger(ppeNumbers);
    const ledgerAccumulated = -ledger(accumulatedNumbers);
    const absorbedTotal = Object.values(totals.absorbed).reduce((s, v) => s + v, 0n);

    return {
      financialYear: year.code,
      throughPeriod: through.name,
      rows,
      totals: {
        costKobo: totals.cost.toString(),
        openingAccumulatedKobo: totals.opening.toString(),
        chargeKobo: totals.charge.toString(),
        toProfitAndLossKobo: totals.toPl.toString(),
        absorbedKobo: Object.fromEntries(Object.entries(totals.absorbed).map(([k, v]) => [LINE_LABEL[k as ProductionOrderCycle], v.toString()])),
        absorbedTotalKobo: absorbedTotal.toString(),
        disposalWriteOffKobo: totals.disposal.toString(),
        closingAccumulatedKobo: totals.closing.toString(),
        netBookValueKobo: totals.nbv.toString(),
      },
      /** Each zero when the register and the ledger agree (POL-010, AC-MFG-009). */
      checks: {
        /** The register's charge less depreciation expensed and absorbed. */
        chargeVsPostedKobo: (totals.charge - totals.toPl - absorbedTotal).toString(),
        /** The register's closing accumulated depreciation less the ledger's. */
        accumulatedVsLedgerKobo: (totals.closing - ledgerAccumulated).toString(),
        /** The register's cost of assets in service less the ledger's fixed assets. */
        costVsLedgerKobo: (totals.cost - ledgerPpe).toString(),
      },
      ledger: { ppeKobo: ledgerPpe.toString(), accumulatedDepreciationKobo: ledgerAccumulated.toString() },
    };
  }
}
