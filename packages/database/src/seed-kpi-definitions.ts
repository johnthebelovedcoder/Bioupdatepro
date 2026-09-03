import type { PrismaClient } from '../generated/client';

/**
 * US-897-034's governance criterion: each of the nine KPIs `KpiService`
 * computes gets one inspectable row here — numerator, denominator, a
 * human-readable formula, and which filter dimensions it currently honours.
 * `formula` describes what the code does; it is not a second computation
 * path, so it can never drift into disagreeing with the real one. Kept in
 * its own file, same reason `seed-posting-control.ts` is: reference/
 * governance data belongs beside the domain it describes, not buried inside
 * the monolithic company-bootstrap script.
 */
const KPI_DEFINITIONS = [
  {
    key: 'survivalRate',
    label: 'Survival rate',
    numerator: 'Current live population (LivestockGroup.population, summed across every group)',
    denominator: 'Ever placed (LivestockGroup.openingPopulation, summed)',
    formula: 'alive ÷ ever placed × 100',
    source: 'KpiService.survivalAndMortality() — apps/api/src/reporting/kpi.service.ts',
    dimensions: ['farm'],
  },
  {
    key: 'mortalityRate',
    label: 'Mortality rate',
    numerator:
      'Confirmed deaths (MortalityRecord.quantity, summed — not openingPopulation minus current population, which would also count sales/transfers/disposals as deaths)',
    denominator: 'Ever placed (LivestockGroup.openingPopulation, summed)',
    formula: 'confirmed deaths ÷ ever placed × 100',
    source: 'KpiService.survivalAndMortality() — apps/api/src/reporting/kpi.service.ts',
    dimensions: ['farm'],
  },
  {
    key: 'yield',
    label: 'Yield',
    numerator: "Actual finished-goods output quantity, summed across every COMPLETED production order's outputs",
    denominator: 'Planned output quantity, summed across the same orders',
    formula: 'actual output ÷ planned output × 100',
    source: 'KpiService.yieldPercent() — apps/api/src/reporting/kpi.service.ts',
    dimensions: ['farm'],
  },
  {
    key: 'costVariance',
    label: 'Cost variance',
    numerator: 'Actual labour + actual overhead cost incurred, summed across every SETTLED production order',
    denominator: 'Standard conversion cost absorbed, summed across the same orders',
    formula:
      '(actual − standard) ÷ standard × 100 — positive means orders cost more than standard; the same variance ProductionOrderService.settle() computes per order, aggregated here',
    source: 'KpiService.costVariancePercent() — apps/api/src/reporting/kpi.service.ts',
    dimensions: ['farm'],
  },
  {
    key: 'grossMargin',
    label: 'Gross margin',
    numerator: 'Gross profit (revenue − cost of sales) for the financial year',
    denominator: 'Revenue for the same financial year',
    formula: 'gross profit ÷ revenue × 100, both figures from ProfitLossService.build()',
    source: 'KpiService.grossMarginPercent() — apps/api/src/reporting/kpi.service.ts',
    dimensions: ['farm', 'period'],
  },
  {
    key: 'dso',
    label: 'Days sales outstanding',
    numerator: 'Outstanding receivables as at today (CustomerReceiptService.ageing()), × days elapsed in the financial year',
    denominator: 'Revenue for the current financial year',
    formula:
      '(outstanding receivables ÷ revenue) × days elapsed — always the CURRENT financial year, never a caller-chosen past one, since an "as at today" ageing figure only relates meaningfully to the year that contains today',
    source: 'KpiService.daysSalesOutstanding() — apps/api/src/reporting/kpi.service.ts',
    dimensions: [],
  },
  {
    key: 'dpo',
    label: 'Days payable outstanding',
    numerator: 'Outstanding payables as at today (SupplierPaymentService.ageing()), × days elapsed in the financial year',
    denominator:
      'Total supplier-invoice purchases for the current financial year (not cost of sales — a farm holds most purchases as inventory/WIP for months before any becomes cost of sales, which would understate purchases by an order of magnitude)',
    formula: '(outstanding payables ÷ purchases) × days elapsed — always the current financial year',
    source: 'KpiService.daysPayableOutstanding() — apps/api/src/reporting/kpi.service.ts',
    dimensions: [],
  },
  {
    key: 'payrollCostPerHead',
    label: 'Payroll cost per head',
    numerator: 'Total gross pay on the most recently POSTED payroll run',
    denominator:
      "That run's own recorded employee headcount (not a live employee count — a run's cost belongs to the headcount it was actually calculated against)",
    formula: 'total gross ÷ employee count, on the latest POSTED run',
    source: 'KpiService.payrollCostPerHead() — apps/api/src/reporting/kpi.service.ts',
    dimensions: ['period'],
  },
  {
    key: 'assetUtilisation',
    label: 'Asset utilisation',
    numerator: '—',
    denominator: '—',
    formula:
      'Not computable — needs usage tracking per asset (hours run, output per asset) beyond a depreciation schedule, which the fixed-asset register does not carry. Always refused honestly rather than approximated.',
    source: 'KpiService.build() — apps/api/src/reporting/kpi.service.ts',
    dimensions: [],
  },
] as const;

export async function seedKpiDefinitions(prisma: PrismaClient, companyId: string) {
  for (const def of KPI_DEFINITIONS) {
    await prisma.kpiDefinition.upsert({
      where: { companyId_key: { companyId, key: def.key } },
      update: {
        label: def.label,
        numerator: def.numerator,
        denominator: def.denominator,
        formula: def.formula,
        source: def.source,
        dimensions: [...def.dimensions],
      },
      create: {
        companyId,
        key: def.key,
        label: def.label,
        numerator: def.numerator,
        denominator: def.denominator,
        formula: def.formula,
        source: def.source,
        dimensions: [...def.dimensions],
      },
    });
  }
  console.log(`Seeded ${KPI_DEFINITIONS.length} KPI definitions.`);
  return KPI_DEFINITIONS.length;
}
