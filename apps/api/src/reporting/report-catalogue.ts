/**
 * The report and KPI catalogue — the client's REPORT_KPI_CATALOG (workbook
 * v8.9.8, 39 definitions), each tied to where it lives in this application
 * and how far it is built.
 *
 * Owned by the code, not seeded per company: what the product can report is
 * the same for every farm, and until 2026-09-27 these were rows only the demo
 * seed wrote, so a farm registered through the app opened an empty Reports
 * page. `status` is honest — BUILT answers the workbook's "use/decision
 * supported" on the screen named; PARTIAL says what is missing; NOT_BUILT has
 * no screen. test/unit/report-catalogue.spec.ts holds the list to the
 * workbook's 39 IDs and every screen to a real page.
 */
export type ReportStatus = 'BUILT' | 'PARTIAL' | 'NOT_BUILT';

export interface ReportEntry {
  /** The workbook's ID (AGR-001 …), or APP- for a report the workbook does not list. */
  id: string;
  key: string;
  module: 'AgriPro' | 'SnailPro' | 'PoultryPro';
  name: string;
  purpose: string;
  owner: string;
  frequency: string;
  webPath: string | null;
  status: ReportStatus;
  /** What is missing, for PARTIAL and NOT_BUILT. */
  gap: string | null;
  exportSupported: boolean;
  drillThroughSupported: boolean;
}

const r = (
  id: string,
  key: string,
  module: ReportEntry['module'],
  name: string,
  purpose: string,
  owner: string,
  frequency: string,
  webPath: string | null,
  status: ReportStatus,
  gap: string | null = null,
  flags: { exportSupported?: boolean; drillThroughSupported?: boolean } = {},
): ReportEntry => ({
  id, key, module, name, purpose, owner, frequency, webPath, status, gap,
  exportSupported: flags.exportSupported ?? false,
  drillThroughSupported: flags.drillThroughSupported ?? false,
});

