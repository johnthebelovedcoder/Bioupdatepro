/**
 * Phase 1 seed.
 *
 * Every account number and name below is taken verbatim from the SnailPro /
 * PoultryPro workbooks (Masters, GL_Journal and TB_WIP_Control sheets) or the
 * two payroll workbooks. Nothing is invented to fill gaps — where the source
 * documents are silent, the account simply is not seeded (Rule 10). The
 * remainder is configuration the client sets up.
 *
 * Cost centres follow the Consolidated Reference §1.2 example hierarchy plus
 * the SnailPro and PoultryPro codes actually used in the workbooks.
 */

import { PrismaClient, AccountType, NormalBalance, WarehouseType } from '../generated/client';
import { seedPostingControl } from './seed-posting-control';
import { seedSpecChart } from './seed-spec-coa';
import { seedBiologicalAssets } from './seed-biological-assets';
import {
  PAYROLL_EFFECTIVE_FROM,
  NIGERIA_PAYE_2026_BANDS,
  NIGERIA_PAYE_2026_CONFIG,
  NIGERIA_PAYE_2026_SOURCE,
  NIGERIA_STATUTORY_2026_CONFIG,
} from './payroll-defaults';

const prisma = new PrismaClient();

type AccountSeed = {
  number: string;
  name: string;
  type: AccountType;
  normal: NormalBalance;
  requiresCostCentre?: boolean;
  source: string;
};

const ACCOUNTS: AccountSeed[] = [
  // --- Assets -------------------------------------------------------------
  { number: '1101', name: 'Bank', type: AccountType.ASSET, normal: NormalBalance.DEBIT,
    source: 'PAYE workbook GL_Journal R8' },
  { number: '1301', name: 'Raw Material Inventory', type: AccountType.ASSET, normal: NormalBalance.DEBIT,
    source: 'SnailPro Masters E5 / TB_WIP_Control R5' },
  { number: '1302', name: 'Packaging & Consumables Inventory', type: AccountType.ASSET, normal: NormalBalance.DEBIT,
    source: 'SnailPro Masters E8-E12' },
  { number: '1305', name: 'By-product Inventory', type: AccountType.ASSET, normal: NormalBalance.DEBIT,
    source: 'SnailPro GL_Journal JRN-SN-0003 / TB_WIP_Control R6' },
  { number: '1401', name: 'Finished Goods Inventory', type: AccountType.ASSET, normal: NormalBalance.DEBIT,
    source: 'SnailPro Masters I5 / TB_WIP_Control R7' },
  // Cost centre is mandatory on WIP: every production cost must be attributable.
  // SnailPro TDD §10.5 — "Require cost centre on every production GL line."
  { number: '1501', name: 'Work in Progress', type: AccountType.ASSET, normal: NormalBalance.DEBIT,
    requiresCostCentre: true, source: 'SnailPro TB_WIP_Control R8 — the WIP control account' },
  { number: '1601', name: 'Input VAT Recoverable', type: AccountType.ASSET, normal: NormalBalance.DEBIT,
    source: 'Consolidated Reference §5 — Supplier Invoice posting' },
  { number: '1602', name: 'WHT Receivable', type: AccountType.ASSET, normal: NormalBalance.DEBIT,
    source: 'Consolidated Reference §6 — Customer Receipt posting' },

  // --- Liabilities --------------------------------------------------------
  { number: '2101', name: 'Salary Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT,
    source: 'Statutory workbook GL_Journal R9 / PAYE workbook GL_Journal R5' },
  { number: '2102', name: 'Pension Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT,
    source: 'Statutory workbook GL_Journal R10' },
  { number: '2103', name: 'NHF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT,
    source: 'Statutory workbook GL_Journal R11' },
  { number: '2104', name: 'NSITF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT,
    source: 'Statutory workbook GL_Journal R12' },
  { number: '2105', name: 'ITF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT,
    source: 'Statutory workbook GL_Journal R13' },
  { number: '2110', name: 'PAYE Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT,
    source: 'PAYE workbook GL_Journal R6' },
  { number: '2120', name: 'Output VAT Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT,
    source: 'Consolidated Reference §6 — Sales Invoice posting' },
  { number: '2130', name: 'WHT Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT,
    source: 'Consolidated Reference §5 — Supplier Payment posting' },

  // --- Equity ---------------------------------------------------------------
  // The number `YearEndService.findRetainedEarnings()` looks for first —
  // without it this company can never close a year.
  { number: '3200', name: 'Retained Earnings', type: AccountType.EQUITY, normal: NormalBalance.CREDIT,
    source: 'Consolidated Reference §9 — Year-end close' },

  // --- Revenue ------------------------------------------------------------
  { number: '4101', name: 'Revenue', type: AccountType.REVENUE, normal: NormalBalance.CREDIT,
    source: 'SnailPro Masters J5' },

  // --- Expenses -----------------------------------------------------------
  { number: '5101', name: 'Salaries and Wages', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT,
    source: 'Statutory workbook GL_Journal R5' },
  { number: '5102', name: 'Employer Pension Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT,
    source: 'Statutory workbook GL_Journal R6' },
  { number: '5103', name: 'NSITF Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT,
    source: 'Statutory workbook GL_Journal R7' },
  { number: '5104', name: 'ITF Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT,
    source: 'Statutory workbook GL_Journal R8' },
  { number: '5205', name: 'Payroll/Overhead Clearing', type: AccountType.EXPENSE, normal: NormalBalance.CREDIT,
    source: 'SnailPro GL_Journal JRN-SN-0002 / TB_WIP_Control R9' },
  { number: '5305', name: 'Production Loss Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT,
    requiresCostCentre: true, source: 'SnailPro GL_Journal JRN-SN-0004 / TB_WIP_Control R10' },
];

/** Consolidated Reference §1.2 hierarchy, then the workbook's own codes. */
const COST_CENTRES: { code: string; name: string; parent?: string }[] = [
  { code: '100', name: 'Corporate' },
  { code: '110', name: 'Finance', parent: '100' },
  { code: '120', name: 'HR', parent: '100' },
  { code: '130', name: 'Farm Operations', parent: '100' },
  { code: '131', name: 'Breeding', parent: '130' },
  { code: '132', name: 'Hatchery', parent: '130' },
  { code: '133', name: 'Growers', parent: '130' },
  { code: '134', name: 'Feed', parent: '130' },
  { code: '135', name: 'Harvest', parent: '130' },
  { code: '136', name: 'Processing', parent: '130' },
  // SnailPro workbook Masters A17-A24
  { code: 'SN-BREED', name: 'SN BREED', parent: '131' },
  { code: 'SN-HARV', name: 'SN HARV', parent: '135' },
  { code: 'SN-SLIME', name: 'SN SLIME', parent: '136' },
  { code: 'SN-MEAT', name: 'SN MEAT', parent: '136' },
  { code: 'SN-SHELL', name: 'SN SHELL', parent: '136' },
  { code: 'SN-QC', name: 'SN QC', parent: '136' },
  { code: 'SN-COLD', name: 'SN COLD', parent: '136' },
  { code: 'SN-ADMIN', name: 'SN ADMIN', parent: '100' },
  // PoultryPro workbook Masters A17-A24
  { code: 'PL-GROW', name: 'PL GROW', parent: '133' },
  { code: 'PL-SLAUGHT', name: 'PL SLAUGHT', parent: '136' },
  { code: 'PL-CUT', name: 'PL CUT', parent: '136' },
  { code: 'PL-PACK', name: 'PL PACK', parent: '136' },
  { code: 'PL-QC', name: 'PL QC', parent: '136' },
  { code: 'PL-COLD', name: 'PL COLD', parent: '136' },
  { code: 'PL-WASTE', name: 'PL WASTE', parent: '136' },
  { code: 'PL-ADMIN', name: 'PL ADMIN', parent: '100' },
];

const WAREHOUSES: { code: string; name: string; type: WarehouseType }[] = [
  { code: 'RAW-WH', name: 'Raw Material Store', type: WarehouseType.RAW_MATERIAL },
  { code: 'WIP-WH', name: 'Processing Floor', type: WarehouseType.WORK_IN_PROGRESS },
  { code: 'FG-WH', name: 'Cold/Finished Goods Store', type: WarehouseType.FINISHED_GOODS },
  { code: 'BYPROD-WH', name: 'Recovery Store', type: WarehouseType.BY_PRODUCT },
];

