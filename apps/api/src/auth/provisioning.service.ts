import { Injectable, Logger } from '@nestjs/common';
import { AccountType, NormalBalance, Prisma, WarehouseType } from '@bioassetpro/database';

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
  { number: '5305', name: 'Production Loss Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT, requiresCostCentre: true },
  { number: '5401', name: 'Operating Expenses', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
];

/** Enough hierarchy to attribute farm costs. The farm can add its own. */
const COST_CENTRES = [
  { code: '100', name: 'Corporate' },
  { code: '130', name: 'Farm Operations', parent: '100' },
];

const WAREHOUSES = [
  { code: 'RAW-WH', name: 'Feed & Supplies Store', type: WarehouseType.RAW_MATERIAL },
  { code: 'FG-WH', name: 'Produce Store', type: WarehouseType.FINISHED_GOODS },
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

    for (const account of ACCOUNTS) {
      await tx.gLAccount.create({
        data: {
          companyId: company.id,
          accountNumber: account.number,
          name: account.name,
          accountType: account.type,
          normalBalance: account.normal,
          requiresCostCentre: account.requiresCostCentre ?? false,
        },
      });
    }

    const farm = await tx.farm.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        code: 'MAIN',
        name: input.farmName.trim(),
      },
    });

    for (const warehouse of WAREHOUSES) {
      await tx.warehouse.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          code: warehouse.code,
          name: warehouse.name,
          type: warehouse.type,
        },
      });
    }

    await this.openFinancialYear(tx, company.id, input.financialYearStartMonth ?? 1);

    this.logger.log(`Provisioned ${company.name} (${code})`);
    return { companyId: company.id, branchId: branch.id, farmId: farm.id };
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

    for (let index = 0; index < 12; index += 1) {
      const periodStart = new Date(Date.UTC(startYear, month - 1 + index, 1));
      const periodEnd = new Date(Date.UTC(startYear, month + index, 0));
      await tx.financialPeriod.create({
        data: {
          financialYearId: year.id,
          periodNumber: index + 1,
          name: `${MONTHS[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`,
          startDate: periodStart,
          endDate: periodEnd,
        },
      });
    }
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
