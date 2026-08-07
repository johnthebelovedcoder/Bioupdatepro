import { execSync } from 'node:child_process';
import { PrismaClient } from '@bioassetpro/database';

/**
 * Integration tests run against a real Postgres (PGlite over the wire
 * protocol, started by the vitest global setup). That is deliberate: the
 * immutability triggers, the CHECK constraints and the deferred balance
 * assertion are a material part of what Phase 1 delivers, and none of them
 * exist against a mock.
 */

export interface TestFixture {
  prisma: PrismaClient;
  companyId: string;
  branchId: string;
  currencyId: string;
  financialYearId: string;
  periodIds: string[];
  costCentreId: string;
  farmId: string;
  departmentId: string;
  makerId: string;
  checkerId: string;
  financeUserId: string;
  accounts: Record<string, string>;
}

export function pushSchema(): void {
  execSync('npm run push -w @bioassetpro/database', {
    stdio: 'inherit',
    env: process.env,
  });
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // Order matters: audit and journal lines reference everything else.
  // TRUNCATE bypasses the row-level immutability triggers by design — those
  // guard the application's DML, not a test harness reset. Production never
  // runs this.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      workflow_notifications,
      workflow_history,
      workflow_transaction_steps,
      workflow_comments,
      workflow_attachments,
      workflow_transactions,
      workflow_steps,
      workflow_definitions,
      workflow_delegations,
      workflow_escalation_rules,
      audit_records,
      idempotency_records,
      journal_lines,
      journal_entries,
      exchange_rates,
      financial_periods,
      financial_years,
      pen_houses,
      farms,
      warehouses,
      projects,
      cost_centres,
      gl_accounts,
      departments,
      branches,
      companies,
      currencies,
      users
    RESTART IDENTITY CASCADE;
  `);
}

/**
 * A minimal but realistic company: one branch, one farm, the workbook's WIP and
 * inventory accounts, an open financial year, and three users whose roles
 * matter to the period gate and (from Phase 2) maker-checker.
 */
export async function seedFixture(prisma: PrismaClient): Promise<TestFixture> {
  const currency = await prisma.currency.create({
    data: { code: 'NGN', name: 'Nigerian Naira', minorUnitScale: 2 },
  });

  const company = await prisma.company.create({
    data: {
      code: 'TEST',
      name: 'Test Farms Ltd',
      baseCurrencyId: currency.id,
    },
  });

  const branch = await prisma.branch.create({
    data: { companyId: company.id, code: 'MAIN', name: 'Main Site' },
  });

  const department = await prisma.department.create({
    data: { companyId: company.id, code: 'PROD', name: 'Production' },
  });

  const costCentre = await prisma.costCentre.create({
    data: {
      companyId: company.id,
      code: 'SN-SLIME',
      name: 'SN SLIME',
      branchId: branch.id,
      departmentId: department.id,
      effectiveDate: new Date('2026-01-01'),
    },
  });

  const farm = await prisma.farm.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      code: 'MAIN-FARM',
      name: 'Main Farm',
    },
  });

  const year = await prisma.financialYear.create({
    data: {
      companyId: company.id,
      code: 'FY2026',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });

  const periodIds: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const period = await prisma.financialPeriod.create({
      data: {
        financialYearId: year.id,
        periodNumber: i + 1,
        name: `Period ${i + 1} 2026`,
        startDate: new Date(Date.UTC(2026, i, 1)),
        endDate: new Date(Date.UTC(2026, i + 1, 0)),
      },
    });
    periodIds.push(period.id);
  }

  const accountSpecs = [
    { number: '1301', name: 'Raw Material Inventory', type: 'ASSET', normal: 'DEBIT', cc: false },
    { number: '1305', name: 'By-product Inventory', type: 'ASSET', normal: 'DEBIT', cc: false },
    { number: '1401', name: 'Finished Goods Inventory', type: 'ASSET', normal: 'DEBIT', cc: false },
    { number: '1501', name: 'Work in Progress', type: 'ASSET', normal: 'DEBIT', cc: true },
    { number: '5205', name: 'Payroll/Overhead Clearing', type: 'EXPENSE', normal: 'CREDIT', cc: false },
    { number: '5305', name: 'Production Loss Expense', type: 'EXPENSE', normal: 'DEBIT', cc: true },
    { number: '1101', name: 'Bank', type: 'ASSET', normal: 'DEBIT', cc: false },
  ] as const;

  const accounts: Record<string, string> = {};
  for (const spec of accountSpecs) {
    const account = await prisma.gLAccount.create({
      data: {
        companyId: company.id,
        accountNumber: spec.number,
        name: spec.name,
        accountType: spec.type,
        normalBalance: spec.normal,
        requiresCostCentre: spec.cc,
      },
    });
    accounts[spec.number] = account.id;
  }

  // A summary (non-posting) account, to prove the poster refuses it.
  const summary = await prisma.gLAccount.create({
    data: {
      companyId: company.id,
      accountNumber: '1000',
      name: 'Current Assets (summary)',
      accountType: 'ASSET',
      normalBalance: 'DEBIT',
      isPostingAccount: false,
    },
  });
  accounts['1000'] = summary.id;

  // An inactive account, to prove the poster refuses that too.
  const inactive = await prisma.gLAccount.create({
    data: {
      companyId: company.id,
      accountNumber: '9999',
      name: 'Retired Account',
      accountType: 'EXPENSE',
      normalBalance: 'DEBIT',
      active: false,
    },
  });
  accounts['9999'] = inactive.id;

  const maker = await prisma.user.create({
    data: {
      email: 'maker@test.local',
      fullName: 'Maker User',
      passwordHash: 'x',
      roles: ['PRODUCTION_SUPERVISOR'],
    },
  });
  const checker = await prisma.user.create({
    data: {
      email: 'checker@test.local',
      fullName: 'Checker User',
      passwordHash: 'x',
      roles: ['FARM_MANAGER'],
    },
  });
  const financeUser = await prisma.user.create({
    data: {
      email: 'finance@test.local',
      fullName: 'Finance Manager',
      passwordHash: 'x',
      roles: ['FINANCE_MANAGER'],
    },
  });

  return {
    prisma,
    companyId: company.id,
    branchId: branch.id,
    currencyId: currency.id,
    financialYearId: year.id,
    periodIds,
    costCentreId: costCentre.id,
    farmId: farm.id,
    departmentId: department.id,
    makerId: maker.id,
    checkerId: checker.id,
    financeUserId: financeUser.id,
    accounts,
  };
}

/** Dimension block for a line, defaulted from the fixture. */
export function dims(
  fixture: TestFixture,
  periodIndex = 0,
  overrides: Record<string, unknown> = {},
) {
  return {
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[periodIndex] as string,
    currencyId: fixture.currencyId,
    exchangeRate: '1.00000000',
    ...overrides,
  };
}
