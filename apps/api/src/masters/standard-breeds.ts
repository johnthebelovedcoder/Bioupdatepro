import type { Prisma, PrismaClient } from '@bioassetpro/database';

/**
 * The workbook's approved species and breeds (SNAIL_SPECIES_MASTER,
 * POULTRY_BREED_MASTER, v8.9.8), with the age each stage starts at.
 *
 * Until 2026-09-27 only the demo seed loaded these, so a farm that
 * registered through the app kept breeds free-hand with no stage ages to
 * check a move against (AGE_GLOSSARY_CHECKS "Approved species rows").
 * Registration now loads them, and Admin → Breeds loads them for a farm that
 * registered before. The same figures as packages/database/src/seed.ts.
 *
 * Stage names are only recorded where they match a stage the module
 * registry declares (apps/web/src/lib/modules.ts); a threshold the sheet
 * gives under a generic heading ("Stage 3 min day") with no matching stage
 * is left out rather than guessed. The thresholds are the workbook's
 * illustrative ones — each row's control note says so, and a farm edits them.
 */
interface StandardBreed {
  speciesKey: 'snail' | 'poultry';
  code: string;
  name: string;
  classification: string;
  openingStage: string;
  status: string;
  controlNote: string;
  stages: Array<[stageName: string, minDay: number]>;
}

const snail = (code: string, name: string, classification: string, [juvenile, grower, mature]: [number, number, number], status: string, controlNote: string): StandardBreed => ({
  speciesKey: 'snail',
  code,
  name,
  classification,
  openingStage: 'Egg',
  status,
  controlNote,
  // The sheet's "Mature min day" is the threshold for either end of the
  // line after Grower — sold as market-ready, or kept to breed.
  stages: [['Egg', 0], ['Hatchling', 0], ['Juvenile', juvenile], ['Grower', grower], ['Market-ready', mature], ['Breeder', mature]],
});

const poultry = (code: string, name: string, classification: string, stages: Array<[string, number]>, status: string, controlNote: string): StandardBreed => ({
  speciesKey: 'poultry',
  code,
  name,
  classification,
  openingStage: 'Chick',
  status,
  controlNote,
  stages: [['Chick', 0], ...stages],
});

const ILLUSTRATIVE = 'Illustrative age thresholds — specialist approval required';
const BROILER = 'Illustrative commercial target; farm standard controls';
const LAYER = 'Point-of-lay and production thresholds configurable';

export const STANDARD_BREEDS: StandardBreed[] = [
  snail('SNL-AM', 'Archachatina marginata', 'African giant land snail', [30, 90, 240], 'Active', ILLUSTRATIVE),
  snail('SNL-AA', 'Achatina achatina', 'Giant Ghana snail / tiger snail', [35, 105, 270], 'Active', ILLUSTRATIVE),
  snail('SNL-AF', 'Lissachatina fulica', 'Giant East African snail', [28, 84, 210], 'Restricted by jurisdiction', 'Check local invasive-species rules'),
  snail('SNL-CA', 'Cornu aspersum', 'Garden snail / petit-gris family', [28, 75, 180], 'Country configuration', 'Illustrative; seasonal system may override'),
  poultry('BR-BROIL-01', 'Ross 308', 'Broiler', [['Grower', 15], ['Market-ready', 42]], 'Active', BROILER),
  poultry('BR-BROIL-02', 'Cobb 500', 'Broiler', [['Grower', 15], ['Market-ready', 42]], 'Active', BROILER),
  // The sheet's output stage for a layer is "Laying"; the module calls it "Layer".
  poultry('BR-LAYER-01', 'ISA Brown', 'Layer', [['Pullet', 42], ['Point-of-lay', 126], ['Layer', 140]], 'Active', LAYER),
  poultry('BR-LAYER-02', 'Lohmann Brown', 'Layer', [['Pullet', 42], ['Point-of-lay', 126], ['Layer', 140]], 'Active', LAYER),
  // Its day-140/168 "Breeder production" stages have no module stage yet.
  poultry('BR-BREED-01', 'Parent stock', 'Breeder', [['Grower', 42]], 'Controlled', 'Specialist breeding programme required'),
];

/**
 * Adds the standard breeds a company does not have yet, for the species
 * named. Never touches a breed already there — a farm's own edits to a
 * code it already has stand. Returns the codes added.
 */
export async function loadStandardBreeds(
  client: PrismaClient | Prisma.TransactionClient,
  companyId: string,
  speciesKeys: string[] = ['snail', 'poultry'],
): Promise<string[]> {
  const wanted = STANDARD_BREEDS.filter((b) => speciesKeys.includes(b.speciesKey));
  const existing = await client.speciesBreed.findMany({
    where: { companyId, speciesKey: { in: speciesKeys } },
    select: { speciesKey: true, code: true },
  });
  const have = new Set(existing.map((b) => `${b.speciesKey}:${b.code}`));
  const added: string[] = [];
  for (const breed of wanted) {
    if (have.has(`${breed.speciesKey}:${breed.code}`)) continue;
    await client.speciesBreed.create({
      data: {
        companyId,
        speciesKey: breed.speciesKey,
        code: breed.code,
        name: breed.name,
        classification: breed.classification,
        openingStage: breed.openingStage,
        status: breed.status,
        controlNote: breed.controlNote,
        stages: { createMany: { data: breed.stages.map(([stageName, minDay], sortOrder) => ({ stageName, minDay, sortOrder })) } },
      },
    });
    added.push(breed.code);
  }
  return added;
}
