import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { ProvisioningService } from '../../src/auth/provisioning.service';
import { FarmStructureService } from '../../src/masters/farm-structure.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The workbook's approved species and breeds (SNAIL_SPECIES_MASTER,
 * POULTRY_BREED_MASTER) — AGE_GLOSSARY_CHECKS "Approved species rows".
 */

let prisma: PrismaService;
let structure: FarmStructureService;
let fixture: TestFixture;

beforeAll(() => {
  prisma = new PrismaService();
  structure = new FarmStructureService(prisma, new AuditService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
});

describe('Approved species and breeds (SNAIL_SPECIES_MASTER, POULTRY_BREED_MASTER)', () => {
  it('gives a newly registered farm the workbook’s species and breeds, with their stage ages and status', async () => {
    const { companyId } = await prisma.$transaction((tx) => new ProvisioningService().provisionCompany(tx, { farmName: 'New Farm' }), { timeout: 60_000 });
    const breeds = await prisma.speciesBreed.findMany({ where: { companyId }, include: { stages: { orderBy: { sortOrder: 'asc' } } } });

    expect(breeds.filter((b) => b.speciesKey === 'snail').map((b) => b.code).sort()).toEqual(['SNL-AA', 'SNL-AF', 'SNL-AM', 'SNL-CA']);
    expect(breeds.filter((b) => b.speciesKey === 'poultry').map((b) => b.code).sort()).toEqual(['BR-BREED-01', 'BR-BROIL-01', 'BR-BROIL-02', 'BR-LAYER-01', 'BR-LAYER-02']);

    const marginata = breeds.find((b) => b.code === 'SNL-AM')!;
    expect(marginata.name).toBe('Archachatina marginata');
    expect(marginata.stages.map((s) => [s.stageName, s.minDay])).toEqual([
      ['Egg', 0], ['Hatchling', 0], ['Juvenile', 30], ['Grower', 90], ['Market-ready', 240], ['Breeder', 240],
    ]);
    // The invasive species carries its warning.
    expect(breeds.find((b) => b.code === 'SNL-AF')).toMatchObject({ status: 'Restricted by jurisdiction', controlNote: 'Check local invasive-species rules' });
    expect(breeds.find((b) => b.code === 'BR-BROIL-01')!.stages.map((s) => [s.stageName, s.minDay])).toEqual([['Chick', 0], ['Grower', 15], ['Market-ready', 42]]);
  });

  it('loads them for a farm registered before, adding only what it lacks and changing nothing it has', async () => {
    const actor = { userId: fixture.makerId, roles: ['FARM_MANAGER'] };
    // The farm already keeps Ross 308, with its own ages.
    await structure.createSpeciesBreed({
      companyId: fixture.companyId, actor, speciesKey: 'poultry', code: 'BR-BROIL-01', name: 'Ross 308 (our line)', openingStage: 'Chick',
      stages: [{ stageName: 'Chick', minDay: 0 }, { stageName: 'Market-ready', minDay: 38 }],
    });

    const first = await structure.loadStandardBreeds({ companyId: fixture.companyId, actor, speciesKeys: ['poultry'] });
    expect(first.added.sort()).toEqual(['BR-BREED-01', 'BR-BROIL-02', 'BR-LAYER-01', 'BR-LAYER-02']);
    const ours = await prisma.speciesBreed.findFirstOrThrow({ where: { companyId: fixture.companyId, code: 'BR-BROIL-01' }, include: { stages: true } });
    expect(ours.name).toBe('Ross 308 (our line)');
    expect(ours.stages.find((s) => s.stageName === 'Market-ready')!.minDay).toBe(38);
    // Only the species asked for.
    expect(await prisma.speciesBreed.count({ where: { companyId: fixture.companyId, speciesKey: 'snail' } })).toBe(0);

    // Again: nothing to add, and the load is on the audit trail once.
    expect((await structure.loadStandardBreeds({ companyId: fixture.companyId, actor, speciesKeys: ['poultry'] })).added).toEqual([]);
    expect(await prisma.auditRecord.count({ where: { companyId: fixture.companyId, entityType: 'SpeciesBreed', comments: { startsWith: 'Loaded' } } })).toBe(1);
  });
});
