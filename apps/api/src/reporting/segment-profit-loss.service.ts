import { Injectable } from '@nestjs/common';
import { assertReportFilter } from './report-filter';
import { AccountType, NormalBalance, ProductionOrderCycle } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import type { Species } from '../chart/chart';
import type { TrialBalanceFilter } from './trial-balance.service';
import { ProfitLossService } from './profit-loss.service';

/**
 * Segment profit or loss (S_CONSOLIDATED_PL, P_CONSOLIDATED_PL,
 * ENTERPRISE_CONSOLIDATED_PL, SEGMENT_ABC_CHECKS).
 *
 * For each product — snails, poultry — the farm (snailery / poultry farm), the
 * feed mill and processing are shown side by side, with the feed the mill
 * supplied to the farm shown as mill revenue and farm cost at the value it
 * left the store, then eliminated, so the consolidated column is the statutory
 * result. The enterprise statement puts the two products together with what
 * neither can claim (head office, a vehicle both use) in a Shared column —
 * shown, not spread by a key nobody chose.
 *
 * WHERE A LINE GOES. Its segment and row follow from its account, on either
 * chart (SEGMENT_ACCOUNTS). Its product follows from its account where the
 * account is one species's (410100 is snails wherever it was posted), else
 * from the pen or farm it was posted to when only one species is kept there;
 * else it is Shared.
 *
 * THE INTERNAL FEED TRANSFER. The statutory ledger has no internal sale: milled
 * feed is received into Feed Inventory and issued to a population at cost.
 * The management view measures it as the value of feed the mill made (items a
 * feed-mill production order has output) that the farm's rounds issued in the
 * period, per species. It appears as internal revenue and production cost in
 * the mill column and internal cost in the farm column; since the same feed
 * already sits inside the farm's own lines (expensed, or capitalised and then
 * sold), the farm column shows it taken back out on its own line, and the
 * eliminations remove the revenue and cost pair. Consolidated is untouched.
 */

export type ProductSegment = 'farm' | 'feedMill' | 'processing';
export type Row =
  | 'externalRevenue'
  | 'internalFeedRevenue'
  | 'fairValueGain'
  | 'cogsLive'
  | 'cogsProcessed'
  | 'internalFeedCost'
  | 'milledFeedIncluded'
  | 'feedMillProductionCost'
  | 'productionVariance'
  | 'feedMedication'
  | 'lifecycleLabourOverhead'
  | 'lossesAndOther'
  /** Below profit before tax: PCR-084, not a segment cost. */
  | 'incomeTax';

export const INCOME_ROWS: Row[] = ['externalRevenue', 'internalFeedRevenue', 'fairValueGain'];
export const EXPENSE_ROWS: Row[] = [
  'cogsLive',
  'cogsProcessed',
  'internalFeedCost',
  'milledFeedIncluded',
  'feedMillProductionCost',
  'productionVariance',
  'feedMedication',
  'lifecycleLabourOverhead',
  'lossesAndOther',
];

export const ROW_LABELS: Record<Row, string> = {
  externalRevenue: 'External revenue',
  internalFeedRevenue: 'Internal feed-transfer revenue',
  fairValueGain: 'Fair-value gain (IAS 41)',
  cogsLive: 'Cost of sales — live animals and eggs',
  cogsProcessed: 'Cost of sales — processed products',
  internalFeedCost: 'Internal feed-transfer cost',
  milledFeedIncluded: 'Less: mill feed already in the lines above',
  feedMillProductionCost: 'Feed-mill production cost',
  productionVariance: 'Production variance',
  feedMedication: 'Feed and medication',
  lifecycleLabourOverhead: 'Lifecycle labour and overhead',
  lossesAndOther: 'Losses and other expenses',
  incomeTax: 'Income tax',
};

