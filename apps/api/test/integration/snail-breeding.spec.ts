import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { SnailBreedingService } from '../../src/snail-breeding/snail-breeding.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

let prisma: PrismaService;
let breeding: SnailBreedingService;
let fixture: TestFixture;
let breederId: string;

beforeAll(() => {
  prisma = new PrismaService();
  breeding = new SnailBreedingService(prisma, new AuditService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  await prisma.snailBreedingCycle.deleteMany({});
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'SN-P1', name: 'Snail pen 1' } });
  const breeder = await prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId,
      branchId: fixture.branchId,
      farmId: fixture.farmId,
      penHouseId: pen.id,
      code: 'SN-BRD',
      speciesKey: 'snail',
      breed: 'Achatina achatina',
      purpose: 'Breeding',
      stage: 'Breeder',
      openingPopulation: 300,
      population: 300,
      startedOn: new Date('2026-01-01'),
    },
  });
  breederId = breeder.id;
});

const base = () => ({
  companyId: fixture.companyId,
  actorId: fixture.makerId,
  breederGroupId: breederId,
  setOn: '2026-03-01',
});

describe('SnailBreedingService', () => {
  it('records a cycle, then places its hatchlings as their own cohort at no cost', async () => {
    const { id } = await breeding.record({ ...base(), code: 'bc-1', breeders: 250, eggsLaid: 400 });

    const { hatchlingGroupId } = await breeding.hatch({
      companyId: fixture.companyId, actorId: fixture.makerId, cycleId: id,
      hatchedOn: '2026-03-28', hatchedCount: 340, unhatchedCount: 60, hatchlingGroupCode: 'SN-HT1',
    });

    const group = await prisma.livestockGroup.findUniqueOrThrow({ where: { id: hatchlingGroupId! } });
    expect(group).toMatchObject({ speciesKey: 'snail', stage: 'Hatchling', population: 340, acquisitionCostKobo: 0n });

    const [cycle] = await breeding.list(fixture.companyId);
    expect(cycle).toMatchObject({ code: 'BC-1', status: 'HATCHED', hatchRate: 85, hatchlingGroupCode: 'SN-HT1' });
  });

  it('refuses a hatch that does not account for every egg', async () => {
    const { id } = await breeding.record({ ...base(), code: 'BC-2', breeders: 250, eggsLaid: 400 });
    await expect(
      breeding.hatch({
        companyId: fixture.companyId, actorId: fixture.makerId, cycleId: id,
        hatchedOn: '2026-03-28', hatchedCount: 340, unhatchedCount: 50, hatchlingGroupCode: 'SN-HT2',
      }),
    ).rejects.toThrow(/Every egg has to be one or the other/);
  });

  it('refuses more breeders than the cohort has, and a second hatch of the same cycle', async () => {
    await expect(breeding.record({ ...base(), code: 'BC-3', breeders: 301, eggsLaid: 10 })).rejects.toThrow(/300 snails/);

    const { id } = await breeding.record({ ...base(), code: 'BC-4', breeders: 10, eggsLaid: 10 });
    await breeding.fail({ companyId: fixture.companyId, actorId: fixture.makerId, cycleId: id, reason: 'Flooded' });
    await expect(
      breeding.hatch({
        companyId: fixture.companyId, actorId: fixture.makerId, cycleId: id,
        hatchedOn: '2026-03-28', hatchedCount: 0, unhatchedCount: 10,
      }),
    ).rejects.toThrow(/already failed/);
  });
});