async function main(): Promise<void> {
  console.log('Seeding BioAssetPro core platform…');

  const ngn = await prisma.currency.upsert({
    where: { code: 'NGN' },
    update: {},
    create: { code: 'NGN', name: 'Nigerian Naira', minorUnitScale: 2 },
  });

  const company = await prisma.company.upsert({
    where: { code: 'BAP' },
    update: {},
    create: {
      code: 'BAP',
      // A farm's name, not a list of the modules it subscribes to. The old
      // value put "PoultryPro" on the screen of anyone keeping only snails.
      name: 'Kajola Farms',
      // Statutory workbook Company_Setup B6 / B8
      sector: 'Private',
      freeTradeZone: false,
      baseCurrencyId: ngn.id,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
    update: {},
    create: { companyId: company.id, code: 'MAIN', name: 'Main Processing Site' },
  });

  const departments = ['Production', 'Quality', 'Farm Operations', 'Finance', 'HR', 'Cold Room', 'Warehouse', 'Maintenance', 'Sales'];
  for (const name of departments) {
    const code = name.toUpperCase().replace(/\s+/g, '-');
    await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code } },
      update: {},
      create: { companyId: company.id, code, name },
    });
  }

  // Two passes so a child can always find its parent.
  const effectiveDate = new Date('2026-01-01');
  for (const cc of COST_CENTRES) {
    await prisma.costCentre.upsert({
      where: { companyId_code: { companyId: company.id, code: cc.code } },
      update: {},
      create: {
        companyId: company.id,
        code: cc.code,
        name: cc.name,
        branchId: branch.id,
        effectiveDate,
      },
    });
  }
  for (const cc of COST_CENTRES) {
    if (!cc.parent) continue;
    const parent = await prisma.costCentre.findUnique({
      where: { companyId_code: { companyId: company.id, code: cc.parent } },
      select: { id: true },
    });
    if (parent) {
      await prisma.costCentre.update({
        where: { companyId_code: { companyId: company.id, code: cc.code } },
        data: { parentId: parent.id },
      });
    }
  }

  const accountIds: Record<string, string> = {};
  for (const account of ACCOUNTS) {
    const created = await prisma.gLAccount.upsert({
      where: {
        companyId_accountNumber: {
          companyId: company.id,
          accountNumber: account.number,
        },
      },
      update: {},
      create: {
        companyId: company.id,
        accountNumber: account.number,
        name: account.name,
        accountType: account.type,
        normalBalance: account.normal,
        isPostingAccount: true,
        requiresCostCentre: account.requiresCostCentre ?? false,
      },
    });
    accountIds[account.number] = created.id;
  }

  const farm = await prisma.farm.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN-FARM' } },
    update: {},
    create: {
      companyId: company.id,
      branchId: branch.id,
      code: 'MAIN-FARM',
      name: 'Main Farm',
    },
  });

  await prisma.penHouse.upsert({
    where: { farmId_code: { farmId: farm.id, code: 'PEN-01' } },
    update: {},
    create: { farmId: farm.id, code: 'PEN-01', name: 'Pen 01' },
  });

  for (const wh of WAREHOUSES) {
    await prisma.warehouse.upsert({
      where: { companyId_code: { companyId: company.id, code: wh.code } },
      update: {},
      create: {
        companyId: company.id,
        branchId: branch.id,
        code: wh.code,
        name: wh.name,
        type: wh.type,
      },
    });
  }

  // Financial year 2026 — the PAYE framework's first year of effect.
  const year = await prisma.financialYear.upsert({
    where: { companyId_code: { companyId: company.id, code: 'FY2026' } },
    update: {},
    create: {
      companyId: company.id,
      code: 'FY2026',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });

  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  for (let i = 0; i < 12; i += 1) {
    const periodNumber = i + 1;
    const start = new Date(Date.UTC(2026, i, 1));
    const end = new Date(Date.UTC(2026, i + 1, 0));
    await prisma.financialPeriod.upsert({
      where: {
        financialYearId_periodNumber: {
          financialYearId: year.id,
          periodNumber,
        },
      },
      update: {},
      create: {
        financialYearId: year.id,
        periodNumber,
        name: `${months[i]} 2026`,
        startDate: start,
        endDate: end,
      },
    });
  }

  await prisma.exchangeRate.createMany({
    data: [
      {
        companyId: company.id,
        fromCurrencyId: ngn.id,
        toCurrencyId: ngn.id,
        rate: '1.00000000',
        effectiveFrom: new Date('2026-01-01'),
      },
    ],
    skipDuplicates: true,
  });

  await seedWorkflow(company.id);
  await seedTax(company.id, accountIds);
  await seedMasters(company.id, accountIds);
  await seedJournals(company.id);
  await seedPayroll(company.id);
  await seedSales(company.id, accountIds);
  await seedProcurement(company.id, accountIds);
  await seedStatutoryRates(company.id);
  await seedItemVatTreatment(company.id);
  await seedMatchTolerances(company.id);
  await seedCloseChecklist(company.id);

  /*
   * §66 posting control, and the chart it posts to.
   *
   * Order matters: the accounts must exist before the posting keys are linked
   * to them, or every key seeds unresolved and the whole table resolves
   * nothing — which is exactly what happened the first time these were run the
   * other way round.
   *
   * Both are the client's own rows rather than anything invented here. See the
   * two files for what is stated by the client and what is derived from their
   * numbering scheme.
   */
  const chart = await seedSpecChart(prisma, company.id);
  const control = await seedPostingControl(prisma, company.id);
  const bioAssets = await seedBiologicalAssets(prisma, company.id);

  console.log(
    `Seeded company ${company.code}: ${ACCOUNTS.length} accounts, ` +
      `${COST_CENTRES.length} cost centres, 12 periods.`,
  );
  console.log(
    `  §66 posting control: ${control.rules} rules, ${control.keys} keys ` +
      `(${control.linked} resolved, ${control.unresolved} awaiting a decision), ` +
      `over ${chart.created} specification accounts.`,
  );
  console.log(`  Biological assets: ${bioAssets.mapped} stage accounts mapped.`);
}


// ---------------------------------------------------------------------------
// Workflow configuration (Consolidated Reference §2)
//
// PROVISIONAL — these thresholds are the consultant's illustrative ladder, not
// the client's confirmed delegated-authority policy. They live here, in seed
// data, precisely so that correcting them is a configuration change and never a
// code change (Rule 8). Confirm the real limits with the client before go-live.
// ---------------------------------------------------------------------------

const WORKFLOW_ROLES = {
  supervisor: 'PRODUCTION_SUPERVISOR',
  farmManager: 'FARM_MANAGER',
  financeManager: 'FINANCE_MANAGER',
  controller: 'FINANCE_CONTROLLER',
  cfo: 'CFO',
  administrator: 'ADMINISTRATOR',
} as const;

/**
 * The §2 approval-limit ladder, in kobo.
 *
 *   Farm Manager        up to      ₦250,000
 *   Finance Manager     up to    ₦2,000,000
 *   Finance Controller  up to   ₦10,000,000
 *   CFO                 unlimited
 *
 * Each figure is that rung's approval ceiling: a document climbs from level 1
 * up to the first rung whose ceiling covers it. The top rung is CFO, not CEO —
 * `Posting_Control` names "CFO/Controller" and "CFO/Board authority" as the
 * threshold-holder 60+ times; "CEO" appears in the workbook only as a report
 * recipient alongside Controller/CFO, never as an approver.
 */
const APPROVAL_LADDER = [
  { level: 1, roleCode: WORKFLOW_ROLES.farmManager, name: 'Farm Manager', maxAmountKobo: 250_000_00n },
  { level: 2, roleCode: WORKFLOW_ROLES.financeManager, name: 'Finance Manager', maxAmountKobo: 2_000_000_00n },
  { level: 3, roleCode: WORKFLOW_ROLES.controller, name: 'Finance Controller', maxAmountKobo: 10_000_000_00n },
  { level: 4, roleCode: WORKFLOW_ROLES.cfo, name: 'CFO', maxAmountKobo: null },
];

/**
 * Transaction types in scope for §2. Every one routes through the shared
 * engine; none of them implements its own approvals.
 *
 * Two things about this list are load-bearing, and both were wrong until a
 * goods receipt was attempted end to end.
 *
 * **A type absent from this list cannot be submitted at all.** Routing refuses
 * to resolve a definition it cannot find — deliberately, since a transaction
 * type with no route must not bypass approval — so the service, its handler
 * and its tests can all be correct while the feature is unreachable. That is
 * exactly what had happened to GOODS_RECEIPT: receiving stock is the moment
 * `Dr Inventory / Cr GRNI` fires, and there was no route for it to travel.
 *
 * **`autoPost` must mirror handler registration.** True means the engine calls
 * the registered posting handler at final approval; the types marked true are
 * the ones with a handler, verified against `readonly transactionType` in the
 * handler classes. True with no handler throws at approval. False with a
 * handler is worse and quieter: the document reaches APPROVED, no journal is
 * written, and nothing says so.
 */
