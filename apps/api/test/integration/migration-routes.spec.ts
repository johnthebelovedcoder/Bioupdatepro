import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetDatabase, seedFixture } from '../helpers/test-db';

/**
 * Migration 0034 gives farms that already exist the approval routes sign-up
 * used to leave out (payroll payment and four more), on the standard ladder,
 * without touching a farm that has its own route for a type.
 */
describe('Migration 0034: missing approval routes', () => {
  let prisma: PrismaService;
  const sql = readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'database', 'prisma', 'migrations', '0034_missing_workflow_routes', 'migration.sql'), 'utf8');

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });
  afterAll(async () => prisma.$disconnect());

  it('adds the five routes to a farm that has the standard ones, once, and leaves a farm’s own route alone', async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    const fixture = await seedFixture(prisma as unknown as PrismaClient);
    const route = (transactionType: string) =>
      prisma.workflowDefinition.create({
        data: { companyId: fixture.companyId, transactionType, name: transactionType, effectiveFrom: new Date('2026-01-01'), steps: { create: [{ level: 1, roleCode: 'CFO', name: 'CFO', maxAmountKobo: null }] } },
      });
    await route('PAYROLL_RUN');
    // The farm already has its own reopen route: kept as it is.
    await route('PERIOD_REOPEN');

    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql);

    const routes = await prisma.workflowDefinition.findMany({ where: { companyId: fixture.companyId }, include: { steps: { orderBy: { level: 'asc' } } } });
    const byType = new Map(routes.map((r) => [r.transactionType, r]));
    for (const type of ['PAYROLL_PAYMENT', 'FIXED_ASSET_DISPOSAL', 'BIOLOGICAL_ASSET_ABNORMAL_MORTALITY', 'PRODUCTION_ORDER_ABNORMAL_LOSS']) {
      expect(routes.filter((r) => r.transactionType === type)).toHaveLength(1);
      expect(byType.get(type)!.steps.map((s) => [s.level, s.roleCode, s.maxAmountKobo])).toEqual([
        [1, 'FARM_MANAGER', 25_000_000n],
        [2, 'FINANCE_MANAGER', 200_000_000n],
        [3, 'FINANCE_CONTROLLER', 1_000_000_000n],
        [4, 'CFO', null],
      ]);
    }
    expect(byType.get('PAYROLL_PAYMENT')!.autoPostOnApproval).toBe(true);
    expect(routes.filter((r) => r.transactionType === 'PERIOD_REOPEN')).toHaveLength(1);
    expect(byType.get('PERIOD_REOPEN')!.steps).toHaveLength(1);
  });
});