/** Account → segment and row, on both charts. Anything unlisted: the farm's other income or expense. */
const SEGMENT_ACCOUNTS: Record<string, [ProductSegment, Row]> = {
  // Revenue
  '410100': ['farm', 'externalRevenue'],
  '410300': ['farm', 'externalRevenue'],
  '4101': ['farm', 'externalRevenue'],
  '410200': ['processing', 'externalRevenue'],
  '410400': ['processing', 'externalRevenue'],
  '420100': ['farm', 'fairValueGain'],
  '420200': ['farm', 'fairValueGain'],
  '420210': ['farm', 'fairValueGain'],
  // Cost of sales
  '510100': ['farm', 'cogsLive'],
  '510300': ['farm', 'cogsLive'],
  '5001': ['farm', 'cogsLive'],
  '510200': ['processing', 'cogsProcessed'],
  '510400': ['processing', 'cogsProcessed'],
  // Variances
  '520100': ['processing', 'productionVariance'],
  '520300': ['processing', 'productionVariance'],
  '520500': ['feedMill', 'productionVariance'],
  // Farm costs
  '611000': ['farm', 'feedMedication'],
  '613100': ['farm', 'feedMedication'],
  '613200': ['farm', 'feedMedication'],
  '612000': ['farm', 'lifecycleLabourOverhead'],
  '613000': ['farm', 'lifecycleLabourOverhead'],
  '620100': ['farm', 'lifecycleLabourOverhead'],
  '620200': ['farm', 'lifecycleLabourOverhead'],
  '620300': ['farm', 'lifecycleLabourOverhead'],
  '5101': ['farm', 'lifecycleLabourOverhead'],
  '5102': ['farm', 'lifecycleLabourOverhead'],
  '5103': ['farm', 'lifecycleLabourOverhead'],
  '5104': ['farm', 'lifecycleLabourOverhead'],
  // Processing conversion that did not settle into product cost
  '621100': ['processing', 'lossesAndOther'],
  '621200': ['processing', 'lossesAndOther'],
  '622100': ['processing', 'lossesAndOther'],
  '640400': ['processing', 'lossesAndOther'],
  '640600': ['processing', 'lossesAndOther'],
  '5205': ['processing', 'lossesAndOther'],
  // Feed mill
  '623100': ['feedMill', 'lossesAndOther'],
  '640200': ['feedMill', 'lossesAndOther'],
  // Income tax (PCR-084) — shown below profit before tax
  '650100': ['farm', 'incomeTax'],
  // Biological losses
  '640300': ['farm', 'lossesAndOther'],
  '640500': ['farm', 'lossesAndOther'],
  '5305': ['farm', 'lossesAndOther'],
};

/** Accounts that belong to one species by what they are (recommended-coa.json). */
const ACCOUNT_SPECIES: Record<string, Species> = Object.fromEntries([
  ...['410100', '410200', '420100', '510100', '510200', '520100', '611000', '612000', '621100', '621200', '640300', '640400'].map(
    (n) => [n, 'snail' as const],
  ),
  ...['410300', '410400', '420200', '420210', '510300', '510400', '520300', '613000', '613100', '613200', '622100', '640500', '640600'].map(
    (n) => [n, 'poultry' as const],
  ),
]);

type Grid = Record<ProductSegment | 'eliminations', Record<Row, bigint>>;
type Owner = Species | 'shared';

export interface Statement {
  columns: string[];
  rows: Array<{ key: Row | 'totalIncome' | 'totalExpenses' | 'profitBeforeTax' | 'profitAfterTax'; label: string; amounts: string[] }>;
}

export interface SegmentReport {
  products: Record<Species, Statement>;
  enterprise: Statement;
  /** The feed the mill supplied, per species — what the eliminations remove. */
  internalFeedKobo: Record<Species, string>;
  checks: Array<{ check: string; actual: string; expected: string; status: 'PASS' | 'FAIL'; meaning: string }>;
}