const WORKFLOW_TYPES: Array<{ type: string; name: string; autoPost: boolean }> = [
  // Journals. Every journal type carries `workflowTransactionType:
  // 'MANUAL_JOURNAL'`, so that is the route that has to exist.
  { type: 'MANUAL_JOURNAL', name: 'Manual Journal', autoPost: true },
  { type: 'GL_JOURNAL', name: 'General Ledger Journal', autoPost: true },
  { type: 'CUSTOMER_ADJUSTMENT', name: 'Customer Adjustment Journal', autoPost: true },
  { type: 'SUPPLIER_ADJUSTMENT', name: 'Supplier Adjustment Journal', autoPost: true },
  { type: 'JOURNAL_REVERSAL', name: 'Journal Reversal', autoPost: true },

  // Procure-to-pay. Requisition and order commit money but post nothing; the
  // ledger first hears about a purchase when the goods arrive.
  { type: 'PURCHASE_REQUISITION', name: 'Purchase Requisition', autoPost: false },
  { type: 'PURCHASE_ORDER', name: 'Purchase Order', autoPost: false },
  { type: 'GOODS_RECEIPT', name: 'Goods Receipt', autoPost: true },
  { type: 'SUPPLIER_INVOICE', name: 'Supplier Invoice', autoPost: true },
  {
    type: 'SUPPLIER_INVOICE_EXCEPTION',
    name: 'Supplier Invoice — match exception',
    autoPost: true,
  },
  { type: 'SUPPLIER_PAYMENT', name: 'Supplier Payment', autoPost: true },

  // Order-to-cash.
  { type: 'SALES_QUOTATION', name: 'Sales Quotation', autoPost: false },
  { type: 'SALES_ORDER', name: 'Sales Order', autoPost: false },
  {
    type: 'SALES_ORDER_CREDIT_OVERRIDE',
    name: 'Sales Order — credit override',
    autoPost: false,
  },
  { type: 'GOODS_ISSUE', name: 'Goods Issue', autoPost: true },
  { type: 'SALES_INVOICE', name: 'Sales Invoice', autoPost: true },
  { type: 'CUSTOMER_RECEIPT', name: 'Customer Receipt', autoPost: true },
  { type: 'CREDIT_NOTE', name: 'Credit Note', autoPost: true },

  // Inventory and production.
  { type: 'INVENTORY_ADJUSTMENT', name: 'Inventory Adjustment', autoPost: false },
  { type: 'PRODUCTION_ORDER', name: 'Production Order', autoPost: false },
  { type: 'MATERIAL_ISSUE', name: 'Material Issue', autoPost: false },

  // Biological assets (§43, §61, §67).
  { type: 'BA_VALUATION', name: 'Biological Asset Valuation', autoPost: true },

  // Payroll and period control.
  { type: 'PAYROLL_RUN', name: 'Payroll Processing', autoPost: true },
  { type: 'PERIOD_CLOSE', name: 'Period Close', autoPost: false },
  { type: 'PERIOD_REOPEN', name: 'Period Reopen', autoPost: false },
];

async function seedWorkflow(companyId: string) {
  for (const spec of WORKFLOW_TYPES) {
    const existing = await prisma.workflowDefinition.findFirst({
      where: { companyId, transactionType: spec.type, branchId: null, farmId: null },
    });

    const definition =
      existing ??
      (await prisma.workflowDefinition.create({
        data: {
          companyId,
          transactionType: spec.type,
          name: `${spec.name} — standard approval`,
          description:
            'Company-wide default route. Add a narrower definition to give a ' +
            'branch, farm or cost centre its own ladder.',
          autoPostOnApproval: spec.autoPost,
          effectiveFrom: new Date('2026-01-01'),
        },
      }));

    for (const rung of APPROVAL_LADDER) {
      await prisma.workflowStep.upsert({
        where: {
          definitionId_level: { definitionId: definition.id, level: rung.level },
        },
        update: {
          roleCode: rung.roleCode,
          name: rung.name,
          maxAmountKobo: rung.maxAmountKobo,
        },
        create: {
          definitionId: definition.id,
          level: rung.level,
          roleCode: rung.roleCode,
          name: rung.name,
          maxAmountKobo: rung.maxAmountKobo,
        },
      });
    }
  }

  // §2 escalation: 24h reminder, 48h manager notification, 72h escalation.
  //
  // Found-then-created rather than upserted: the unique key includes a nullable
  // transactionType, and Postgres treats NULLs as distinct, so an upsert on
  // (companyId, null) is not a lookup the database can satisfy.
  const existingEscalation = await prisma.workflowEscalationRule.findFirst({
    where: { companyId, transactionType: null },
  });
  if (!existingEscalation) {
    await prisma.workflowEscalationRule.create({
      data: {
        companyId,
        transactionType: null,
        remindAfterHours: 24,
        notifyManagerAfterHours: 48,
        escalateAfterHours: 72,
      },
    });
  }

  console.log(
    `Seeded workflow: ${WORKFLOW_TYPES.length} transaction types, ` +
      `${APPROVAL_LADDER.length}-level ladder, escalation 24/48/72h.`,
  );
}


// ---------------------------------------------------------------------------
// Tax configuration (Consolidated Reference §4)
//
// WHAT IS SOURCED AND WHAT IS NOT — read this before changing anything here.
//
// VAT at 7.5% IS in the source documents: both the SnailPro and PoultryPro
// workbooks carry it on their Assumptions sheet, marked "configurable;
// effective-dated tax code". It is seeded with that provenance.
//
// WHT RATES ARE NOT. The reference names a "WHT Category" on the supplier and
// customer masters and shows WHT Payable and WHT Receivable in the postings,
// but no document in this set states a single rate. Nigerian withholding rates
// are set by statute and vary by service, by contract type and by whether the
// counterparty is resident — exactly the kind of legally sensitive figure the
// build brief says not to invent.
//
// So the WHT CODES are seeded and their RATES are not. The engine refuses to
// calculate a tax whose rate is unconfigured rather than defaulting to zero,
// which means an unrated WHT category fails loudly at the first payment instead
// of quietly under-deducting for a year. Supply the rates, with their statutory
// source, and the engine starts working — no code change.
// ---------------------------------------------------------------------------

