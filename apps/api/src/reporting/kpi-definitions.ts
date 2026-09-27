/**
 * What each KPI on the KPIs page measures — numerator, denominator, formula
 * and the code that computes it (US-897-034). `formula` describes what
 * KpiService does through kpi-formulas.ts; it is not a second computation.
 *
 * Owned by the code for the same reason as report-catalogue.ts: it describes
 * the product, not a farm, and when it lived in per-company rows only the
 * demo seed wrote them.
 */
export interface KpiDefinition {
  key: string;
  label: string;
  /** The workbook's KPI_FORMULA_DEMOS ID, where it names this measure. */
  workbookId: string | null;
  numerator: string;
  denominator: string;
  formula: string;
  source: string;
  dimensions: string[];
}

const SOURCE = 'apps/api/src/reporting/kpi.service.ts';

export const KPI_DEFINITIONS: KpiDefinition[] = [
  { key: 'survivalRate', label: 'Survival rate', workbookId: 'KPI-09', numerator: 'Live population now (LivestockGroup.population)', denominator: 'Ever placed (LivestockGroup.openingPopulation)', formula: 'alive ÷ ever placed × 100', source: `KpiService.survivalAndMortality() — ${SOURCE}`, dimensions: ['farm', 'batch'] },
  { key: 'mortalityRate', label: 'Mortality rate', workbookId: 'KPI-08, KPI-12', numerator: 'Confirmed deaths (MortalityRecord.quantity) — not placed minus alive, which would count sales and transfers as deaths', denominator: 'Ever placed (LivestockGroup.openingPopulation)', formula: 'deaths ÷ ever placed × 100', source: `KpiService.survivalAndMortality() — ${SOURCE}`, dimensions: ['farm', 'batch'] },
  { key: 'yield', label: 'Yield', workbookId: null, numerator: 'Actual output quantity of every completed production order', denominator: 'Planned output quantity of the same orders', formula: 'actual output ÷ planned output × 100', source: `KpiService.yieldPercent() — ${SOURCE}`, dimensions: ['farm', 'batch'] },
  { key: 'costVariance', label: 'Cost variance', workbookId: 'KPI-05, KPI-06', numerator: 'Actual labour + overhead of every settled production order, less standard absorbed', denominator: 'Standard conversion cost absorbed by the same orders', formula: '(actual − standard) ÷ standard × 100; positive is adverse', source: `KpiService.costVariancePercent() — ${SOURCE}`, dimensions: ['farm', 'batch'] },
  { key: 'grossMargin', label: 'Gross margin', workbookId: 'KPI-01', numerator: 'Revenue less cost of sales for the financial year', denominator: 'Revenue for the same year', formula: '(revenue − cost of sales) ÷ revenue × 100', source: `KpiService.grossMarginPercent() — ${SOURCE}`, dimensions: ['farm', 'period'] },
  { key: 'dso', label: 'Days sales outstanding', workbookId: 'KPI-03', numerator: 'Receivables outstanding today', denominator: 'Revenue this financial year', formula: 'receivables ÷ revenue × days elapsed this year', source: `KpiService.daysSalesOutstanding() — ${SOURCE}`, dimensions: [] },
  { key: 'dpo', label: 'Days payable outstanding', workbookId: null, numerator: 'Payables outstanding today', denominator: 'Supplier invoices this financial year (purchases, not cost of sales)', formula: 'payables ÷ purchases × days elapsed this year', source: `KpiService.daysPayableOutstanding() — ${SOURCE}`, dimensions: [] },
  { key: 'payrollCostPerHead', label: 'Payroll cost per head', workbookId: null, numerator: 'Gross pay on the latest posted payroll run', denominator: 'That run’s headcount', formula: 'gross ÷ headcount', source: `KpiService.payrollCostPerHead() — ${SOURCE}`, dimensions: ['period'] },
  { key: 'currentRatio', label: 'Current ratio', workbookId: 'KPI-02', numerator: 'Balances of accounts classified CURRENT_ASSET', denominator: 'Balances of accounts classified CURRENT_LIABILITY', formula: 'current assets ÷ current liabilities; refused while any asset or liability account with a balance is unclassified', source: `KpiService.currentRatio() — ${SOURCE}`, dimensions: [] },
  { key: 'inventoryDays', label: 'Inventory days', workbookId: 'KPI-04', numerator: 'Stock on hand at the stock ledger’s value', denominator: 'Cost of sales this financial year', formula: 'stock ÷ cost of sales × days elapsed this year', source: `KpiService.inventoryDays() — ${SOURCE}`, dimensions: [] },
  { key: 'snailHatchRate', label: 'Snail hatch rate', workbookId: 'KPI-07', numerator: 'Snails hatched in every hatched breeding cycle', denominator: 'Eggs set in the same cycles', formula: 'hatched ÷ eggs set × 100', source: `KpiService.hatchRates() — ${SOURCE}`, dimensions: [] },
  { key: 'poultryHatchability', label: 'Poultry hatchability', workbookId: null, numerator: 'Chicks hatched from every hatched incubation batch', denominator: 'Eggs set in the same batches', formula: 'hatched ÷ eggs set × 100', source: `KpiService.hatchRates() — ${SOURCE}`, dimensions: [] },
  { key: 'snailMeatYield', label: 'Snail meat yield', workbookId: 'KPI-10', numerator: 'Main output (meat) kg of completed snail processing orders', denominator: 'Live kg harvested into them', formula: 'meat kg ÷ live kg × 100', source: `KpiService.processingYields() — ${SOURCE}`, dimensions: ['farm', 'batch'] },
  { key: 'poultryDressedYield', label: 'Poultry dressed yield', workbookId: 'KPI-14', numerator: 'Main output (dressed) kg of completed poultry processing orders', denominator: 'Live kg the plant received (else harvested)', formula: 'dressed kg ÷ live kg × 100', source: `KpiService.processingYields() — ${SOURCE}`, dimensions: ['farm', 'batch'] },
  { key: 'productionCloseReadiness', label: 'Production close readiness', workbookId: 'KPI-15', numerator: 'Production orders issued into WIP and not yet settled', denominator: '—', formula: 'Ready (1) when none is left; settlement clears WIP and recovery to zero or refuses', source: `KpiService.productionCloseReadiness() — ${SOURCE}`, dimensions: ['farm'] },
  { key: 'assetUtilisation', label: 'Asset utilisation', workbookId: null, numerator: '—', denominator: '—', formula: 'Not computable: needs usage per asset (hours run, output), which the register does not carry', source: `KpiService.build() — ${SOURCE}`, dimensions: [] },
];
