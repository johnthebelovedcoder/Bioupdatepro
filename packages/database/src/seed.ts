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
      name: 'SnailPro / PoultryPro Demo',
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

  console.log(
    `Seeded company ${company.code}: ${ACCOUNTS.length} accounts, ` +
      `${COST_CENTRES.length} cost centres, 12 periods.`,
  );
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
  controller: 'FINANCIAL_CONTROLLER',
  managingDirector: 'MANAGING_DIRECTOR',
  administrator: 'ADMINISTRATOR',
} as const;

/**
 * The §2 approval-limit ladder, in kobo.
 *
 *   Farm Manager          up to      ₦250,000
 *   Finance Manager       up to    ₦2,000,000
 *   Financial Controller  up to   ₦10,000,000
 *   Managing Director     unlimited
 *
 * Each figure is that rung's approval ceiling: a document climbs from level 1
 * up to the first rung whose ceiling covers it.
 */
const APPROVAL_LADDER = [
  { level: 1, roleCode: WORKFLOW_ROLES.farmManager, name: 'Farm Manager', maxAmountKobo: 250_000_00n },
  { level: 2, roleCode: WORKFLOW_ROLES.financeManager, name: 'Finance Manager', maxAmountKobo: 2_000_000_00n },
  { level: 3, roleCode: WORKFLOW_ROLES.controller, name: 'Financial Controller', maxAmountKobo: 10_000_000_00n },
  { level: 4, roleCode: WORKFLOW_ROLES.managingDirector, name: 'Managing Director', maxAmountKobo: null },
];

/**
 * Transaction types in scope for §2. Every one routes through the shared
 * engine; none of them implements its own approvals.
 */
const WORKFLOW_TYPES: Array<{ type: string; name: string; autoPost: boolean }> = [
  { type: 'GL_JOURNAL', name: 'Manual Journal', autoPost: true },
  { type: 'CUSTOMER_ADJUSTMENT', name: 'Customer Adjustment Journal', autoPost: true },
  { type: 'SUPPLIER_ADJUSTMENT', name: 'Supplier Adjustment Journal', autoPost: true },
  { type: 'JOURNAL_REVERSAL', name: 'Journal Reversal', autoPost: true },
  { type: 'PURCHASE_REQUISITION', name: 'Purchase Requisition', autoPost: false },
  { type: 'PURCHASE_ORDER', name: 'Purchase Order', autoPost: false },
  { type: 'SUPPLIER_INVOICE', name: 'Supplier Invoice', autoPost: false },
  { type: 'SUPPLIER_PAYMENT', name: 'Supplier Payment', autoPost: false },
  { type: 'SALES_QUOTATION', name: 'Sales Quotation', autoPost: false },
  { type: 'SALES_ORDER', name: 'Sales Order', autoPost: false },
  { type: 'CREDIT_NOTE', name: 'Credit Note', autoPost: false },
  { type: 'INVENTORY_ADJUSTMENT', name: 'Inventory Adjustment', autoPost: false },
  { type: 'PRODUCTION_ORDER', name: 'Production Order', autoPost: false },
  { type: 'MATERIAL_ISSUE', name: 'Material Issue', autoPost: false },
  { type: 'PAYROLL_RUN', name: 'Payroll Processing', autoPost: false },
  { type: 'PERIOD_CLOSE', name: 'Period Close', autoPost: false },
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

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