async function seedTax(companyId: string, accounts: Record<string, string>) {
  const from = new Date('2026-01-01');

  // --- Company tax policy --------------------------------------------------
  const existingConfig = await prisma.taxConfiguration.findFirst({
    where: { companyId, effectiveTo: null },
  });
  if (!existingConfig) {
    await prisma.taxConfiguration.create({
      data: {
        companyId,
        rounding: 'HALF_UP',
        // PROVISIONAL. The source documents never state whether withholding is
        // computed before or after VAT. NET_OF_VAT is the common Nigerian
        // practice, but "common practice" is not authority — confirm with the
        // client's tax adviser and correct this row if it is wrong.
        whtBasis: 'NET_OF_VAT',
        whtBasisAuthority:
          'PROVISIONAL — not stated in any source document. Confirm with the client tax adviser.',
        vatFilingIntervalMonths: 1,
        vatFilingDueDayOfMonth: 21,
        effectiveFrom: from,
      },
    });
  }

  // --- VAT codes -----------------------------------------------------------
  const VAT_CODES = [
    {
      code: 'VAT-STD',
      name: 'VAT standard rated',
      treatment: 'STANDARD' as const,
      recoverable: true,
      rate: '0.07500000',
      source: 'SnailPro & PoultryPro workbooks, Assumptions B5 (7.5%)',
    },
    {
      code: 'VAT-ZERO',
      name: 'VAT zero rated',
      treatment: 'ZERO_RATED' as const,
      recoverable: true,
      rate: '0.00000000',
      source: 'Zero-rated supplies: no output tax, input tax recoverable',
    },
    {
      code: 'VAT-EXEMPT',
      name: 'VAT exempt',
      treatment: 'EXEMPT' as const,
      // The distinction that matters: exempt supplies carry no output tax AND
      // no input recovery. Many basic agricultural products are exempt in
      // Nigeria — which of this client's products qualify is a question for
      // their tax adviser, not an assumption to encode here.
      recoverable: false,
      rate: '0.00000000',
      source: 'Exempt supplies: no output tax, input tax NOT recoverable',
    },
    {
      code: 'VAT-OOS',
      name: 'Outside the scope of VAT',
      treatment: 'OUT_OF_SCOPE' as const,
      recoverable: false,
      rate: '0.00000000',
      source: 'Non-supply transactions (e.g. payroll, internal transfers)',
    },
  ];

  for (const spec of VAT_CODES) {
    const code = await prisma.taxCode.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: {
        companyId,
        code: spec.code,
        name: spec.name,
        taxType: 'VAT',
        treatment: spec.treatment,
        priceBasis: 'EXCLUSIVE',
        recoverable: spec.recoverable,
      },
    });

    const hasRate = await prisma.taxRate.findFirst({ where: { taxCodeId: code.id } });
    if (!hasRate) {
      await prisma.taxRate.create({
        data: {
          taxCodeId: code.id,
          rate: spec.rate,
          effectiveFrom: from,
          sourceReference: spec.source,
        },
      });
    }

    for (const direction of ['INPUT', 'OUTPUT']) {
      const glAccountId =
        direction === 'INPUT' ? accounts['1601'] : accounts['2120'];
      if (!glAccountId) continue;

      const mapped = await prisma.taxGLMapping.findFirst({
        where: { companyId, taxCodeId: code.id, direction },
      });
      if (!mapped) {
        await prisma.taxGLMapping.create({
          data: { companyId, taxCodeId: code.id, direction, glAccountId, effectiveFrom: from },
        });
      }
    }
  }

  // --- WHT codes (rates deliberately absent) -------------------------------
  const WHT_CATEGORIES = [
    { code: 'WHT-CONTRACT', name: 'WHT — contracts and supplies', category: 'Contracts/Supplies' },
    { code: 'WHT-SERVICES', name: 'WHT — professional services', category: 'Professional Services' },
    { code: 'WHT-RENT', name: 'WHT — rent', category: 'Rent' },
    { code: 'WHT-COMMISSION', name: 'WHT — commission', category: 'Commission' },
    { code: 'WHT-DIVIDEND', name: 'WHT — dividends', category: 'Dividends' },
    { code: 'WHT-INTEREST', name: 'WHT — interest', category: 'Interest' },
    { code: 'WHT-ROYALTY', name: 'WHT — royalties', category: 'Royalties' },
  ];

  for (const spec of WHT_CATEGORIES) {
    const code = await prisma.taxCode.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: {
        companyId,
        code: spec.code,
        name: spec.name,
        taxType: 'WHT',
        treatment: 'STANDARD',
        whtCategory: spec.category,
      },
    });

    for (const direction of ['PAYABLE', 'RECEIVABLE']) {
      const glAccountId =
        direction === 'PAYABLE' ? accounts['2130'] : accounts['1602'];
      if (!glAccountId) continue;

      const mapped = await prisma.taxGLMapping.findFirst({
        where: { companyId, taxCodeId: code.id, direction },
      });
      if (!mapped) {
        await prisma.taxGLMapping.create({
          data: { companyId, taxCodeId: code.id, direction, glAccountId, effectiveFrom: from },
        });
      }
    }
    // NOTE: no prisma.taxRate.create() here, on purpose. See the header.
  }

  // --- Filing calendar -----------------------------------------------------
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  for (const taxType of ['VAT', 'WHT'] as const) {
    for (let index = 0; index < 12; index += 1) {
      const periodNumber = index + 1;
      const existing = await prisma.taxPeriod.findUnique({
        where: {
          companyId_taxType_year_periodNumber: {
            companyId, taxType, year: 2026, periodNumber,
          },
        },
      });
      if (existing) continue;

      await prisma.taxPeriod.create({
        data: {
          companyId,
          taxType,
          year: 2026,
          periodNumber,
          name: `${MONTH_NAMES[index]} 2026`,
          startDate: new Date(Date.UTC(2026, index, 1)),
          endDate: new Date(Date.UTC(2026, index + 1, 0)),
          // Nigerian VAT is due on the 21st of the following month.
          dueDate: new Date(Date.UTC(2026, index + 1, 21)),
        },
      });
    }
  }

  console.log(
    `Seeded tax: ${VAT_CODES.length} VAT codes (7.5% standard), ` +
      `${WHT_CATEGORIES.length} WHT categories WITHOUT rates — supply them before ` +
      `any withholding is calculated — and 24 filing periods.`,
  );
}


// ---------------------------------------------------------------------------
// Master data (Consolidated Reference §5, §6, §7, §10)
//
// Items, costs and recipes are taken verbatim from the SnailPro and PoultryPro
// workbooks' Masters and BOM sheets. Nothing is invented: where the workbooks
// are silent — supplier names, customer names, employee personal data — nothing
// is seeded at all, because plausible-looking fake master data is worse than
// none. The integration suite proves the seeded slime recipe reproduces the
// workbook's ₦195,500 material cost for PO-SN-001.
// ---------------------------------------------------------------------------

