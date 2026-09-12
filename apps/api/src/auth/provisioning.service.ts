import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  AccountType,
  NormalBalance,
  Prisma,
  SalaryComponentType,
  WarehouseType,
} from '@bioassetpro/database';

/**
 * Everything a new farm needs before it can record anything.
 *
 * Signing somebody up is the easy half. The hard half is that an empty company
 * is not a usable one: with no chart of accounts nothing can post, with no cost
 * centre the work-in-progress account refuses every line, and with no financial
 * period open the first daily round a farmer records fails on a rule they have
 * never heard of. A signup that produced that would be worse than no signup —
 * the farm would look fine until the moment it mattered.
 *
 * So registration provisions the skeleton in the same transaction as the user.
 * Either a working farm exists or none does.
 *
 * The chart of accounts below is the same one the demo seed uses, and is drawn
 * from the source workbooks rather than invented — see packages/database
 * seed.ts, which carries the per-account citations. It is duplicated here
 * deliberately rather than imported: that file executes a seed on import, and
 * an API that ran the demo seed when someone signed up would be a catastrophe.
 *
 * What this does NOT provision, stated plainly because onboarding has to say
 * so: tax codes and rates, sales and procurement configuration, and payroll
 * bands. Those carry statutory rates and posting rules that belong to the
 * farm's own accountant, and guessing them would put invented tax treatment
 * into a real ledger. A farm can record operations from day one; it cannot
 * raise a taxed invoice until somebody sets that up.
 */

interface AccountSeed {
  number: string;
  name: string;
  type: AccountType;
  normal: NormalBalance;
  requiresCostCentre?: boolean;
}