@Injectable()
export class SegmentProfitLossService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profitLoss: ProfitLossService,
  ) {}

  async build(filter: TrialBalanceFilter): Promise<SegmentReport> {
    await assertReportFilter(this.prisma, filter);
    const grids: Record<Owner, Grid> = { snail: emptyGrid(), poultry: emptyGrid(), shared: emptyGrid() };

    // --- The ledger, line by line ------------------------------------------
    const lines = await this.prisma.journalLine.groupBy({
      by: ['glAccountId', 'penHouseId', 'farmId'],
      where: {
        companyId: filter.companyId,
        ...(filter.financialPeriodId
          ? { financialPeriodId: filter.financialPeriodId }
          : filter.financialYearId
            ? { financialYearId: filter.financialYearId }
            : {}),
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        ...(filter.costCentreId ? { costCentreId: filter.costCentreId } : {}),
        ...(filter.farmId ? { farmId: filter.farmId } : {}),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        glAccount: { accountType: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
        journalEntry: { status: 'POSTED' },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const accounts = await this.prisma.gLAccount.findMany({
      where: { companyId: filter.companyId, id: { in: [...new Set(lines.map((l) => l.glAccountId))] } },
      select: { id: true, accountNumber: true, accountType: true, normalBalance: true },
    });
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const placeOf = await this.locationSpecies(filter.companyId);

    for (const line of lines) {
      const account = accountById.get(line.glAccountId)!;
      const debit = line._sum.debitKobo ?? 0n;
      const credit = line._sum.creditKobo ?? 0n;
      // Positive on the account's normal side — exactly as ProfitLossService
      // reads it, so the consolidated column ties to that statement.
      const amount = account.normalBalance === NormalBalance.CREDIT ? credit - debit : debit - credit;
      if (amount === 0n) continue;
      const [segment, row] =
        SEGMENT_ACCOUNTS[account.accountNumber] ??
        (account.accountType === AccountType.REVENUE ? (['farm', 'externalRevenue'] as const) : (['farm', 'lossesAndOther'] as const));
      const owner: Owner = ACCOUNT_SPECIES[account.accountNumber] ?? placeOf(line.penHouseId, line.farmId) ?? 'shared';
      grids[owner][segment][row] += amount;
    }

    // --- The internal feed transfer ----------------------------------------
    const internalFeed = await this.internalFeed(filter);
    for (const species of ['snail', 'poultry'] as const) {
      const x = internalFeed[species];
      if (x === 0n) continue;
      const g = grids[species];
      g.feedMill.internalFeedRevenue += x;
      g.feedMill.feedMillProductionCost += x;
      g.farm.internalFeedCost += x;
      g.farm.milledFeedIncluded -= x;
      g.eliminations.internalFeedRevenue -= x;
      g.eliminations.internalFeedCost -= x;
    }

    // --- Statements ----------------------------------------------------------
    const product = (species: Species): Statement => {
      const g = grids[species];
      const cols = [g.farm, g.feedMill, g.processing, g.eliminations];
      return statement(
        [species === 'snail' ? 'Snailery' : 'Poultry farm', 'Feed mill', 'Processing', 'Eliminations', 'Consolidated'],
        [...cols, sumRows(cols)],
      );
    };
    const consolidatedOf = (owner: Owner) => sumRows(Object.values(grids[owner]));
    const enterpriseCols = [consolidatedOf('snail'), consolidatedOf('poultry'), consolidatedOf('shared')];
    const enterprise = statement(
      ['SnailPro consolidated', 'PoultryPro consolidated', 'Shared', 'Enterprise eliminations', 'Enterprise consolidated'],
      [...enterpriseCols, zeroRows(), sumRows(enterpriseCols)],
    );

    // --- Release checks (SEGMENT_ABC_CHECKS) --------------------------------
    const statutory = await this.profitLoss.build(filter);
    const enterprisePbt = pbt(sumRows(enterpriseCols));
    const checks: SegmentReport['checks'] = [
      check('Enterprise consolidated PBT', enterprisePbt, BigInt(statutory.profitBeforeTaxKobo), 'Segment PBT ties the statutory profit and loss'),
      check(
        'Enterprise consolidated PAT',
        enterprisePbt - sumRows(enterpriseCols).incomeTax,
        BigInt(statutory.profitAfterTaxKobo),
        'Segment PAT ties the statutory profit and loss',
      ),
      ...(['snail', 'poultry'] as const).flatMap((species) => {
        const e = grids[species].eliminations;
        const label = species === 'snail' ? 'Snail' : 'Poultry';
        return [
          check(`${label} internal transfer elimination`, e.internalFeedRevenue - e.internalFeedCost, 0n, 'Internal feed revenue and cost net to zero'),
          check(
            `${label} internal feed revenue eliminated`,
            grids[species].feedMill.internalFeedRevenue + e.internalFeedRevenue,
            0n,
            'Nothing internal reaches the consolidated column',
          ),
        ];
      }),
    ];

    return {
      products: { snail: product('snail'), poultry: product('poultry') },
      enterprise,
      internalFeedKobo: { snail: internalFeed.snail.toString(), poultry: internalFeed.poultry.toString() },
      checks,
    };
  }

  /** Milled feed issued to each species's populations in the period, at issue value. */
  private async internalFeed(filter: TrialBalanceFilter): Promise<Record<Species, bigint>> {
    const window = await this.window(filter);
    const milled = await this.prisma.productionOrderOutput.findMany({
      where: { productionOrder: { companyId: filter.companyId, processingCycle: ProductionOrderCycle.FEED_MILL } },
      select: { itemId: true },
      distinct: ['itemId'],
    });
    const out: Record<Species, bigint> = { snail: 0n, poultry: 0n };
    if (milled.length === 0) return out;
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        companyId: filter.companyId,
        sourceDocumentType: 'FEED_ISSUE',
        direction: 'OUT',
        itemId: { in: milled.map((m) => m.itemId) },
        ...(window ? { movementDate: { gte: window.from, lte: window.to } } : {}),
      },
      select: { sourceDocumentId: true, valueKobo: true },
    });
    if (movements.length === 0) return out;
    const issues = await this.prisma.feedIssue.findMany({
      where: { id: { in: movements.map((m) => m.sourceDocumentId) }, dailyRecord: { companyId: filter.companyId } },
      select: { id: true, dailyRecord: { select: { group: { select: { speciesKey: true } } } } },
    });
    const speciesOf = new Map(issues.map((i) => [i.id, i.dailyRecord.group.speciesKey === 'snail' ? 'snail' : 'poultry'] as const));
    for (const m of movements) {
      const species = speciesOf.get(m.sourceDocumentId);
      if (species) out[species] += m.valueKobo;
    }
    return out;
  }

  private async window(filter: TrialBalanceFilter): Promise<{ from: Date; to: Date } | null> {
    if (filter.financialPeriodId) {
      const p = await this.prisma.financialPeriod.findFirst({
        where: { id: filter.financialPeriodId, financialYear: { companyId: filter.companyId } },
        select: { startDate: true, endDate: true },
      });
      return p ? { from: p.startDate, to: p.endDate } : null;
    }
    if (filter.financialYearId) {
      const y = await this.prisma.financialYear.findFirst({
        where: { id: filter.financialYearId, companyId: filter.companyId },
        select: { startDate: true, endDate: true },
      });
      return y ? { from: y.startDate, to: y.endDate } : null;
    }
    return null;
  }

  /** The species a pen, or failing that a farm, keeps — when it keeps only one. */
  private async locationSpecies(companyId: string) {
    const populations = await this.prisma.livestockGroup.findMany({
      where: { companyId },
      select: { penHouseId: true, farmId: true, speciesKey: true },
    });
    const pens = new Map<string, Set<Species>>();
    const farms = new Map<string, Set<Species>>();
    for (const p of populations) {
      const species: Species = p.speciesKey === 'snail' ? 'snail' : 'poultry';
      if (p.penHouseId) pens.set(p.penHouseId, (pens.get(p.penHouseId) ?? new Set()).add(species));
      farms.set(p.farmId, (farms.get(p.farmId) ?? new Set()).add(species));
    }
    const only = (set: Set<Species> | undefined) => (set?.size === 1 ? [...set][0]! : null);
    return (penHouseId: string | null, farmId: string | null): Species | null =>
      (penHouseId ? only(pens.get(penHouseId)) : null) ?? (farmId ? only(farms.get(farmId)) : null);
  }
}