async function seedMasters(companyId: string, accounts: Record<string, string>) {
  const from = new Date('2026-01-01');

  // --- Payment terms -------------------------------------------------------
  for (const spec of [
    { code: 'IMMEDIATE', name: 'Due immediately', netDays: 0 },
    { code: 'NET14', name: 'Net 14 days', netDays: 14 },
    { code: 'NET30', name: 'Net 30 days', netDays: 30 },
    { code: 'NET60', name: 'Net 60 days', netDays: 60 },
  ]) {
    await prisma.paymentTerm.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: { companyId, ...spec },
    });
  }

  // --- Units of measure ----------------------------------------------------
  // The workbooks use exactly these: Unit, L, Kg (BOM sheet column C).
  const uomIds: Record<string, string> = {};
  for (const spec of [
    { code: 'Unit', name: 'Unit', precision: 0 },
    { code: 'L', name: 'Litre', precision: 3 },
    { code: 'Kg', name: 'Kilogramme', precision: 3 },
  ]) {
    const uom = await prisma.unitOfMeasure.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: { companyId, ...spec },
    });
    uomIds[spec.code] = uom.id;
  }

  // --- Salary components (§7 Payroll Setup) --------------------------------
  // Every §7 earning and deduction is a row. The pensionable flags follow the
  // statutory workbook exactly: the pension base is Basic + Housing +
  // Transport, NOT gross — and the NHF base is Basic ALONE
  // (`NG_PAYE_2026!K5` = `Basic x rate`, not gross and not the pension base).
  const SALARY_COMPONENTS = [
    { code: 'BASIC', name: 'Basic', type: 'EARNING', taxable: true, pensionable: true, nhfBase: true },
    { code: 'HOUSING', name: 'Housing', type: 'EARNING', taxable: true, pensionable: true, nhfBase: false },
    { code: 'TRANSPORT', name: 'Transport', type: 'EARNING', taxable: true, pensionable: true, nhfBase: false },
    { code: 'UTILITY', name: 'Utility', type: 'EARNING', taxable: true, pensionable: false, nhfBase: false },
    { code: 'MEAL', name: 'Meal', type: 'EARNING', taxable: true, pensionable: false, nhfBase: false },
    { code: 'RESPONSIBILITY', name: 'Responsibility', type: 'EARNING', taxable: true, pensionable: false, nhfBase: false },
    { code: 'LEAVE', name: 'Leave allowance', type: 'EARNING', taxable: true, pensionable: false, nhfBase: false },
    { code: 'BONUS', name: 'Bonus', type: 'EARNING', taxable: true, pensionable: false, nhfBase: false },
    { code: 'OVERTIME', name: 'Overtime', type: 'EARNING', taxable: true, pensionable: false, nhfBase: false },
    { code: 'COMMISSION', name: 'Commission', type: 'EARNING', taxable: true, pensionable: false, nhfBase: false },
  ] as const;

  for (const spec of SALARY_COMPONENTS) {
    await prisma.salaryComponent.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: {
        companyId,
        code: spec.code,
        name: spec.name,
        type: spec.type,
        isTaxable: spec.taxable,
        isPensionable: spec.pensionable,
        isNhfBase: spec.nhfBase,
        isGrossPayComponent: true,
        expenseGlAccountId: accounts['5101'] ?? null,
        payableGlAccountId: accounts['2101'] ?? null,
      },
    });
  }

  // Deductions and employer contributions post to their own accounts. Rates are
  // NOT seeded here — they belong to Phase 9's statutory configuration.
  const STATUTORY_COMPONENTS = [
    { code: 'PAYE', name: 'PAYE', type: 'DEDUCTION', payable: '2110' },
    { code: 'PENSION-EE', name: 'Employee pension', type: 'DEDUCTION', payable: '2102' },
    { code: 'NHF', name: 'NHF', type: 'DEDUCTION', payable: '2103' },
    { code: 'PENSION-ER', name: 'Employer pension', type: 'EMPLOYER_CONTRIBUTION', payable: '2102', expense: '5102' },
    { code: 'NSITF', name: 'NSITF', type: 'EMPLOYER_CONTRIBUTION', payable: '2104', expense: '5103' },
    { code: 'ITF', name: 'ITF', type: 'EMPLOYER_CONTRIBUTION', payable: '2105', expense: '5104' },
  ] as const;

  for (const spec of STATUTORY_COMPONENTS) {
    await prisma.salaryComponent.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: {
        companyId,
        code: spec.code,
        name: spec.name,
        type: spec.type,
        isTaxable: false,
        isPensionable: false,
        isGrossPayComponent: false,
        payableGlAccountId: accounts[spec.payable] ?? null,
        expenseGlAccountId: 'expense' in spec ? (accounts[spec.expense] ?? null) : null,
      },
    });
  }

  // --- Items (SnailPro & PoultryPro Masters sheets) ------------------------
  type ItemSpec = {
    code: string;
    description: string;
    uom: string;
    costKobo: bigint | null;
    inventoryAccount: string;
    manufactured?: boolean;
    feed?: boolean;
  };

  const ITEMS: ItemSpec[] = [
    // SnailPro raw materials — Masters A5:D12, costs in naira -> kobo.
    { code: 'RM-SNAIL-LIVE', description: 'Live Harvested Snails', uom: 'Kg', costKobo: 4_200_00n, inventoryAccount: '1301' },
    { code: 'RM-SLIME', description: 'Fresh Snail Slime', uom: 'L', costKobo: 1_500_00n, inventoryAccount: '1301' },
    { code: 'RM-SHELL', description: 'Snail Shells', uom: 'Kg', costKobo: 300_00n, inventoryAccount: '1301' },
    { code: 'RM-PRESERVATIVE', description: 'Preservative', uom: 'L', costKobo: 8_000_00n, inventoryAccount: '1302' },
    { code: 'PK-BOTTLE-100', description: 'Bottle 100ml', uom: 'Unit', costKobo: 180_00n, inventoryAccount: '1302' },
    { code: 'PK-LABEL', description: 'Label', uom: 'Unit', costKobo: 45_00n, inventoryAccount: '1302' },
    { code: 'PK-VACUUM', description: 'Vacuum Pack', uom: 'Unit', costKobo: 250_00n, inventoryAccount: '1302' },
    { code: 'PK-CARTON', description: 'Carton', uom: 'Unit', costKobo: 350_00n, inventoryAccount: '1302' },
    // BOM sheet R18 references a 1kg bag that the Masters sheet omits; its cost
    // comes from the BOM row itself (E18 = 120).
    { code: 'PK-BAG-1KG', description: 'Bag 1kg', uom: 'Unit', costKobo: 120_00n, inventoryAccount: '1302' },

    // SnailPro finished goods — Masters G5:G9.
    { code: 'FG-SLIME-COSMETIC', description: 'Cosmetic Snail Slime 100ml', uom: 'Unit', costKobo: null, inventoryAccount: '1401', manufactured: true },
    { code: 'FG-SLIME-MEDICINAL', description: 'Medicinal Snail Slime 100ml', uom: 'Unit', costKobo: null, inventoryAccount: '1401', manufactured: true },
    { code: 'FG-MEAT-FROZEN', description: 'Frozen Snail Meat 1kg', uom: 'Unit', costKobo: null, inventoryAccount: '1401', manufactured: true },
    { code: 'FG-MEAT-SMOKED', description: 'Smoked Snail Meat 500g', uom: 'Unit', costKobo: null, inventoryAccount: '1401', manufactured: true },
    { code: 'FG-SHELL-POWDER', description: 'Snail Shell Powder 1kg', uom: 'Unit', costKobo: null, inventoryAccount: '1401', manufactured: true },
  ];

  const itemIds: Record<string, string> = {};
  for (const spec of ITEMS) {
    const existing = await prisma.item.findUnique({
      where: { companyId_code: { companyId, code: spec.code } },
    });
    if (existing) {
      itemIds[spec.code] = existing.id;
      continue;
    }

    const item = await prisma.item.create({
      data: {
        companyId,
        code: spec.code,
        description: spec.description,
        unitOfMeasureId: uomIds[spec.uom]!,
        itemType: 'INVENTORY',
        isManufactured: spec.manufactured ?? false,
        isBiologicalFeed: spec.feed ?? false,
        inventoryGlAccountId: accounts[spec.inventoryAccount] ?? null,
        revenueGlAccountId: spec.manufactured ? (accounts['4101'] ?? null) : null,
        ...(spec.costKobo !== null
          ? {
              standardCosts: {
                create: [
                  {
                    standardCostKobo: spec.costKobo,
                    effectiveFrom: from,
                    sourceReference: 'SnailPro workbook, Masters sheet',
                  },
                ],
              },
            }
          : {}),
      },
    });
    itemIds[spec.code] = item.id;
  }

  // --- Recipes (SnailPro BOM sheet, quantities per ONE finished unit) ------
  const RECIPES: Array<{
    code: string;
    name: string;
    output: string;
    yieldPercent: string;
    components: Array<{ item: string; qty: string; uom: string }>;
  }> = [
    {
      code: 'REC-SLIME-COSMETIC', name: 'Cosmetic Snail Slime 100ml',
      output: 'FG-SLIME-COSMETIC', yieldPercent: '92',
      components: [
        { item: 'RM-SLIME', qty: '0.1', uom: 'L' },
        { item: 'RM-PRESERVATIVE', qty: '0.002', uom: 'L' },
        { item: 'PK-BOTTLE-100', qty: '1', uom: 'Unit' },
        { item: 'PK-LABEL', qty: '1', uom: 'Unit' },
      ],
    },
    {
      code: 'REC-SLIME-MEDICINAL', name: 'Medicinal Snail Slime 100ml',
      output: 'FG-SLIME-MEDICINAL', yieldPercent: '90',
      components: [
        { item: 'RM-SLIME', qty: '0.1', uom: 'L' },
        { item: 'RM-PRESERVATIVE', qty: '0.003', uom: 'L' },
        { item: 'PK-BOTTLE-100', qty: '1', uom: 'Unit' },
        { item: 'PK-LABEL', qty: '1', uom: 'Unit' },
      ],
    },
    {
      code: 'REC-MEAT-FROZEN', name: 'Frozen Snail Meat 1kg',
      output: 'FG-MEAT-FROZEN', yieldPercent: '82',
      components: [
        { item: 'RM-SNAIL-LIVE', qty: '1.22', uom: 'Kg' },
        { item: 'PK-VACUUM', qty: '1', uom: 'Unit' },
      ],
    },
    {
      code: 'REC-MEAT-SMOKED', name: 'Smoked Snail Meat 500g',
      output: 'FG-MEAT-SMOKED', yieldPercent: '74',
      components: [
        { item: 'RM-SNAIL-LIVE', qty: '0.68', uom: 'Kg' },
        { item: 'PK-VACUUM', qty: '1', uom: 'Unit' },
      ],
    },
    {
      code: 'REC-SHELL-POWDER', name: 'Snail Shell Powder 1kg',
      output: 'FG-SHELL-POWDER', yieldPercent: '68',
      components: [
        { item: 'RM-SHELL', qty: '1.47', uom: 'Kg' },
        { item: 'PK-BAG-1KG', qty: '1', uom: 'Unit' },
      ],
    },
  ];

  for (const spec of RECIPES) {
    // Guard on the VERSION, not the recipe. A recipe row with no version is a
    // half-finished seed, and skipping it would leave it permanently broken.
    const existing = await prisma.productRecipe.findUnique({
      where: { companyId_code: { companyId, code: spec.code } },
      include: { versions: { select: { id: true } } },
    });
    if (existing?.versions.length) continue;
    if (existing) await prisma.productRecipe.delete({ where: { id: existing.id } });

    const recipe = await prisma.productRecipe.create({
      data: {
        companyId,
        code: spec.code,
        name: spec.name,
        outputItemId: itemIds[spec.output]!,
      },
    });

    // Created as a draft WITH its components, then activated. The database
    // freezes an active version's components, so the order matters: a version
    // that is ACTIVE before its lines exist can never receive them.
    const version = await prisma.productRecipeVersion.create({
      data: {
        recipeId: recipe.id,
        version: 1,
        batchSize: '1',
        expectedYieldPercent: spec.yieldPercent,
        effectiveFrom: from,
        notes: 'Seeded from the SnailPro workbook BOM sheet.',
        components: {
          create: spec.components.map((c, index) => ({
            lineNumber: index + 1,
            componentItemId: itemIds[c.item]!,
            quantityPerBatch: c.qty,
            unitOfMeasureId: uomIds[c.uom]!,
          })),
        },
      },
    });

    await prisma.productRecipeVersion.update({
      where: { id: version.id },
      data: { status: 'ACTIVE' },
    });
  }

  console.log(
    `Seeded masters: ${ITEMS.length} items, ${RECIPES.length} recipes, ` +
      `${SALARY_COMPONENTS.length + STATUTORY_COMPONENTS.length} salary components, ` +
      `4 payment terms, 3 units of measure. No supplier, customer or employee ` +
      `records — those are the client's real data, not ours to invent.`,
  );
}