const ACCOUNTS: AccountSeed[] = [
  { number: '1101', name: 'Bank', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '1201', name: 'Trade Receivables', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '1301', name: 'Raw Material Inventory', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '1302', name: 'Packaging & Consumables Inventory', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '1305', name: 'By-product Inventory', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '1401', name: 'Finished Goods Inventory', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  // Cost centre mandatory: every production cost must be attributable (§10.5).
  { number: '1501', name: 'Work in Progress', type: AccountType.ASSET, normal: NormalBalance.DEBIT, requiresCostCentre: true },
  { number: '1601', name: 'Input VAT Recoverable', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '1602', name: 'WHT Receivable', type: AccountType.ASSET, normal: NormalBalance.DEBIT },

  { number: '2101', name: 'Salary Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  // Payroll's own resolveAccounts() (PayrollRunService) refuses to post
  // without all four of these — without them a company could calculate a
  // run but never approve one.
  { number: '2102', name: 'Pension Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '2103', name: 'NHF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '2104', name: 'NSITF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '2105', name: 'ITF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '2110', name: 'PAYE Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '2120', name: 'Output VAT Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '2130', name: 'WHT Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '2140', name: 'Goods Received Not Invoiced', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '2201', name: 'Trade Payables', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },

  // The number `YearEndService.findRetainedEarnings()` looks for first — without
  // this, a freshly provisioned company can never close its first year, and a
  // balance sheet has nowhere for the current year's result to sit.
  { number: '3200', name: 'Retained Earnings', type: AccountType.EQUITY, normal: NormalBalance.CREDIT },

  { number: '4101', name: 'Revenue', type: AccountType.REVENUE, normal: NormalBalance.CREDIT },

  { number: '5001', name: 'Cost of Sales', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
  { number: '5101', name: 'Salaries and Wages', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
  { number: '5102', name: 'Employer Pension Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
  { number: '5103', name: 'NSITF Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
  { number: '5104', name: 'ITF Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
  { number: '5305', name: 'Production Loss Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT, requiresCostCentre: true },
  { number: '5401', name: 'Operating Expenses', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },

  // Fixed assets. Numbers are additive to this chart's own convention, not the
  // client's six-digit spec chart (posting-control.json PCR-029/030 name
  // 140100/149100/630100) — that migration is a separate, still-open client
  // decision. Provisional pending it, same as the posting-control keys.
  { number: '1701', name: 'Property, Plant & Equipment', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '1702', name: 'Accumulated Depreciation', type: AccountType.ASSET, normal: NormalBalance.CREDIT },
  { number: '5501', name: 'Depreciation Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },

  /*
   * The biological-asset lifecycle (§61/§67 — PCR-037 through PCR-071).
   * Six-digit, additive to this chart's own convention like Fixed Assets
   * above, not the client's full spec chart (that migration is the same
   * still-open client decision noted there).
   *
   * Without these, `BiologicalAssetService.postAcquisition()` and every
   * event downstream of it (mortality, stage transfer, valuation) could
   * never resolve an account for a freshly registered company — the
   * operational record would still save, but its accounting effect would
   * be silently and permanently dropped. Names and codes are the client's
   * own, from posting-control.json's PCR-004/037-071.
   */
  { number: '210200', name: 'GRNI', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  { number: '130200', name: 'BA — Snail Breeders', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '130201', name: 'BA — Snail Eggs', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '130202', name: 'BA — Snail Hatchlings', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '130203', name: 'BA — Snail Juveniles', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '130204', name: 'BA — Market Snails', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '130210', name: 'BA — Poultry', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  { number: '420100', name: 'Fair-Value Gain/Loss — Snails', type: AccountType.REVENUE, normal: NormalBalance.CREDIT },
  { number: '420200', name: 'Fair-Value Gain/Loss — Poultry', type: AccountType.REVENUE, normal: NormalBalance.CREDIT },
];

/**
 * Which GL account each species/stage carries its biological asset in.
 *
 * Duplicated from `packages/database/src/seed-biological-assets.ts` rather
 * than imported, for the same reason as the chart above: that file's own
 * package export resolves to the generated Prisma client only, so reaching
 * its `src/` from here needs a deep relative import this package boundary
 * doesn't offer cleanly. See that file's own header for why each mapping is
 * what it is, and for the two vocabulary-migration entries kept for
 * defensive compatibility.
 */
const SNAIL_STAGE_ACCOUNTS: Record<string, string> = {
  Breeder: '130200',
  Egg: '130201',
  Hatchling: '130202',
  Juvenile: '130203',
  Grower: '130203',
  'Market-ready': '130204',
  'Breeder cohort': '130200',
  Growers: '130203',
  Juveniles: '130203',
};

const POULTRY_STAGE_ACCOUNTS: Record<string, string> = {
  Chick: '130210',
  Grower: '130210',
  'Market-ready': '130210',
  'Point-of-lay': '130210',
  Layer: '130210',
  Broiler: '130210',
  Pullet: '130210',
  Cockerel: '130210',
  Breeder: '130210',
};

/** PROVISIONAL — see BiologicalAssetConfiguration's schema-level note. */
const ABNORMAL_MORTALITY_THRESHOLD_PERCENT = '2';

/** Enough hierarchy to attribute farm costs. The farm can add its own. */
const COST_CENTRES = [
  { code: '100', name: 'Corporate' },
  { code: '130', name: 'Farm Operations', parent: '100' },
];

const WAREHOUSES = [
  { code: 'RAW-WH', name: 'Feed & Supplies Store', type: WarehouseType.RAW_MATERIAL },
  { code: 'FG-WH', name: 'Produce Store', type: WarehouseType.FINISHED_GOODS },
];

/**
 * The company-wide default approval routing, duplicated from
 * packages/database seed.ts's `seedWorkflow` for the same reason the chart of
 * accounts above is duplicated: that file runs a seed on import, so it cannot
 * be imported here.
 *
 * Without this, `WorkflowRoutingService.resolveDefinition()` finds nothing
 * for a freshly registered company and refuses every workflow-gated
 * submission — purchase requisitions, orders, sales documents, payroll runs,
 * biological-asset valuations, all of it — because a transaction type with no
 * route must not bypass approval.
 *
 * PROVISIONAL, same caveat as the seed: this ladder is the consultant's
 * illustrative thresholds, not the client's confirmed delegated-authority
 * policy. Keep this list and the seed's in sync until it moves to real
 * configuration.
 */
const WORKFLOW_ROLES = {
  supervisor: 'PRODUCTION_SUPERVISOR',
  farmManager: 'FARM_MANAGER',
  financeManager: 'FINANCE_MANAGER',
  controller: 'FINANCE_CONTROLLER',
  cfo: 'CFO',
  administrator: 'ADMINISTRATOR',
} as const;

const APPROVAL_LADDER = [
  { level: 1, roleCode: WORKFLOW_ROLES.farmManager, name: 'Farm Manager', maxAmountKobo: 250_000_00n },
  { level: 2, roleCode: WORKFLOW_ROLES.financeManager, name: 'Finance Manager', maxAmountKobo: 2_000_000_00n },
  { level: 3, roleCode: WORKFLOW_ROLES.controller, name: 'Finance Controller', maxAmountKobo: 10_000_000_00n },
  { level: 4, roleCode: WORKFLOW_ROLES.cfo, name: 'CFO', maxAmountKobo: null as bigint | null },
];

const WORKFLOW_TYPES: Array<{ type: string; name: string; autoPost: boolean }> = [
  { type: 'MANUAL_JOURNAL', name: 'Manual Journal', autoPost: true },
  { type: 'GL_JOURNAL', name: 'General Ledger Journal', autoPost: true },
  { type: 'CUSTOMER_ADJUSTMENT', name: 'Customer Adjustment Journal', autoPost: true },
  { type: 'SUPPLIER_ADJUSTMENT', name: 'Supplier Adjustment Journal', autoPost: true },
  { type: 'JOURNAL_REVERSAL', name: 'Journal Reversal', autoPost: true },

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

  { type: 'INVENTORY_ADJUSTMENT', name: 'Inventory Adjustment', autoPost: false },
  { type: 'PRODUCTION_ORDER', name: 'Production Order', autoPost: false },
  { type: 'MATERIAL_ISSUE', name: 'Material Issue', autoPost: false },

  { type: 'BA_VALUATION', name: 'Biological Asset Valuation', autoPost: true },

  { type: 'FIXED_ASSET_CAPITALISATION', name: 'Fixed Asset Capitalisation', autoPost: true },
  { type: 'DEPRECIATION_RUN', name: 'Depreciation Run', autoPost: true },

  { type: 'PAYROLL_RUN', name: 'Payroll Processing', autoPost: true },
  { type: 'PERIOD_CLOSE', name: 'Period Close', autoPost: false },
  { type: 'PERIOD_REOPEN', name: 'Period Reopen', autoPost: false },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface ProvisionInput {
  farmName: string;
  /** 1–12. The financial year starts on the first of this month. */
  financialYearStartMonth?: number;
}

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  /**
   * Build a working company. Runs inside the caller's transaction so that a
   * half-provisioned farm can never survive a failure.
   */
  async provisionCompany(
    tx: Prisma.TransactionClient,
    input: ProvisionInput,
  ): Promise<{ companyId: string; branchId: string; farmId: string }> {
    const currency = await this.nairaCurrency(tx);

    // A short, unique code from the name. Companies are addressed by code in
    // several places, and two farms called "Green Farms" must not collide.
    const code = await this.uniqueCompanyCode(tx, input.farmName);

    const company = await tx.company.create({
      data: {
        code,
        name: input.farmName.trim(),
        baseCurrency: { connect: { id: currency.id } },
      },
    });

    const branch = await tx.branch.create({
      data: { companyId: company.id, code: 'HQ', name: 'Head Office' },
    });

    // Cost centres, parents first so the child can point at one.
    const centres = new Map<string, string>();
    for (const centre of COST_CENTRES) {
      const created = await tx.costCentre.create({
        data: {
          companyId: company.id,
          code: centre.code,
          name: centre.name,
          // Cost centres are effective-dated. Today, because the farm starts
          // existing today — backdating one would let costs be attributed to a
          // period before the centre was agreed.
          effectiveDate: new Date(),
          ...(centre.parent && centres.has(centre.parent)
            ? { parentId: centres.get(centre.parent) }
            : {}),
        },
      });
      centres.set(centre.code, created.id);
    }

    // One round trip for the whole chart rather than one per account — this
    // list has grown from 24 rows to 33 with the biological-asset accounts
    // below, and every extra sequential round trip narrows the margin
    // against Prisma's interactive-transaction timeout under Neon's latency.
    await tx.gLAccount.createMany({
      data: ACCOUNTS.map((account) => ({
        companyId: company.id,
        accountNumber: account.number,
        name: account.name,
        accountType: account.type,
        normalBalance: account.normal,
        requiresCostCentre: account.requiresCostCentre ?? false,
      })),
    });

    const farm = await tx.farm.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        code: 'MAIN',
        name: input.farmName.trim(),
      },
    });

    await tx.warehouse.createMany({
      data: WAREHOUSES.map((warehouse) => ({
        companyId: company.id,
        branchId: branch.id,
        code: warehouse.code,
        name: warehouse.name,
        type: warehouse.type,
      })),
    });

    await this.openFinancialYear(tx, company.id, input.financialYearStartMonth ?? 1);
    await this.seedWorkflow(tx, company.id);
    await this.seedDomainAccountConfiguration(tx, company.id);

    this.logger.log(`Provisioned ${company.name} (${code})`);
    return { companyId: company.id, branchId: branch.id, farmId: farm.id };
  }

  /**
   * The default company-wide approval routing for every workflow-gated
   * transaction type. Without this, `WorkflowRoutingService.resolveDefinition`
   * has nothing to find and every submission for this company is refused.
   *
   * No existence checks: the company was just created in this same
   * transaction, so there is nothing to collide with — unlike the demo seed,
   * which re-runs against the same company and has to be idempotent.
   */
  private async seedWorkflow(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
    /*
     * Two round trips for the whole ladder rather than one per definition
     * plus one per step (this used to be ~120 sequential creates: 24
     * definitions and 96 steps). IDs are generated here instead of left to
     * the database default specifically so the step rows can name their
     * definition without waiting on a round trip to learn its id.
     */
    const definitions = WORKFLOW_TYPES.map((spec) => ({
      id: randomUUID(),
      companyId,
      transactionType: spec.type,
      name: `${spec.name} — standard approval`,
      description:
        'Company-wide default route. Add a narrower definition to give a ' +
        'branch, farm or cost centre its own ladder.',
      autoPostOnApproval: spec.autoPost,
      effectiveFrom: new Date('2026-01-01'),
    }));
    await tx.workflowDefinition.createMany({ data: definitions });

    const steps = definitions.flatMap((definition) =>
      APPROVAL_LADDER.map((rung) => ({
        definitionId: definition.id,
        level: rung.level,
        roleCode: rung.roleCode,
        name: rung.name,
        maxAmountKobo: rung.maxAmountKobo,
      })),
    );
    await tx.workflowStep.createMany({ data: steps });

    await tx.workflowEscalationRule.create({
      data: {
        companyId,
        transactionType: null,
        remindAfterHours: 24,
        notifyManagerAfterHours: 48,
        escalateAfterHours: 72,
      },
    });
  }

  /**
   * The current financial year and its twelve periods, all open.
   *
   * Without these the first posting fails. Opening all twelve rather than only
   * the current one is deliberate: a farm signing up in August will record
   * things that happened in July, and making them close a period they never
   * opened to do it would be absurd.
   */
  private async openFinancialYear(
    tx: Prisma.TransactionClient,
    companyId: string,
    startMonth: number,
  ): Promise<void> {
    const now = new Date();
    const month = Math.min(12, Math.max(1, startMonth));
    const startYear = now.getUTCMonth() + 1 >= month ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

    const start = new Date(Date.UTC(startYear, month - 1, 1));
    const end = new Date(Date.UTC(startYear + 1, month - 1, 0));

    const year = await tx.financialYear.create({
      data: {
        companyId,
        code: `FY${startYear}`,
        startDate: start,
        endDate: end,
      },
    });

    const periods = Array.from({ length: 12 }, (_, index) => {
      const periodStart = new Date(Date.UTC(startYear, month - 1 + index, 1));
      const periodEnd = new Date(Date.UTC(startYear, month + index, 0));
      return {
        financialYearId: year.id,
        periodNumber: index + 1,
        name: `${MONTHS[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`,
        startDate: periodStart,
        endDate: periodEnd,
      };
    });
    await tx.financialPeriod.createMany({ data: periods });
  }

  /**
   * Point every domain service's own account resolver at the chart just
   * created, so a freshly registered company can actually post through the
   * three engines that each resolve their own accounts rather than through
   * §66's declarative posting-rule table: biological assets, procurement,
   * and sales. No existence checks, same reasoning as `seedWorkflow`: the
   * company and its chart were both just created in this same transaction.
   */
  private async seedDomainAccountConfiguration(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<void> {
    const accounts = await tx.gLAccount.findMany({
      where: { companyId },
      select: { id: true, accountNumber: true },
    });
    const byNumber = new Map(accounts.map((account) => [account.accountNumber, account.id]));

    // One round trip rather than one per mapping — `seedWorkflow` above alone
    // already runs to nearly a hundred sequential creates in this same
    // transaction, and every extra round trip narrows the margin against
    // Prisma's interactive-transaction timeout under Neon's latency (a
    // recurring pattern this codebase has hit repeatedly elsewhere).
    const rows: Array<{ companyId: string; speciesKey: string; stage: string; glAccountId: string }> = [];
    for (const [speciesKey, stages] of [
      ['snail', SNAIL_STAGE_ACCOUNTS],
      ['poultry', POULTRY_STAGE_ACCOUNTS],
    ] as const) {
      for (const [stage, accountNumber] of Object.entries(stages)) {
        const glAccountId = byNumber.get(accountNumber);
        // Cannot be missing — every code these maps name was just added to
        // ACCOUNTS above — but skip rather than throw if that ever drifts,
        // matching the demo seed's own tolerance for an unmapped stage.
        if (!glAccountId) continue;
        rows.push({ companyId, speciesKey, stage, glAccountId });
      }
    }
    if (rows.length > 0) {
      await tx.biologicalAssetStageAccount.createMany({ data: rows });
    }

    await tx.biologicalAssetConfiguration.create({
      data: {
        companyId,
        abnormalMortalityThresholdPercent: ABNORMAL_MORTALITY_THRESHOLD_PERCENT,
        effectiveFrom: new Date('2026-01-01'),
      },
    });

    /*
     * Procurement and sales BOTH refuse to post — and, unlike biological
     * assets, refuse to even CREATE a goods receipt or a delivery — without
     * their own company-level configuration (`ProcurementConfigService
     * .resolve()` / `SalesPricingService.configuration()` both throw
     * outright: "this system will not make on the company's behalf"). That
     * refusal is the right call for a real policy decision — the three-way
     * match tolerances, whether negative stock is allowed — which is why
     * only the GL accounts are set here and everything else is left to the
     * schema's own conservative defaults (0% tolerance, exact match). But an
     * account is not a policy, it is a fact about the chart just created
     * above, and leaving it unset meant no new company could receive a
     * delivery or raise an invoice AT ALL, with no path to fix it short of
     * an admin screen most farms would not think to look for on day one.
     */
    const grni = byNumber.get('210200');
    const payables = byNumber.get('2201');
    if (grni && payables) {
      await tx.procurementConfiguration.create({
        data: {
          companyId,
          grniGlAccountId: grni,
          payablesGlAccountId: payables,
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }

    const receivable = byNumber.get('1201');
    const revenue = byNumber.get('4101');
    const costOfSales = byNumber.get('5001');
    const finishedGoods = byNumber.get('1401');
    if (receivable && revenue && costOfSales && finishedGoods) {
      await tx.salesConfiguration.create({
        data: {
          companyId,
          receivableGlAccountId: receivable,
          revenueGlAccountId: revenue,
          costOfSalesGlAccountId: costOfSales,
          inventoryGlAccountId: finishedGoods,
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }

    /*
     * The salary components (§7) `EmployeeService.setSalaryComponent()`
     * assigns pay against, and payroll's own statutory deductions post
     * through. Without these, a new company's first attempt to pay anyone
     * fails outright with "Salary component ... is not configured", the
     * same "nowhere to fix it" shape as procurement/sales above — this is
     * the same well-known set `packages/database/src/seed.ts` gives the
     * demo company, applied here so a real signup gets it too rather than
     * only ever getting it from a seed script that never runs against a
     * real tenant.
     */
    await this.seedSalaryComponents(tx, companyId, byNumber);
  }

  private async seedSalaryComponents(
    tx: Prisma.TransactionClient,
    companyId: string,
    byNumber: Map<string, string>,
  ): Promise<void> {
    const earnings = [
      { code: 'BASIC', name: 'Basic salary', taxable: true, pensionable: true, nhfBase: true },
      { code: 'HOUSING', name: 'Housing allowance', taxable: true, pensionable: true, nhfBase: false },
      { code: 'TRANSPORT', name: 'Transport', taxable: true, pensionable: true, nhfBase: false },
      { code: 'UTILITY', name: 'Utility', taxable: true, pensionable: false, nhfBase: false },
      { code: 'MEAL', name: 'Meal', taxable: true, pensionable: false, nhfBase: false },
      { code: 'RESPONSIBILITY', name: 'Responsibility', taxable: true, pensionable: false, nhfBase: false },
      { code: 'LEAVE', name: 'Leave allowance', taxable: true, pensionable: false, nhfBase: false },
      { code: 'BONUS', name: 'Bonus', taxable: true, pensionable: false, nhfBase: false },
      { code: 'OVERTIME', name: 'Overtime', taxable: true, pensionable: false, nhfBase: false },
      { code: 'COMMISSION', name: 'Commission', taxable: true, pensionable: false, nhfBase: false },
    ] as const;

    const salaryExpense = byNumber.get('5101');
    const salaryPayable = byNumber.get('2101');

    const rows: Prisma.SalaryComponentCreateManyInput[] = earnings.map((spec) => ({
      companyId,
      code: spec.code,
      name: spec.name,
      type: SalaryComponentType.EARNING,
      isTaxable: spec.taxable,
      isPensionable: spec.pensionable,
      isNhfBase: spec.nhfBase,
      isGrossPayComponent: true,
      expenseGlAccountId: salaryExpense ?? null,
      payableGlAccountId: salaryPayable ?? null,
    }));

    const statutory: Array<{
      code: string;
      name: string;
      type: SalaryComponentType;
      payable: string;
      expense?: string;
    }> = [
      { code: 'PAYE', name: 'PAYE', type: SalaryComponentType.DEDUCTION, payable: '2110' },
      { code: 'PENSION-EE', name: 'Employee pension', type: SalaryComponentType.DEDUCTION, payable: '2102' },
      { code: 'NHF', name: 'NHF', type: SalaryComponentType.DEDUCTION, payable: '2103' },
      {
        code: 'PENSION-ER',
        name: 'Employer pension',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        payable: '2102',
        expense: '5102',
      },
      {
        code: 'NSITF',
        name: 'NSITF',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        payable: '2104',
        expense: '5103',
      },
      {
        code: 'ITF',
        name: 'ITF',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        payable: '2105',
        expense: '5104',
      },
    ];

    for (const spec of statutory) {
      rows.push({
        companyId,
        code: spec.code,
        name: spec.name,
        type: spec.type,
        isTaxable: false,
        isPensionable: false,
        isGrossPayComponent: false,
        payableGlAccountId: byNumber.get(spec.payable) ?? null,
        expenseGlAccountId: spec.expense ? (byNumber.get(spec.expense) ?? null) : null,
      });
    }

    await tx.salaryComponent.createMany({ data: rows });
  }

  /** Naira, shared across companies rather than duplicated per tenant. */
  private async nairaCurrency(tx: Prisma.TransactionClient) {
    const existing = await tx.currency.findFirst({ where: { code: 'NGN' } });
    if (existing) return existing;
    return tx.currency.create({
      data: { code: 'NGN', name: 'Nigerian Naira', minorUnitScale: 2 },
    });
  }

  /** A readable code derived from the name, with a suffix if it is taken. */
  private async uniqueCompanyCode(tx: Prisma.TransactionClient, name: string): Promise<string> {
    const base =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6) || 'FARM';

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
      const clash = await tx.company.findUnique({ where: { code: candidate } });
      if (!clash) return candidate;
    }
    // Vanishingly unlikely, and better than looping forever.
    return `${base}${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }
}