const ALL_ROWS: Row[] = [...INCOME_ROWS, ...EXPENSE_ROWS, 'incomeTax'];

function zeroRows(): Record<Row, bigint> {
  return Object.fromEntries(ALL_ROWS.map((r) => [r, 0n])) as Record<Row, bigint>;
}

function emptyGrid(): Grid {
  return { farm: zeroRows(), feedMill: zeroRows(), processing: zeroRows(), eliminations: zeroRows() };
}

function sumRows(columns: Array<Record<Row, bigint>>): Record<Row, bigint> {
  const out = zeroRows();
  for (const c of columns) for (const r of ALL_ROWS) out[r] += c[r];
  return out;
}

const income = (c: Record<Row, bigint>) => INCOME_ROWS.reduce((s, r) => s + c[r], 0n);
const expenses = (c: Record<Row, bigint>) => EXPENSE_ROWS.reduce((s, r) => s + c[r], 0n);
const pbt = (c: Record<Row, bigint>) => income(c) - expenses(c);

function statement(columns: string[], values: Array<Record<Row, bigint>>): Statement {
  const show = (pick: (c: Record<Row, bigint>) => bigint) => values.map((c) => pick(c).toString());
  return {
    columns,
    rows: [
      ...INCOME_ROWS.map((r) => ({ key: r, label: ROW_LABELS[r], amounts: show((c) => c[r]) })),
      { key: 'totalIncome' as const, label: 'Total income', amounts: show(income) },
      ...EXPENSE_ROWS.map((r) => ({ key: r, label: ROW_LABELS[r], amounts: show((c) => c[r]) })),
      { key: 'totalExpenses' as const, label: 'Total expenses', amounts: show(expenses) },
      { key: 'profitBeforeTax' as const, label: 'Profit before tax', amounts: show(pbt) },
      { key: 'incomeTax' as const, label: ROW_LABELS.incomeTax, amounts: show((c) => c.incomeTax) },
      { key: 'profitAfterTax' as const, label: 'Profit after tax', amounts: show((c) => pbt(c) - c.incomeTax) },
    ],
  };
}

function check(name: string, actual: bigint, expected: bigint, meaning: string) {
  return {
    check: name,
    actual: actual.toString(),
    expected: expected.toString(),
    status: actual === expected ? ('PASS' as const) : ('FAIL' as const),
    meaning,
  };
}