// ---------------------------------------------------------------------------
// Accounting Adjustment Centre configuration (Consolidated Reference §3)
//
// Journal types and reason codes are configuration, so §3's menu items become
// data. The reason codes are §6's Credit Note reasons plus the adjustment
// causes §3 implies; extend them freely — no code changes.
// ---------------------------------------------------------------------------

async function seedJournals(companyId: string) {
  const TYPES = [
    { code: 'GJ', name: 'General Journal', kind: 'GENERAL', reason: true, attach: false, autoReverse: false },
    { code: 'CADJ', name: 'Customer Adjustment Journal', kind: 'CUSTOMER_ADJUSTMENT', reason: true, attach: true, autoReverse: false },
    { code: 'SADJ', name: 'Supplier Adjustment Journal', kind: 'SUPPLIER_ADJUSTMENT', reason: true, attach: true, autoReverse: false },
    { code: 'OB', name: 'Opening Balance', kind: 'OPENING_BALANCE', reason: false, attach: true, autoReverse: false },
    { code: 'ACCR', name: 'Accrual (auto-reversing)', kind: 'GENERAL', reason: true, attach: false, autoReverse: true },
    { code: 'REC', name: 'Recurring Journal', kind: 'RECURRING', reason: false, attach: false, autoReverse: false },
    { code: 'REV', name: 'Journal Reversal', kind: 'REVERSAL', reason: true, attach: false, autoReverse: false },
  ] as const;

  for (const spec of TYPES) {
    await prisma.journalType.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: {
        companyId,
        code: spec.code,
        name: spec.name,
        kind: spec.kind,
        requiresReasonCode: spec.reason,
        requiresAttachment: spec.attach,
        autoReverse: spec.autoReverse,
        workflowTransactionType: 'MANUAL_JOURNAL',
      },
    });
  }

  // §6 Credit Note reasons, plus the general adjustment causes.
  const REASONS = [
    { code: 'PRICING-ERROR', name: 'Pricing error' },
    { code: 'RETURNED-GOODS', name: 'Returned goods' },
    { code: 'PROMO-DISCOUNT', name: 'Promotional discount' },
    { code: 'INVOICE-CANCEL', name: 'Invoice cancellation' },
    { code: 'AUDIT-ADJ', name: 'Audit adjustment' },
    { code: 'RECLASS', name: 'Reclassification' },
    { code: 'ACCRUAL', name: 'Period-end accrual' },
    { code: 'PREPAYMENT', name: 'Prepayment release' },
    { code: 'FX-REVAL', name: 'Foreign exchange revaluation' },
    { code: 'CORRECTION', name: 'Correction of a posting error' },
  ];

  for (const spec of REASONS) {
    await prisma.reasonCode.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: { companyId, code: spec.code, name: spec.name },
    });
  }

  console.log(
    `Seeded adjustment centre: ${TYPES.length} journal types, ${REASONS.length} reason codes.`,
  );
}


// ---------------------------------------------------------------------------
// PAYE and statutory payroll configuration (Consolidated Reference §7.1, §7.2)
//
// EVERY figure below is taken from the two payroll workbooks and carries its
// source. Nothing here is inferred, and nothing here is a constant in code —
// when the law changes, a new effective-dated row supersedes these and past
// payroll runs still reproduce exactly.
//
// The bands are the Nigeria Tax Act 2025 schedule effective 1 January 2026,
// verbatim from Nigeria_PAYE_2026 workbook, Tax_Bands sheet.
// ---------------------------------------------------------------------------

async function seedPayroll(companyId: string) {
  const from = PAYROLL_EFFECTIVE_FROM;

  const existingBands = await prisma.payeBand.count({ where: { companyId } });
  if (existingBands === 0) {
    // Inserted in order: the contiguity trigger checks each band against its
    // neighbour, so band 2 needs band 1 already present.
    for (const band of NIGERIA_PAYE_2026_BANDS) {
      await prisma.payeBand.create({
        data: {
          companyId,
          bandOrder: band.order,
          lowerLimitKobo: band.lower,
          upperLimitKobo: band.upper,
          bandWidthKobo: band.width,
          rate: band.rate,
          effectiveFrom: from,
          sourceReference: NIGERIA_PAYE_2026_SOURCE,
        },
      });
    }
  }

  const existingPaye = await prisma.payeConfiguration.findFirst({
    where: { companyId, effectiveTo: null },
  });
  if (!existingPaye) {
    await prisma.payeConfiguration.create({
      data: { companyId, effectiveFrom: from, ...NIGERIA_PAYE_2026_CONFIG },
    });
  }

  const existingStatutory = await prisma.statutoryConfiguration.findFirst({
    where: { companyId, effectiveTo: null },
  });
  if (!existingStatutory) {
    await prisma.statutoryConfiguration.create({
      data: {
        companyId,
        effectiveFrom: from,
        ...NIGERIA_STATUTORY_2026_CONFIG,
        // Company_Setup B9 — the one field here that is a company decision,
        // not a statutory figure. Defaulted on for the seed fixtures only.
        nhfCompanyParticipation: true,
      },
    });
  }

  console.log(
    `Seeded payroll: ${NIGERIA_PAYE_2026_BANDS.length} PAYE bands (NTA 2025, effective ` +
      `2026-01-01), PAYE reliefs and the NHF/ITF/NSITF/pension rates — all effective-dated ` +
      `with sources.`,
  );
}


// ---------------------------------------------------------------------------
// Order-to-Cash configuration (Consolidated Reference §6)
//
// The COGS recognition point is set to DELIVERY, which is when control of the
// goods transfers. §6 instructs cost of sales to be posted at BOTH delivery and
// invoice; that is a contradiction, so it is configuration here and double
// recognition is refused by the database either way. Confirm with the client
// which point they intend before go-live.
// ---------------------------------------------------------------------------

async function seedSales(companyId: string, accounts: Record<string, string>) {
  const existing = await prisma.salesConfiguration.findFirst({
    where: { companyId, effectiveTo: null },
  });
  if (existing) {
    console.log('Sales configuration already present.');
    return;
  }

  // §6 postings need a receivable and a cost-of-sales account; neither is in
  // the workbooks' chart, so they are added here with that provenance.
  const extra = [
    { number: '1201', name: 'Trade Receivables', type: 'ASSET', normal: 'DEBIT' },
    { number: '5001', name: 'Cost of Sales', type: 'EXPENSE', normal: 'DEBIT' },
  ] as const;

  for (const spec of extra) {
    const account = await prisma.gLAccount.upsert({
      where: {
        companyId_accountNumber: { companyId, accountNumber: spec.number },
      },
      update: {},
      create: {
        companyId,
        accountNumber: spec.number,
        name: spec.name,
        accountType: spec.type,
        normalBalance: spec.normal,
        isPostingAccount: true,
      },
    });
    accounts[spec.number] = account.id;
  }

  await prisma.salesConfiguration.create({
    data: {
      companyId,
      cogsRecognitionPoint: 'DELIVERY',
      // Nothing increases stock until Procure-to-Pay and Processing land, so
      // enforcing availability now would block every delivery.
      allowNegativeStock: true,
      receivableGlAccountId: accounts['1201']!,
      revenueGlAccountId: accounts['4101']!,
      costOfSalesGlAccountId: accounts['5001']!,
      inventoryGlAccountId: accounts['1401']!,
      whtReceivableGlAccountId: accounts['1602'] ?? null,
      effectiveFrom: new Date('2026-01-01'),
    },
  });

  console.log(
    'Seeded sales: O2C configuration with cost of sales recognised at DELIVERY ' +
      '(§6 is contradictory on this — confirm with the client).',
  );
}


