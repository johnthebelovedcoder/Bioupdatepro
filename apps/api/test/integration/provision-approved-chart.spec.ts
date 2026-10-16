import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProvisioningService } from '../../src/auth/provisioning.service';
import { resetDatabase } from '../helpers/test-db';
import {
  APPROVED_PROCUREMENT_DEFAULTS,
  APPROVED_SALES_DEFAULTS,
  numberFor,
} from '../../src/chart/chart';

/**
 * A farm that registers today starts on the client's approved chart.
 *
 * Before this, every new farm was provisioned on the 44-account four-digit
 * chart and could only reach the approved one through the balance cutover —
 * which needs Finance's signed crosswalk. A client with no history at all
 * would have been made to migrate balances it never had, and until it did its
 * books would carry two generations of account numbers at once.
 */

let prisma: PrismaService;
let provisioning: ProvisioningService;

beforeAll(() => {
  prisma = new PrismaService();
  provisioning = new ProvisioningService();
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
});

const provision = (chart?: 'LEGACY' | 'APPROVED') =>
  prisma.$transaction(
    (tx) => provisioning.provisionCompany(tx, { farmName: 'Fresh Farm', ...(chart ? { chart } : {}) }),
    { timeout: 60_000 },
  );

describe('Provisioning a new farm on the approved five-digit chart', () => {
  it('is what a farm gets by default, with no four- or six-digit account anywhere in its books', async () => {
    const { companyId } = await provision();

    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).chartVersion).toBe('APPROVED');

    const accounts = await prisma.gLAccount.findMany({
      where: { companyId },
      select: { accountNumber: true, name: true, requiresCostCentre: true, isPostingAccount: true },
    });
    expect(accounts.length).toBe(137);
    expect(accounts.every((account) => /^\d{5}$/.test(account.accountNumber))).toBe(true);

    // The workbook's own metadata came across, not just the numbers: a
    // chart of 137 active posting accounts with no cost-centre rules would
    // post, and post wrongly.
    expect(accounts.filter((account) => account.requiresCostCentre).length).toBe(104);
    expect(accounts.filter((account) => !account.isPostingAccount).length).toBeGreaterThan(0);
    expect(accounts.find((account) => account.accountNumber === '52800')?.name).toMatch(/impairment/i);
  });

  it('gives it the workbook cost centres, including one that allows posting', async () => {
    const { companyId } = await provision();

    const centres = await prisma.costCentre.findMany({
      where: { companyId },
      select: { code: true, parentId: true, postingAllowed: true, businessUnit: true },
    });
    expect(centres.length).toBe(57);
    // 104 of the accounts refuse a line with no cost centre, so a farm with
    // no postable centre could raise documents and never approve one.
    expect(centres.some((centre) => centre.postingAllowed)).toBe(true);
    expect(centres.filter((centre) => centre.parentId !== null).length).toBeGreaterThan(0);
    expect(centres.find((centre) => centre.code === 'COR-FIN')?.businessUnit).toBeTruthy();
  });

  it('points sales, procurement, payroll and the livestock stages at approved accounts', async () => {
    const { companyId } = await provision();
    const number = (account: { accountNumber: string } | null) => account?.accountNumber ?? null;

    const sales = await prisma.salesConfiguration.findFirstOrThrow({
      where: { companyId },
      include: { receivableAccount: true, revenueAccount: true, costOfSalesAccount: true, inventoryAccount: true },
    });
    expect([sales.receivableAccount, sales.revenueAccount, sales.costOfSalesAccount, sales.inventoryAccount].map(number)).toEqual([
      APPROVED_SALES_DEFAULTS.receivable,
      APPROVED_SALES_DEFAULTS.revenue,
      APPROVED_SALES_DEFAULTS.costOfSales,
      APPROVED_SALES_DEFAULTS.inventory,
    ]);

    const procurement = await prisma.procurementConfiguration.findFirstOrThrow({
      where: { companyId },
      include: { grniAccount: true, payablesAccount: true },
    });
    expect([number(procurement.grniAccount), number(procurement.payablesAccount)]).toEqual([
      APPROVED_PROCUREMENT_DEFAULTS.grni,
      APPROVED_PROCUREMENT_DEFAULTS.payables,
    ]);

    const components = await prisma.salaryComponent.findMany({
      where: { companyId },
      include: { payableGlAccount: true, expenseGlAccount: true },
    });
    expect(components.length).toBeGreaterThan(0);
    for (const component of components) {
      for (const account of [component.payableGlAccount, component.expenseGlAccount]) {
        if (account) expect(account.accountNumber).toMatch(/^\d{5}$/);
      }
    }
    expect(number(components.find((component) => component.code === 'PAYE')?.payableGlAccount ?? null)).toBe(
      numberFor('APPROVED', 'payePayable'),
    );

    // Livestock carrying accounts follow the stage's maturity on this chart:
    // 16031/16041 for snails, 16032/16042 for poultry.
    const stages = await prisma.biologicalAssetStageAccount.findMany({
      where: { companyId },
      include: { glAccount: true },
    });
    expect(stages.length).toBeGreaterThan(0);
    const accountFor = (speciesKey: string, stage: string) =>
      number(stages.find((row) => row.speciesKey === speciesKey && row.stage === stage)?.glAccount ?? null);
    expect(accountFor('poultry', 'Chick')).toBe('16032');
    expect(accountFor('poultry', 'Layer')).toBe('16042');
    expect(accountFor('snail', 'Juvenile')).toBe('16031');
    expect(accountFor('snail', 'Breeder')).toBe('16041');
  });

  it('still provisions the four-digit chart when a caller asks for it', async () => {
    const { companyId } = await provision('LEGACY');

    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).chartVersion).toBe('LEGACY');
    const accounts = await prisma.gLAccount.findMany({ where: { companyId }, select: { accountNumber: true } });
    expect(accounts.some((account) => /^\d{4}$/.test(account.accountNumber))).toBe(true);
    expect(accounts.some((account) => /^\d{5}$/.test(account.accountNumber))).toBe(false);
  });
});