export const REPORT_CATALOGUE: ReportEntry[] = [
  // --- AgriPro ---------------------------------------------------------------
  r('AGR-001', 'requisitions-budget', 'AgriPro', 'Purchase requisitions and budget', 'Each cost centre’s budget for the year, what orders have committed against it, and what suppliers have actually invoiced; an order that would pass its budget is refused.', 'Farm Manager', 'On demand', '/procurement/budgets', 'BUILT'),
  r('AGR-002', 'delivery-performance', 'AgriPro', 'PO/GRN delivery performance', 'Fill rate, rejections, on-time delivery and overdue orders, supplier by supplier.', 'Procurement', 'Monthly', '/procurement/delivery', 'BUILT'),
  r('AGR-003', 'three-way-match', 'AgriPro', 'Three-way match exceptions', 'Resolve differences between the order, the receipt and the invoice before paying.', 'Accounts Payable', 'Daily', '/procurement/invoices', 'BUILT'),
  r('AGR-004', 'ap-ageing', 'AgriPro', 'Supplier ageing (AP)', 'Who the farm owes, and how overdue.', 'Finance Manager', 'Weekly', '/ledger/ap-ageing', 'BUILT', null, { exportSupported: true }),
  r('AGR-005', 'bank-reconciliation', 'AgriPro', 'Payments and bank reconciliation', 'Confirm payments and the books agree with the bank.', 'Treasury', 'Monthly', '/finance/banking', 'BUILT'),
  r('AGR-006', 'inventory-position', 'AgriPro', 'Inventory position and valuation', 'What is in each store and what it is worth.', 'Store Officer', 'Daily', '/inventory', 'BUILT'),
  r('AGR-007', 'inventory-expiry', 'AgriPro', 'Inventory ageing and expiry', 'Use stock before it expires; hold what is in quarantine.', 'Store Officer', 'Weekly', '/inventory/lots', 'BUILT'),
  r('AGR-008', 'fixed-assets', 'AgriPro', 'Fixed asset register and movement', 'Assets, depreciation, impairment and transfers, asset by asset.', 'FA Accountant', 'Monthly', '/ledger/fixed-assets', 'BUILT'),
  r('AGR-009', 'payroll', 'AgriPro', 'Payroll and statutory liabilities', 'Gross to net, and what is owed to staff, PAYE, pension, NHF, NSITF and ITF.', 'Payroll', 'Monthly', '/finance/payroll/runs', 'BUILT'),
  r('AGR-010', 'ar-ageing', 'AgriPro', 'Customer ageing (AR)', 'Who owes the farm, and how overdue.', 'Finance Manager', 'Weekly', '/ledger/ar-ageing', 'BUILT', null, { exportSupported: true }),
  r('AGR-011', 'sales-margin', 'AgriPro', 'Sales, cost of sales and gross margin', 'What each product and customer sold for, what it cost from stock, and the gross margin.', 'Controller', 'Monthly', '/sales/margin', 'BUILT'),
  r('AGR-012', 'standard-variance', 'AgriPro', 'Standard vs actual variance', 'Why production cost more or less than standard: price, usage, yield, conversion.', 'Management Accountant', 'Per order', '/production/standard-costs', 'BUILT'),
  r('AGR-013', 'trial-balance', 'AgriPro', 'General ledger and trial balance', 'Every account and its balance — the source of every statement.', 'Finance Controller', 'On demand', '/ledger/trial-balance', 'BUILT', null, { exportSupported: true, drillThroughSupported: true }),
  r('AGR-014', 'profit-loss', 'AgriPro', 'Profit and loss', 'Revenue, costs, variances and profit for a period.', 'Finance Controller', 'Monthly', '/ledger/profit-loss', 'BUILT', null, { exportSupported: true }),
  r('AGR-015', 'balance-sheet', 'AgriPro', 'Balance sheet', 'What the farm owns, owes and is worth.', 'Finance Controller', 'Monthly', '/ledger/balance-sheet', 'BUILT', null, { exportSupported: true }),
  r('AGR-016', 'cash-flow', 'AgriPro', 'Cash flow statement', 'Where the cash came from and went, for a month or the year to date, by the direct and indirect methods, both ending at the bank.', 'Finance Controller', 'Monthly', '/ledger/cash-flow', 'BUILT', null, { exportSupported: true }),
  r('AGR-017', 'period-close', 'AgriPro', 'Month and year close cockpit', 'Whether every reconciliation is done before a period is locked.', 'Controller', 'Monthly', '/ledger/period-close', 'BUILT'),
  r('AGR-018', 'audit', 'AgriPro', 'Audit trail and control exceptions', 'Who did what, when, what changed, and what was refused.', 'Internal Auditor', 'On demand', '/ledger/audit', 'BUILT'),
  // --- SnailPro --------------------------------------------------------------
  r('SNL-001', 'snail-cohorts', 'SnailPro', 'Cohort and stage reconciliation', 'Snails in, out and alive, cohort by cohort, and the asset they carry.', 'Farm Manager', 'Weekly', '/m/snail/cohorts', 'BUILT'),
  r('SNL-002', 'snail-age', 'SnailPro', 'Snail age and stage review', 'Each cohort’s age, exact or estimated, and the stage it should have reached.', 'Supervisor', 'Weekly', '/m/snail/cohorts', 'BUILT'),
  r('SNL-003', 'snail-laying', 'SnailPro', 'Egg laying and incubation', 'Eggs laid by each breeder cohort and set to hatch.', 'Hatchery Supervisor', 'Weekly', '/m/snail/breeding', 'BUILT'),
  r('SNL-004', 'snail-hatch', 'SnailPro', 'Hatch performance', 'Hatched against eggs set, cycle by cycle.', 'Hatchery Supervisor', 'Per cycle', '/m/snail/breeding', 'BUILT'),
  r('SNL-005', 'snail-mortality', 'SnailPro', 'Mortality and survival', 'Deaths by cohort, cause and the stage the snails were at, with mortality and survival rates.', 'Supervisor', 'Weekly', '/farm/mortality?species=snail', 'BUILT'),
  r('SNL-006', 'snail-feed', 'SnailPro', 'Feed consumption and cost', 'Feed used by each cohort and what it cost.', 'Supervisor', 'Weekly', '/m/snail/feeding', 'BUILT'),
  r('SNL-007', 'snail-valuation', 'SnailPro', 'Biological asset valuation', 'IAS 41 values, their evidence and approval.', 'Finance Controller', 'Monthly', '/agripro/valuations', 'BUILT'),
  r('SNL-008', 'snail-readiness', 'SnailPro', 'Harvest and QA readiness', 'Which cohorts are ready to sell or process.', 'Farm Manager', 'Weekly', '/farm/readiness', 'BUILT'),
  r('SNL-009', 'snail-yield', 'SnailPro', 'Snail processing yield', 'Meat, by-products and loss against the live weight processed, order by order.', 'Production', 'Per order', '/production/results?cycle=SNAILPRO', 'BUILT'),
  r('SNL-010', 'snail-profitability', 'SnailPro', 'Snail order profitability and variance', 'Each processing order’s standard and actual conversion, variance, cost of output and its worth at approved prices; what each cohort actually earned is under Finance → Batches.', 'Management Accountant', 'Per order', '/production/results?cycle=SNAILPRO', 'BUILT'),
  // --- PoultryPro ------------------------------------------------------------
  r('PLY-001', 'poultry-flocks', 'PoultryPro', 'Flock placement and reconciliation', 'Birds in, out and alive, flock by flock.', 'Farm Manager', 'Weekly', '/m/poultry/flocks', 'BUILT'),
  r('PLY-002', 'poultry-age', 'PoultryPro', 'Poultry age and stage review', 'Each flock’s age and the stage it should have reached.', 'Supervisor', 'Weekly', '/m/poultry/flocks', 'BUILT'),
  r('PLY-003', 'poultry-fcr', 'PoultryPro', 'Feed and FCR', 'Feed used and feed per kilogram gained.', 'Farm Manager', 'Weekly', '/m/poultry/feeding', 'BUILT'),
  r('PLY-004', 'poultry-mortality', 'PoultryPro', 'Mortality and cull', 'Deaths and culls by flock, cause and stage, with mortality, cull and survival rates.', 'Supervisor', 'Daily', '/farm/mortality?species=poultry', 'BUILT'),
  r('PLY-005', 'poultry-growth', 'PoultryPro', 'Weight and growth performance', 'Weighed weight against the breed’s target for the age.', 'Farm Manager', 'Weekly', '/m/poultry/flocks', 'BUILT'),
  r('PLY-006', 'poultry-eggs', 'PoultryPro', 'Egg production and hen-day', 'Eggs collected, their grade (whole, cracked, dirty) and hen-day.', 'Layer Supervisor', 'Daily', '/m/poultry/production', 'BUILT'),
  r('PLY-007', 'poultry-hatchability', 'PoultryPro', 'Hatchability', 'Chicks hatched against eggs set, batch by batch.', 'Hatchery Manager', 'Per batch', '/farm/incubation', 'BUILT'),
  r('PLY-008', 'poultry-vaccination', 'PoultryPro', 'Vaccination and health compliance', 'The vaccination and health programme by flock: what fell due, whether it was given on time, late, not at all or stood down, with the product batch and withdrawal.', 'Vet / QA', 'Weekly', '/m/poultry/health', 'BUILT'),
  r('PLY-009', 'poultry-readiness', 'PoultryPro', 'Harvest and QA readiness', 'Which flocks are ready to sell or process, after withdrawal.', 'Farm Manager', 'Weekly', '/farm/readiness', 'BUILT'),
  r('PLY-010', 'poultry-yield', 'PoultryPro', 'Poultry processing yield', 'Dressed output, by-products and loss against the live weight the plant received.', 'Production', 'Per order', '/production/results?cycle=POULTRYPRO', 'BUILT'),
  r('PLY-011', 'poultry-profitability', 'PoultryPro', 'Flock and order profitability and variance', 'Each processing order’s standard and actual conversion, variance, cost of output and its worth at approved prices; what each flock actually earned is under Finance → Batches.', 'Management Accountant', 'Per order', '/production/results?cycle=POULTRYPRO', 'BUILT'),
  // --- Reports the workbook does not list ------------------------------------
  r('APP-001', 'kpis', 'AgriPro', 'KPIs', 'The KPI_FORMULA_DEMOS measures and the farm’s own, each computed or refused with a reason.', 'CFO', 'On demand', '/ledger/kpis', 'BUILT', null, { drillThroughSupported: true }),
  r('APP-002', 'journals', 'AgriPro', 'Journal entries', 'Every posting, whichever module raised it.', 'Internal Auditor', 'On demand', '/ledger/journals', 'BUILT'),
  r('APP-003', 'traceability', 'AgriPro', 'Traceability', 'From a sale back to the harvest, the batch, its breeders, feed and packaging.', 'QA', 'On demand', '/inventory/trace', 'BUILT'),
];

/** The workbook's own definitions (not the APP- extras). */
export const WORKBOOK_REPORTS = REPORT_CATALOGUE.filter((e) => !e.id.startsWith('APP-'));