// ---------------------------------------------------------------------------
// Procure-to-Pay configuration (Consolidated Reference §5)
//
// GRNI is the account that makes the receive-then-invoice sequence work without
// recognising inventory twice. §5 names it; the workbooks' chart of accounts
// does not contain it, so it is added here with that provenance.
//
// Match tolerances start at ZERO — every variance is an exception until the
// client states what they are willing to accept without a second look.
// ---------------------------------------------------------------------------

async function seedProcurement(companyId: string, accounts: Record<string, string>) {
  const existing = await prisma.procurementConfiguration.findFirst({
    where: { companyId, effectiveTo: null },
  });
  if (existing) {
    console.log('Procurement configuration already present.');
    return;
  }

  const extra = [
    { number: '2140', name: 'Goods Received Not Invoiced', type: 'LIABILITY', normal: 'CREDIT' },
    { number: '2201', name: 'Trade Payables', type: 'LIABILITY', normal: 'CREDIT' },
    { number: '5401', name: 'Operating Expenses', type: 'EXPENSE', normal: 'DEBIT' },
  ] as const;

  for (const spec of extra) {
    const account = await prisma.gLAccount.upsert({
      where: { companyId_accountNumber: { companyId, accountNumber: spec.number } },
      update: {},
      create: {
        companyId,
        accountNumber: spec.number,
        name: spec.name,
        accountType: spec.type,
        normalBalance: spec.normal,
        isPostingAccount: true,
      },
    });
    accounts[spec.number] = account.id;
  }

  await prisma.procurementConfiguration.create({
    data: {
      companyId,
      grniGlAccountId: accounts['2140']!,
      payablesGlAccountId: accounts['2201']!,
      whtPayableGlAccountId: accounts['2130'] ?? null,
      // Zero tolerance: every price or quantity variance routes to the
      // exception ladder until the client sets a threshold.
      quantityTolerancePercent: '0',
      priceTolerancePercent: '0',
      overReceiptTolerancePercent: '0',
      // The inward stock flow exists from this phase, so availability can be
      // enforced — but Processing (Phase 6) still has to land before every
      // inward movement is represented.
      allowNegativeStock: true,
      effectiveFrom: new Date('2026-01-01'),
    },
  });

  console.log(
    'Seeded procurement: GRNI, payables and expense accounts, zero match ' +
      'tolerances (confirm the client\u2019s thresholds before go-live).',
  );
}


// ---------------------------------------------------------------------------
// Nigerian statutory positions researched from public sources (August 2026)
//
// These fill the gaps the client's own documents left open. They are RESEARCHED,
// not client-confirmed: every figure carries its source, and each still wants a
// sign-off from the client's tax adviser before go-live. That is a materially
// better position than blank configuration — a wrong rate that is written down
// with its source can be checked, whereas a missing rate silently blocks work.
//
// SOURCES
//   WHT rates    Deduction of Tax at Source (Withholding) Regulations 2024,
//                gazetted 2 October 2024, effective 1 January 2025. Rates cross-
//                checked against PwC Worldwide Tax Summaries (reviewed 29 May
//                2026) and TaxSpire's 2026 WHT guide, which agree.
//   WHT basis    Computed on the amount BEFORE VAT. PwC and Stransact both
//                state VAT is excluded from the WHT base.
//   VAT          Nigeria Tax Act 2025, effective 1 January 2026. Standard rate
//                remains 7.5%. Basic food and agricultural products are
//                ZERO-RATED (not exempt) — so input VAT on them is RECOVERABLE.
// ---------------------------------------------------------------------------

async function seedStatutoryRates(companyId: string) {
  const from = new Date('2026-01-01');
  const WHT_SOURCE =
    'Deduction of Tax at Source (Withholding) Regulations 2024 (effective 2025-01-01); ' +
    'cross-checked PwC Worldwide Tax Summaries 2026-05-29 and TaxSpire 2026 guide. ' +
    'RESEARCHED — confirm with the client tax adviser.';

  // Rates for RESIDENT recipients. Non-resident rates differ and are governed by
  // treaty in many cases, which is why they are not assumed here.
  const WHT_RATES: Array<{ code: string; rate: string; note: string }> = [
    { code: 'WHT-CONTRACT', rate: '0.02000000', note: 'Supply of goods/materials and construction of roads, bridges, buildings and power plants — 2%' },
    { code: 'WHT-SERVICES', rate: '0.05000000', note: 'Professional, consultancy, technical and management fees — 5%, a final tax for residents' },
    { code: 'WHT-COMMISSION', rate: '0.05000000', note: 'Commission — 5%' },
    { code: 'WHT-RENT', rate: '0.10000000', note: 'Rent, hire or lease — 10%' },
    { code: 'WHT-DIVIDEND', rate: '0.10000000', note: 'Dividends — 10%' },
    { code: 'WHT-INTEREST', rate: '0.10000000', note: 'Interest — 10%' },
    { code: 'WHT-ROYALTY', rate: '0.05000000', note: 'Royalties — 5%' },
  ];

  let ratesAdded = 0;
  for (const spec of WHT_RATES) {
    const code = await prisma.taxCode.findUnique({
      where: { companyId_code: { companyId, code: spec.code } },
    });
    if (!code) continue;

    const existing = await prisma.taxRate.findFirst({ where: { taxCodeId: code.id } });
    if (existing) continue;

    await prisma.taxRate.create({
      data: {
        taxCodeId: code.id,
        rate: spec.rate,
        effectiveFrom: from,
        sourceReference: `${spec.note}. ${WHT_SOURCE}`,
      },
    });
    ratesAdded += 1;
  }

  // Two WHT rules deliberately NOT automated, because each changes an amount
  // and needs the client to say they want it applied automatically:
  //
  //   1. A vendor without a valid TIN attracts DOUBLE the rate (passive income
  //      such as dividends excepted). Mechanical to add once confirmed.
  //   2. Small companies (turnover <= N25m) are exempt from the obligation to
  //      deduct, and PwC additionally reports a per-transaction floor of N2m
  //      for TIN-registered vendors. The two thresholds are described
  //      differently by different sources, which is exactly why this system
  //      should not guess between them.
  //
  // Both are recorded here so the gap is visible rather than forgotten.

  const config = await prisma.taxConfiguration.findFirst({
    where: { companyId, effectiveTo: null },
  });
  if (config) {
    await prisma.taxConfiguration.update({
      where: { id: config.id },
      data: {
        whtBasis: 'NET_OF_VAT',
        whtBasisAuthority:
          'Withholding is computed on the amount BEFORE VAT. Sources: PwC Worldwide ' +
          'Tax Summaries (Nigeria, Corporate — Withholding taxes) and Stransact, ' +
          '"Nigeria’s New Withholding Tax Regulations Explained". RESEARCHED — ' +
          'confirm with the client tax adviser.',
      },
    });
  }

  console.log(
    `Seeded statutory rates: ${ratesAdded} WHT rates from the 2024 Withholding ` +
      `Regulations, WHT basis confirmed NET_OF_VAT. Researched, not client-confirmed.`,
  );
}

// ---------------------------------------------------------------------------
// VAT treatment of the client's own products (Nigeria Tax Act 2025)
//
// The Act ZERO-RATES basic food and agricultural products, rather than exempting
// them. The distinction is worth real money: a zero-rated supplier recovers
// input VAT, an exempt one bears it as a cost. Phase 3 models the two
// separately for exactly this reason.
//
// The mapping below is a defensible reading, not a ruling. Two lines are
// genuinely arguable and are flagged in the console rather than buried.
// ---------------------------------------------------------------------------

