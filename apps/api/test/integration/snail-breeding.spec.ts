import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { SnailBreedingService } from '../../src/snail-breeding/snail-breeding.service';
import { PostingService } from '../../src/posting/posting.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingControlService } from '../../src/posting-control/posting-control.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

let prisma: PrismaService;
let breeding: SnailBreedingService;
let fixture: TestFixture;
let breederId: string;

beforeAll(() => {
  prisma = new PrismaService();
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  await prisma.snailBreedingCycle.deleteMany({});
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'SPEC' } });
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  const postingControl = new PostingControlService(prisma);
  await new PostingControlProvisioningService(prisma, audit).provision(fixture.companyId, null);
  breeding = new SnailBreedingService(prisma, audit, posting, postingControl);
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

const actor = () => ({ userId: fixture.financeUserId, roles: ['CFO'] });

const base = () => ({
  companyId: fixture.companyId,
  actor: actor(),
  breederGroupId: breederId,
  setOn: '2026-03-01',
  valueBasis: 'FVLCTS' as const,
  valuePerEggKobo: 100n,
  valueEvidence: 'Test market evidence: ₦1 per viable egg',
});

describe('SnailBreedingService', () => {
  it('records viable eggs at FVLCTS, then carries the value into the hatchling cohort', async () => {
    const { id } = await breeding.record({ ...base(), code: 'bc-1', breeders: 250, eggsLaid: 400 });

    const { hatchlingGroupId } = await breeding.hatch({
      companyId: fixture.companyId, actor: actor(), cycleId: id,
      hatchedOn: '2026-03-28', hatchedCount: 340, unhatchedCount: 60, hatchlingGroupCode: 'SN-HT1',
    });

    const group = await prisma.livestockGroup.findUniqueOrThrow({ where: { id: hatchlingGroupId! } });
    expect(group).toMatchObject({ speciesKey: 'snail', stage: 'Hatchling', population: 340, measurementBasis: 'FVLCTS', currentFvlctsPerUnitKobo: 100n });

    const [cycle] = await breeding.list(fixture.companyId);
    expect(cycle).toMatchObject({ code: 'BC-1', status: 'HATCHED', hatchRate: 85, hatchlingGroupCode: 'SN-HT1' });
  });

  it('refuses a hatch that does not account for every egg', async () => {
    const { id } = await breeding.record({ ...base(), code: 'BC-2', breeders: 250, eggsLaid: 400 });
    await expect(
      breeding.hatch({
        companyId: fixture.companyId, actor: actor(), cycleId: id,
        hatchedOn: '2026-03-28', hatchedCount: 340, unhatchedCount: 50, hatchlingGroupCode: 'SN-HT2',
      }),
    ).rejects.toThrow(/Every egg has to be one or the other/);
  });

  it('refuses more breeders than the cohort has, and a second hatch of the same cycle', async () => {
    await expect(breeding.record({ ...base(), code: 'BC-3', breeders: 301, eggsLaid: 10 })).rejects.toThrow(/300 snails/);

    const { id } = await breeding.record({ ...base(), code: 'BC-4', breeders: 10, eggsLaid: 10 });
    await breeding.fail({ companyId: fixture.companyId, actor: actor(), cycleId: id, reason: 'Flooded' });
    await expect(
      breeding.hatch({
        companyId: fixture.companyId, actor: actor(), cycleId: id,
        hatchedOn: '2026-03-28', hatchedCount: 0, unhatchedCount: 10,
      }),
    ).rejects.toThrow(/already failed/);
  });
});
