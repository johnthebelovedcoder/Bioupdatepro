import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RetentionService } from '../../src/retention/retention.service';
import { eligibleBefore, RETENTION_SCHEDULE } from '../../src/retention/retention';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Record retention: a schedule for every kind of record, a report of what the
 * company holds against it, and nothing deleted — records past their minimum
 * are only flagged for the company to review.
 */
describe('Record retention', () => {
  let prisma: PrismaService;
  let fixture: TestFixture;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);
  });

  it('counts the minimum from the start of the calendar year six years back', () => {
    expect(eligibleBefore(6, new Date('2026-09-27')).toISOString().slice(0, 10)).toBe('2020-01-01');
  });

  it('reports every record type against the schedule, flags what is past its minimum, and deletes nothing', async () => {
    const today = new Date('2026-09-27');
    await prisma.employee.create({
      data: {
        companyId: fixture.companyId,
        employeeNumber: 'EMP-OLD',
        firstName: 'Former',
        surname: 'Worker',
        employmentDate: new Date('2012-01-01'),
        exitDate: new Date('2018-06-30'),
      },
    });
    await prisma.employee.create({
      data: { companyId: fixture.companyId, employeeNumber: 'EMP-LEFT', firstName: 'Recent', surname: 'Leaver', employmentDate: new Date('2020-01-01'), exitDate: new Date('2025-03-31') },
    });
    await prisma.auditRecord.create({
      data: { companyId: fixture.companyId, transactionId: 'x', module: 'test', entityType: 'Test', entityId: 'x', status: 'OLD', action: 'CREATE', userId: fixture.makerId, occurredAt: new Date('2019-12-31') },
    });
    const auditBefore = await prisma.auditRecord.count({ where: { companyId: fixture.companyId } });

    const report = await new RetentionService(prisma).report(fixture.companyId, today);
    expect(report.deletes).toBe(false);
    expect(report.rules.map((r) => r.key)).toEqual(RETENTION_SCHEDULE.map((r) => r.key));
    expect(report.rules.find((r) => r.key === 'formerEmployees')).toMatchObject({ total: 2, oldest: '2018-06-30', pastMinimum: 1, keptUntilBefore: '2020-01-01' });
    expect(report.rules.find((r) => r.key === 'audit')).toMatchObject({ oldest: '2019-12-31', pastMinimum: 1 });
    expect(report.rules.find((r) => r.key === 'journals')!.after).toMatch(/Never deleted/);
    expect(report.years.length).toBeGreaterThan(0);

    // Reading the report changes nothing.
    expect(await prisma.auditRecord.count({ where: { companyId: fixture.companyId } })).toBe(auditBefore);
    expect(await prisma.employee.count({ where: { companyId: fixture.companyId, exitDate: { not: null } } })).toBe(2);
  });
});