async function seedItemVatTreatment(companyId: string) {
  const codes = await prisma.taxCode.findMany({
    where: { companyId, taxType: 'VAT' },
  });
  const byCode = new Map(codes.map((c) => [c.code, c.id]));

  const STANDARD = byCode.get('VAT-STD');
  const ZERO = byCode.get('VAT-ZERO');
  if (!STANDARD || !ZERO) return;

  const MAPPING: Array<{ item: string; taxCode: string; reason: string }> = [
    // Unprocessed agricultural produce — zero-rated.
    { item: 'RM-SNAIL-LIVE', taxCode: 'VAT-ZERO', reason: 'Live agricultural produce' },
    { item: 'RM-SLIME', taxCode: 'VAT-ZERO', reason: 'Unprocessed agricultural produce' },
    { item: 'RM-SHELL', taxCode: 'VAT-ZERO', reason: 'Agricultural by-product' },

    // Chemical and packaging inputs — standard rated.
    { item: 'RM-PRESERVATIVE', taxCode: 'VAT-STD', reason: 'Chemical input, not agricultural produce' },
    { item: 'PK-BOTTLE-100', taxCode: 'VAT-STD', reason: 'Packaging' },
    { item: 'PK-LABEL', taxCode: 'VAT-STD', reason: 'Packaging' },
    { item: 'PK-VACUUM', taxCode: 'VAT-STD', reason: 'Packaging' },
    { item: 'PK-CARTON', taxCode: 'VAT-STD', reason: 'Packaging' },
    { item: 'PK-BAG-1KG', taxCode: 'VAT-STD', reason: 'Packaging' },

    // Food outputs — zero-rated as basic food.
    { item: 'FG-MEAT-FROZEN', taxCode: 'VAT-ZERO', reason: 'Basic food item' },
    { item: 'FG-MEAT-SMOKED', taxCode: 'VAT-ZERO', reason: 'Basic food item' },

    // Non-food outputs — standard rated. A cosmetic is not a basic food item
    // however agricultural its input was.
    { item: 'FG-SLIME-COSMETIC', taxCode: 'VAT-STD', reason: 'Cosmetic product, not food' },

    // ARGUABLE — flagged below rather than assumed silently.
    { item: 'FG-SLIME-MEDICINAL', taxCode: 'VAT-STD', reason: 'ARGUABLE: may qualify as a zero-rated medical product if registered as such' },
    { item: 'FG-SHELL-POWDER', taxCode: 'VAT-STD', reason: 'ARGUABLE: zero-rated if sold as animal feed or an agricultural input' },
  ];

  let mapped = 0;
  for (const spec of MAPPING) {
    const item = await prisma.item.findUnique({
      where: { companyId_code: { companyId, code: spec.item } },
    });
    if (!item) continue;

    await prisma.item.update({
      where: { id: item.id },
      data: { vatTaxCodeId: spec.taxCode === 'VAT-ZERO' ? ZERO : STANDARD },
    });
    mapped += 1;
  }

  const arguable = MAPPING.filter((m) => m.reason.startsWith('ARGUABLE'));

  console.log(
    `Seeded VAT treatment: ${mapped} items mapped (food and agricultural produce ` +
      `ZERO-RATED per Nigeria Tax Act 2025, so input VAT stays recoverable).`,
  );
  for (const item of arguable) {
    console.log(`  NEEDS A RULING: ${item.item} — ${item.reason.replace('ARGUABLE: ', '')}`);
  }
}

// ---------------------------------------------------------------------------
// Three-way match tolerances (§5)
//
// Commercial policy rather than statute, so this is a judgement call: 2% on
// both price and quantity. Tight enough that a real overcharge is caught,
// loose enough that a rounding difference or a weighed-goods variance does not
// send every invoice to an exception queue nobody then has time to read.
// Zero tolerance sounds safer and in practice is worse, because an exception
// queue that is always full stops being read at all.
// ---------------------------------------------------------------------------

async function seedMatchTolerances(companyId: string) {
  const config = await prisma.procurementConfiguration.findFirst({
    where: { companyId, effectiveTo: null },
  });
  if (!config) return;

  await prisma.procurementConfiguration.update({
    where: { id: config.id },
    data: {
      priceTolerancePercent: '2',
      quantityTolerancePercent: '2',
      // Over-receipt stays at zero: accepting goods nobody ordered is a
      // different kind of problem from a small price variance.
      overReceiptTolerancePercent: '0',
    },
  });

  console.log(
    'Seeded match tolerances: 2% price, 2% quantity, 0% over-receipt (commercial ' +
      'judgement — the client may set their own).',
  );
}

/**
 * The period-close checklist (§8). Each step is either backed by an automated
 * check the close validation already runs — in which case `automatedCheck`
 * names the finding code and the system answers it — or confirmed by a human.
 *
 * Blocking steps stop the close. Non-blocking ones are recorded and may be
 * waived with a stated reason, which the database requires.
 */
async function seedCloseChecklist(companyId: string) {
  const steps = [
    {
      code: 'CL-010',
      name: 'All sub-ledgers posted to the general ledger',
      description:
        'No approved document from procurement, sales, payroll or production is ' +
        'still waiting to reach the GL for this period.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: null,
    },
    {
      code: 'CL-020',
      name: 'No transactions awaiting approval',
      description: 'Every workflow transaction dated in the period has reached a terminal state.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: 'NO_PENDING_APPROVALS',
    },
    {
      code: 'CL-030',
      name: 'No draft journals left in the period',
      description: 'Draft manual journals are either posted or cancelled before the period shuts.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: 'NO_DRAFT_JOURNALS',
    },
    {
      code: 'CL-040',
      name: 'Bank accounts reconciled',
      description:
        'Each bank GL account agrees to its statement at the period end date, with ' +
        'reconciling items listed.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: null,
    },
    {
      code: 'CL-050',
      name: 'Stock count reconciled to the stock ledger',
      description:
        'Physical counts are entered and variances either explained or written off ' +
        'through an approved adjustment.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: null,
    },
    {
      code: 'CL-060',
      name: 'GRNI reviewed and aged',
      description:
        'Goods received not invoiced is a real liability. Anything aged beyond the ' +
        'agreed window is chased or accrued.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: 'GRNI_REVIEWED',
    },
    {
      code: 'CL-070',
      name: 'Payroll posted for the period',
      description: 'Every payroll run covering the period is approved and posted.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: 'PAYROLL_POSTED',
    },
    {
      code: 'CL-080',
      name: 'VAT and WHT registers agree to the control accounts',
      description:
        'Register totals reconcile to movement on the input VAT, output VAT, WHT ' +
        'receivable and WHT payable accounts.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: null,
    },
    {
      code: 'CL-090',
      name: 'Statutory returns filed',
      description:
        'VAT and PAYE returns for the period are filed and the remittance evidence ' +
        'attached. Due dates: VAT and PAYE by the 21st and 10th of the following ' +
        'month respectively — confirm with the client for their filing calendar.',
      blocking: false,
      appliesToYearEnd: true,
      automatedCheck: 'TAX_PERIODS_FILED',
    },
    {
      code: 'CL-100',
      name: 'Accruals and prepayments reviewed',
      description: 'Recurring accruals released or rolled, prepayments amortised for the period.',
      blocking: false,
      appliesToYearEnd: true,
      automatedCheck: null,
    },
    {
      code: 'CL-110',
      name: 'Depreciation posted',
      description: 'Fixed asset depreciation for the period is calculated and posted.',
      blocking: false,
      appliesToYearEnd: true,
      automatedCheck: null,
    },
    {
      code: 'CL-120',
      name: 'Intercompany and interbranch balances agree',
      description: 'Branch-to-branch balances net to zero across the company.',
      blocking: false,
      appliesToYearEnd: true,
      automatedCheck: null,
    },
    {
      code: 'CL-130',
      name: 'Trial balance in balance',
      description: 'Total debits equal total credits for the period.',
      blocking: true,
      appliesToYearEnd: true,
      automatedCheck: 'TRIAL_BALANCE',
    },
    {
      code: 'CL-140',
      name: 'Management accounts reviewed and signed off',
      description:
        'The period result is reviewed against budget and the variances explained ' +
        'before the period is shut.',
      blocking: false,
      appliesToYearEnd: true,
      automatedCheck: null,
    },
  ];

  let sequence = 10;
  for (const step of steps) {
    await prisma.periodCloseChecklistTemplate.upsert({
      where: { companyId_code: { companyId, code: step.code } },
      update: {
        name: step.name,
        description: step.description,
        sequence,
        blocking: step.blocking,
        appliesToYearEnd: step.appliesToYearEnd,
        automatedCheck: step.automatedCheck,
      },
      create: {
        companyId,
        code: step.code,
        name: step.name,
        description: step.description,
        sequence,
        blocking: step.blocking,
        appliesToYearEnd: step.appliesToYearEnd,
        automatedCheck: step.automatedCheck,
      },
    });
    sequence += 10;
  }

  console.log(
    `Seeded ${steps.length} period-close checklist steps ` +
      `(${steps.filter((s) => s.blocking).length} blocking, ` +
      `${steps.filter((s) => s.automatedCheck).length} automated).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
