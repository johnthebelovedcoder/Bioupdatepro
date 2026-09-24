import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { PostingControlService } from '../../src/posting-control/posting-control.service';
import { PostingControlChecksService } from '../../src/posting-control/posting-control-checks.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * A company that never had the posting rules — every farm that signed up —
 * gets the same rules, keys and specification chart the demo seed loads.
 */

let prisma: PrismaService;
let provisioning: PostingControlProvisioningService;
let checks: PostingControlChecksService;
let fixture: TestFixture;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  provisioning = new PostingControlProvisioningService(prisma, audit);
  checks = new PostingControlChecksService(prisma, new PostingControlService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  await prisma.postingRule.deleteMany({});
  await prisma.postingKey.deleteMany({});
  fixture = await seedFixture(prisma as unknown as PrismaClient);
});

describe('PostingControlProvisioningService', () => {
  it('loads every rule and key into a company that had none, and the load checks pass', async () => {
    const before = await provisioning.status(fixture.companyId);
    expect(before).toMatchObject({ loaded: false, rules: 0, keys: 0 });

    const result = await provisioning.provision(fixture.companyId, fixture.makerId);
    expect(result.rules).toBe(86);
    expect(result.keys).toBe(172);
    // The workbook names 68 distinct six-digit accounts; 132 keys point at one.
    expect(result.accountsCreated).toBe(68);
    expect(result.linked).toBe(132);

    expect(await provisioning.status(fixture.companyId)).toMatchObject({ loaded: true, rules: 86, keys: 172 });

    const run = await checks.run(fixture.companyId);
    const failing = run.rows.filter((row) => ['PCC-01', 'PCC-02', 'PCC-03', 'PCC-04', 'PCC-05'].includes(row.id) && row.state !== 'PASS');
    expect(failing).toEqual([]);

    // Feed, treatments and live sales resolve through the farm postings; what
    // stays blocked is labour/overhead/depreciation allocation and egg
    // valuation — modules not built, and policies the farm has not chosen.
    const rules = run.rows.find((row) => row.id === 'PCC-09')!;
    expect(rules.found).toBe('58 through this table, 23 by dedicated code, 5 blocked');
    expect(rules.next).toContain('PCR-028, PCR-031, PCR-043, PCR-064, PCR-067.');
  });

  it('adds accounts without touching the ones a company already has', async () => {
    const before = await prisma.gLAccount.findMany({
      where: { companyId: fixture.companyId },
      select: { id: true, accountNumber: true, name: true, accountType: true },
      orderBy: { accountNumber: 'asc' },
    });

    await provisioning.provision(fixture.companyId, fixture.makerId);

    const after = await prisma.gLAccount.findMany({
      where: { companyId: fixture.companyId, id: { in: before.map((a) => a.id) } },
      select: { id: true, accountNumber: true, name: true, accountType: true },
      orderBy: { accountNumber: 'asc' },
    });
    expect(after).toEqual(before);
  });

  it('is safe to run twice', async () => {
    const first = await provisioning.provision(fixture.companyId, fixture.makerId);
    const accounts = await prisma.gLAccount.count({ where: { companyId: fixture.companyId } });

    const second = await provisioning.provision(fixture.companyId, fixture.makerId);

    expect(second.accountsCreated).toBe(0);
    expect(second.linked).toBe(first.linked);
    expect(await prisma.gLAccount.count({ where: { companyId: fixture.companyId } })).toBe(accounts);
    expect(await prisma.postingRule.count({ where: { companyId: fixture.companyId } })).toBe(86);
  });
});
