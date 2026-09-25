import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { OperationsService } from '../../src/operations/operations.service';
import { BatchProfileService } from '../../src/operations/batch-profile.service';
import { FarmStructureService } from '../../src/masters/farm-structure.service';
import type { OperationsPostingService } from '../../src/operations/operations-posting.service';
import type { BiologicalAssetService } from '../../src/biological-assets/biological-asset.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Cohort and flock setup (UAT-010 / UAT-016): a batch is placed once under its
 * code, into a house with room for it; a duplicate or an overfull house is
 * refused, saying what would fit.
 */

let prisma: PrismaService;
let operations: OperationsService;
let structure: FarmStructureService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  // The ledger side of placement and transfer is not under test here.
  const assets = {
    postAcquisition: async () => ({ posted: false }),
    assertStageAgeEligible: async () => undefined,
    postStageTransfer: async () => ({ posted: false }),
    postMortality: async () => ({ posted: false }),
    rearing: { transfer: async () => undefined, relieve: async () => undefined },
  } as unknown as BiologicalAssetService;
  operations = new OperationsService(
    prisma, new IdempotencyService(prisma), audit,
    { postFeedIssues: async () => ({ posted: 0, skipped: [] }) } as unknown as OperationsPostingService,
    assets, new BatchProfileService(prisma, audit),
  );
  structure = new FarmStructureService(prisma, audit);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['FARM_MANAGER'] };
  await structure.createPen({ companyId: fixture.companyId, actor, farmId: fixture.farmId, code: 'H1', name: 'House 1', capacity: 500 });
  await structure.createPen({ companyId: fixture.companyId, actor, farmId: fixture.farmId, code: 'H2', name: 'House 2', capacity: 300 });
});

const place = (code: string, house: string, birds: number) =>
  operations.placeGroup({
    companyId: fixture.companyId, actor, idempotencyKey: `place-${code}-${house}-${birds}`,
    payload: { module: 'poultry', code, breed: 'Ross 308', purpose: 'Broiler', stage: 'Chick', house, openingPopulation: birds, startedOn: '2026-02-01' },
  });

describe('Placement (UAT-010 / UAT-016)', () => {
  it('places a batch into a house with room, and shows what the house holds', async () => {
    await place('FLK-BR-001', 'H1', 450);
    const pens = await structure.listPens(fixture.companyId);
    expect(pens.find((p) => p.code === 'H1')).toMatchObject({ capacity: 500, occupancy: 450 });
  });

  it('refuses a duplicate batch code, and a house over capacity, saying what would fit', async () => {
    await place('FLK-BR-001', 'H1', 450);
    await expect(place('FLK-BR-001', 'H2', 100)).rejects.toThrow(/already a batch called FLK-BR-001, placed on 2026-02-01/);
    await expect(place('FLK-BR-002', 'H1', 100)).rejects.toThrow(
      /House 1 holds 500 and has 450 in it; adding 100 would make 550\. Put 50 or fewer here/,
    );
    expect(await prisma.livestockGroup.count({ where: { companyId: fixture.companyId } })).toBe(1);
  });

  it('refuses to move a batch into a house it will not fit', async () => {
    await place('FLK-BR-001', 'H1', 450);
    await expect(
      operations.recordStageChange({
        companyId: fixture.companyId, actor, idempotencyKey: 'move-1',
        payload: { groupCode: 'FLK-BR-001', date: '2026-02-20', fromStage: 'Chick', toStage: 'Grower', fromHouse: 'H1', toHouse: 'H2' },
      }),
    ).rejects.toThrow(/House 2 holds 300 and has 0 in it; adding 450 would make 450/);
  });

  it('will not set a capacity below what is already in the house', async () => {
    await place('FLK-BR-001', 'H1', 450);
    const h1 = (await structure.listPens(fixture.companyId)).find((p) => p.code === 'H1')!;
    await expect(structure.setPenCapacity({ companyId: fixture.companyId, penId: h1.id, capacity: 400, actor })).rejects.toThrow(/450 animals in it now/);
    await structure.setPenCapacity({ companyId: fixture.companyId, penId: h1.id, capacity: null, actor });
    await place('FLK-BR-002', 'H1', 5_000); // no limit now
  });
});
