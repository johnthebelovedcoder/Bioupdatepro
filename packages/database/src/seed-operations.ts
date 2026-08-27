/**
 * Operational demo data — populations and the work recorded against them.
 *
 * SEPARATE FROM seed.ts ON PURPOSE. That seed is document-sourced: every
 * account number in it comes from the SnailPro / PoultryPro workbooks and
 * nothing is invented to fill a gap (Rule 10). This one is the opposite kind of
 * thing — an illustrative farm, so the screens have something to show and the
 * write path has populations to append to. It is what the "Demo data" badge in
 * the interface refers to, and no figure here should ever be read as a fact
 * about a real farm.
 *
 * The one rule it holds itself to is INTERNAL CONSISTENCY. Demo data that does
 * not add up becomes a de-facto specification for bugs: this project has
 * already produced a batch whose feed cost more than its total costs, and a
 * cost breakdown summing to 448%. So nothing here is typed in twice. A
 * population's losses are decided first and then spent on mortality and
 * harvests, which means
 *
 *     population = opening - deaths - harvested
 *
 * holds by construction rather than by luck.
 *
 * Run from the repo root:  npm run db:seed:ops
 */

import { PrismaClient, LivestockGroupStatus, HealthEventStatus, Prisma } from '../generated/client';

const prisma = new PrismaClient();

/** Days of history to generate. Enough for the 30-day period filter. */
const WINDOW = 30;

/** Deterministic pseudo-randomness, so two runs produce the same farm. */
function wobble(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function dayAgo(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

interface GroupSeed {
  code: string;
  speciesKey: 'poultry' | 'snail';
  breed: string;
  purpose: string;
  stage: string;
  house: string;
  opening: number;
  current: number;
  ageDays: number;
  source: string;
  /** MONEY, kobo. What the stock cost to acquire. */
  acquisitionKobo: bigint;
  /** Share of the losses that left as harvest rather than death. Snails only. */
  harvestShare?: number;
  /** Eggs per bird per day, where the population lays. */
  layRate?: number;
  feedName: string;
  /** Grams of feed per animal per day. */
  feedGrams: number;
  /** MONEY, kobo per kg of that feed. */
  feedCostPerKgKobo: bigint;
  status?: LivestockGroupStatus;
}

const HOUSES = [
  'Poultry House 1',
  'Poultry House 2',
  'Brooder House',
  'Broiler Pen 1',
  'Broiler Pen 2',
  'Snail Section A',
  'Snail Section B',
  'Snail Nursery',
];

const GROUPS: GroupSeed[] = [
  {
    code: 'L-2026-001',
    speciesKey: 'poultry',
    breed: 'ISA Brown',
    purpose: 'Layer',
    stage: 'Layer',
    house: 'Poultry House 1',
    opening: 2000,
    current: 1945,
    ageDays: 284,
    source: 'CHI Farms',
    acquisitionKobo: 180_000_000n,
    layRate: 0.91,
    feedName: 'Layer mash',
    feedGrams: 115,
    feedCostPerKgKobo: 62_000n,
  },
  {
    code: 'L-2026-003',
    speciesKey: 'poultry',
    breed: 'Lohmann Brown',
    purpose: 'Layer',
    stage: 'Layer',
    house: 'Poultry House 2',
    opening: 2000,
    current: 1950,
    ageDays: 196,
    source: 'CHI Farms',
    acquisitionKobo: 180_000_000n,
    // Deliberately below its breed standard, so the variance and performance
    // screens have something real to flag rather than a farm where all is well.
    layRate: 0.8,
    feedName: 'Layer mash',
    feedGrams: 122,
    feedCostPerKgKobo: 62_000n,
  },
  {
    code: 'L-2026-004',
    speciesKey: 'poultry',
    breed: 'ISA Brown',
    purpose: 'Pullet',
    stage: 'Grower',
    house: 'Brooder House',
    opening: 2500,
    current: 2480,
    ageDays: 63,
    source: 'CHI Farms',
    acquisitionKobo: 212_500_000n,
    feedName: 'Grower mash',
    feedGrams: 68,
    feedCostPerKgKobo: 58_000n,
  },
  {
    code: 'B-2026-007',
    speciesKey: 'poultry',
    breed: 'Cobb 500',
    purpose: 'Broiler',
    stage: 'Grower',
    house: 'Broiler Pen 1',
    opening: 4750,
    current: 4555,
    ageDays: 31,
    source: 'Zartech',
    acquisitionKobo: 356_250_000n,
    feedName: 'Broiler finisher',
    feedGrams: 133,
    feedCostPerKgKobo: 66_000n,
  },
  {
    code: 'B-2026-005',
    speciesKey: 'poultry',
    breed: 'Cobb 500',
    purpose: 'Broiler',
    stage: 'Spent',
    house: 'Broiler Pen 2',
    opening: 4500,
    current: 0,
    ageDays: 48,
    source: 'Zartech',
    acquisitionKobo: 337_500_000n,
    feedName: 'Broiler finisher',
    feedGrams: 0,
    feedCostPerKgKobo: 66_000n,
    status: LivestockGroupStatus.CLOSED,
  },
  {
    code: 'S-001',
    speciesKey: 'snail',
    breed: 'Archachatina marginata',
    purpose: 'Breeder cohort',
    stage: 'Breeder',
    house: 'Snail Section A',
    opening: 3300,
    current: 3200,
    ageDays: 412,
    source: 'Own stock',
    acquisitionKobo: 49_500_000n,
    harvestShare: 0.4,
    feedName: 'Snail feed concentrate',
    feedGrams: 11,
    feedCostPerKgKobo: 41_000n,
  },
  {
    code: 'S-004',
    speciesKey: 'snail',
    breed: 'Achatina achatina',
    purpose: 'Growers',
    stage: 'Grower',
    house: 'Snail Section B',
    opening: 9800,
    current: 9100,
    ageDays: 147,
    source: 'Own stock',
    acquisitionKobo: 147_000_000n,
    harvestShare: 0.7,
    feedName: 'Snail feed concentrate',
    feedGrams: 9,
    feedCostPerKgKobo: 41_000n,
  },
  {
    code: 'S-006',
    speciesKey: 'snail',
    breed: 'Archachatina marginata',
    purpose: 'Juveniles',
    stage: 'Juvenile',
    house: 'Snail Nursery',
    opening: 4520,
    current: 4380,
    ageDays: 54,
    source: 'Own hatchery',
    acquisitionKobo: 45_200_000n,
    feedName: 'Snail feed concentrate',
    feedGrams: 4,
    feedCostPerKgKobo: 41_000n,
  },
  {
    code: 'S-002',
    speciesKey: 'snail',
    breed: 'Lissachatina fulica',
    purpose: 'Growers',
    stage: 'Grower',
    house: 'Snail Section A',
    opening: 6200,
    current: 0,
    ageDays: 168,
    source: 'Own stock',
    acquisitionKobo: 93_000_000n,
    feedName: 'Snail feed concentrate',
    feedGrams: 0,
    feedCostPerKgKobo: 41_000n,
    status: LivestockGroupStatus.CLOSED,
  },
];

/** A standard Nigerian layer/broiler programme, by days from placement. */
const VACCINATIONS = [
  { day: 1, name: "Marek's disease", detail: 'Subcutaneous, at the hatchery' },
  { day: 10, name: 'Gumboro (IBD)', detail: 'Drinking water' },
  { day: 14, name: 'Newcastle (Lasota)', detail: 'Drinking water' },
  { day: 21, name: 'Gumboro booster', detail: 'Drinking water' },
  { day: 28, name: 'Fowl pox', detail: 'Wing web' },
  { day: 56, name: 'Newcastle booster', detail: 'Drinking water' },
];

/**
 * The demo farm is behind on exactly one vaccination.
 *
 * A farm that is perfectly up to date leaves nothing due and nothing overdue,
 * which makes the overdue alert and the record-a-treatment path unreachable —
 * the screens that matter most when something has been missed become the ones
 * nobody ever sees. Being slightly behind is also the ordinary state of a farm.
 */
const MISSED = new Set(['B-2026-007:28']);

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo livestock in production.');
  }

  const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) throw new Error('No company. Run `npm run db:seed` first.');

  const branch = await prisma.branch.findFirst({ where: { companyId: company.id } });
  const farm = await prisma.farm.findFirst({ where: { companyId: company.id } });
  if (!branch || !farm) throw new Error('No branch or farm. Run `npm run db:seed` first.');

  const recorder =
    (await prisma.user.findFirst({ where: { companyId: company.id, email: 'farm.manager@bioassetpro.ng' } })) ??
    (await prisma.user.findFirst({ where: { companyId: company.id } }));
  if (!recorder) throw new Error('No user. Run `npm run db:seed:users` first.');

  // --- Houses -------------------------------------------------------------
  const penIds = new Map<string, string>();
  for (const [index, name] of HOUSES.entries()) {
    const code = `PH-${String(index + 1).padStart(2, '0')}`;
    const pen = await prisma.penHouse.upsert({
      where: { farmId_code: { farmId: farm.id, code } },
      update: { name },
      create: { farmId: farm.id, code, name },
    });
    penIds.set(name, pen.id);
  }

  // --- Clear any previous run of THIS seed --------------------------------
  const previous = await prisma.livestockGroup.findMany({
    where: { companyId: company.id, code: { in: GROUPS.map((g) => g.code) } },
    select: { id: true },
  });
  const previousIds = previous.map((g) => g.id);
  if (previousIds.length > 0) {
    await prisma.stageChange.deleteMany({ where: { groupId: { in: previousIds } } });
    await prisma.harvestRecord.deleteMany({ where: { groupId: { in: previousIds } } });
    await prisma.treatmentRecord.deleteMany({ where: { groupId: { in: previousIds } } });
    await prisma.healthEvent.deleteMany({ where: { groupId: { in: previousIds } } });
    await prisma.dailyRecord.deleteMany({ where: { groupId: { in: previousIds } } });
    await prisma.livestockGroup.deleteMany({ where: { id: { in: previousIds } } });
  }

  let dailyRecords = 0;
  let harvests = 0;
  let healthEvents = 0;

  for (const seed of GROUPS) {
    const penHouseId = penIds.get(seed.house);
    if (!penHouseId) throw new Error(`No house called ${seed.house}`);

    const group = await prisma.livestockGroup.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        farmId: farm.id,
        penHouseId,
        code: seed.code,
        speciesKey: seed.speciesKey,
        breed: seed.breed,
        purpose: seed.purpose,
        stage: seed.stage,
        openingPopulation: seed.opening,
        // Set from the history generated below, never typed in twice.
        population: seed.opening,
        startedOn: dayAgo(seed.ageDays),
        status: seed.status ?? LivestockGroupStatus.ACTIVE,
        ...(seed.status === LivestockGroupStatus.CLOSED ? { closedOn: dayAgo(2) } : {}),
        source: seed.source,
        acquisitionCostKobo: seed.acquisitionKobo,
      },
    });

    const days = Math.min(WINDOW, seed.ageDays);
    const closed = seed.status === LivestockGroupStatus.CLOSED;

    /*
     * Split the losses. Everything no longer alive either died or came off as
     * harvest, and this is the only place that decision is made — the
     * population is derived from it below rather than asserted separately.
     *
     * A finished batch is the case worth being careful about. Its population is
     * zero, and charging the whole opening figure to mortality would say the
     * farm lost every bird it ever placed: B-2026-005 would read as 4,500 dead
     * rather than 4,500 sold, and every mortality rate on the farm would be
     * poisoned by it. A batch that finished normally lost a few percent and the
     * rest left as product.
     */
    const losses = seed.opening - seed.current;
    const deaths = closed
      ? Math.min(losses, Math.round(seed.opening * (seed.speciesKey === 'poultry' ? 0.055 : 0.06)))
      : seed.harvestShare
        ? losses - Math.round(losses * seed.harvestShare)
        : losses;
    const harvested = losses - deaths;

    // --- Mortality, spread across the window ------------------------------
    const perDay = spread(deaths, days, seed.code);

    /*
     * A spike, so the mortality alert has something real to catch.
     *
     * Deaths are MOVED to the spike day, never added. An earlier version added
     * nine and took them from nowhere, which quietly broke the reconciliation
     * this whole file is built around — the population no longer matched its
     * own history. Whatever is taken from the earlier days is exactly what
     * lands on the spike day.
     */
    if (!closed && perDay.length > 4 && seed.current > 1000) {
      const spikeDay = perDay.length - 3;
      let taken = 0;
      for (let index = 0; index < perDay.length - 4 && taken < 9; index += 1) {
        const take = Math.min(perDay[index] ?? 0, 9 - taken);
        perDay[index] = (perDay[index] ?? 0) - take;
        taken += take;
      }
      perDay[spikeDay] = (perDay[spikeDay] ?? 0) + taken;
    }

    for (let index = 0; index < days; index += 1) {
      /*
       * History stops at YESTERDAY. Today is left deliberately unrecorded.
       *
       * One row per population per day is enforced by the database, so seeding
       * today would mean the first thing a person tries — walking this morning's
       * round — is refused as a duplicate, and the product's primary action
       * looks broken on a farm that has not done anything wrong. A real farm
       * starts the day with today still to record.
       */
      const daysBack = days - index;
      const died = Math.max(0, perDay[index] ?? 0);
      const liveThatDay = seed.opening - perDay.slice(0, index).reduce((a, b) => a + b, 0);

      const feedKg = closed
        ? 0
        : round2((liveThatDay * seed.feedGrams * (0.94 + wobble(index + seed.code.length) * 0.12)) / 1000);

      const production: Array<{ fieldKey: string; quantity: Prisma.Decimal }> = [];
      if (!closed && seed.speciesKey === 'poultry' && seed.layRate) {
        const laid = Math.round(liveThatDay * seed.layRate * (0.96 + wobble(index * 3) * 0.08));
        const cracked = Math.round(laid * 0.015);
        const dirty = Math.round(laid * 0.01);
        production.push(
          { fieldKey: 'whole', quantity: new Prisma.Decimal(laid - cracked - dirty) },
          { fieldKey: 'cracked', quantity: new Prisma.Decimal(cracked) },
          { fieldKey: 'dirty', quantity: new Prisma.Decimal(dirty) },
        );
      }

      if (feedKg === 0 && died === 0 && production.length === 0) continue;

      await prisma.dailyRecord.create({
        data: {
          companyId: company.id,
          groupId: group.id,
          recordedOn: dayAgo(daysBack),
          recordedById: recorder.id,
          ...(production.length > 0 ? { production: { create: production } } : {}),
          ...(feedKg > 0
            ? {
                feedIssues: {
                  create: [
                    {
                      feedName: seed.feedName,
                      quantityKg: new Prisma.Decimal(feedKg),
                      unitCostKobo: seed.feedCostPerKgKobo,
                      valueKobo: BigInt(Math.round(feedKg * Number(seed.feedCostPerKgKobo))),
                    },
                  ],
                },
              }
            : {}),
          ...(died > 0
            ? {
                mortality: {
                  create: [
                    {
                      quantity: died,
                      causes: [causeFor(seed.speciesKey, index)],
                    },
                  ],
                },
              }
            : {}),
        },
      });
      dailyRecords += 1;
    }

    // --- Harvests ---------------------------------------------------------
    if (harvested > 0) {
      const slices = spread(harvested, 4, `${seed.code}-h`).filter((n) => n > 0);
      for (const [index, count] of slices.entries()) {
        await prisma.harvestRecord.create({
          data: {
            companyId: company.id,
            groupId: group.id,
            harvestedOn: dayAgo(4 + index * 5),
            grade: closed
              ? 'Finished'
              : seed.purpose === 'Breeder cohort'
                ? 'Breeding stock'
                : 'Table size',
            // Twelve to the kilo is this farm's own observed average, recorded
            // rather than assumed — the count is what moves the population.
            weightKg: new Prisma.Decimal(round2(count / 12)),
            count,
            populationAtTime: seed.opening,
            destination: 'Finished goods',
            recordedById: recorder.id,
          },
        });
        harvests += 1;
      }
    }

    // --- The population, derived --------------------------------------------
    await prisma.livestockGroup.update({
      where: { id: group.id },
      data: { population: seed.opening - deaths - harvested },
    });

    // --- Vaccination programme (poultry) ----------------------------------
    if (seed.speciesKey === 'poultry' && !closed) {
      for (const item of VACCINATIONS) {
        // Four weeks of lookahead: a vaccination that needs ordering is worth
        // seeing before the week it is due.
        if (item.day > seed.ageDays + 28) continue;

        const missed = MISSED.has(`${seed.code}:${item.day}`);
        const done = !missed && item.day <= seed.ageDays - 2;
        const overdue = !done && item.day < seed.ageDays;

        const event = await prisma.healthEvent.create({
          data: {
            companyId: company.id,
            groupId: group.id,
            kind: 'VACCINATION',
            name: item.name,
            detail: item.detail,
            dueOn: dayAgo(seed.ageDays - item.day),
            status: done
              ? HealthEventStatus.DONE
              : overdue
                ? HealthEventStatus.OVERDUE
                : HealthEventStatus.DUE,
          },
        });
        healthEvents += 1;

        // A completed vaccination has evidence behind it, not just a status.
        if (done) {
          await prisma.treatmentRecord.create({
            data: {
              companyId: company.id,
              groupId: group.id,
              healthEventId: event.id,
              name: item.name,
              givenOn: dayAgo(seed.ageDays - item.day),
              route: item.detail.includes('water') ? 'In drinking water' : 'Injection',
              givenBy: 'Ibrahim Danjuma',
              treatedCount: seed.opening,
              populationAtTime: seed.opening,
              withdrawalDays: 0,
              costKobo: 0n,
              recordedById: recorder.id,
            },
          });
        }
      }
    }
  }

  const totals = await prisma.livestockGroup.aggregate({
    where: { companyId: company.id },
    _sum: { population: true, openingPopulation: true },
    _count: true,
  });

  console.log('Operational demo data seeded.');
  console.log(`  populations   ${totals._count}`);
  console.log(`  live animals  ${totals._sum.population?.toLocaleString('en-NG')}`);
  console.log(`  daily records ${dailyRecords}`);
  console.log(`  harvests      ${harvests}`);
  console.log(`  health events ${healthEvents}`);
  console.log('\nIllustrative only. Nothing here describes a real farm.');
}

/**
 * Split a total into `buckets` whole parts that sum to exactly the total.
 *
 * Largest-remainder, so the parts add back to the whole. Handing out
 * `Math.round(total / n)` n times loses or invents animals, and an animal
 * invented by rounding is one the population can never account for.
 */
function spread(total: number, buckets: number, seed: string): number[] {
  if (buckets <= 0 || total <= 0) return new Array(Math.max(0, buckets)).fill(0);

  const salt = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const weights = Array.from({ length: buckets }, (_, index) => 0.5 + wobble(index + salt));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const exact = weights.map((weight) => (weight / totalWeight) * total);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const { index } of order) {
    if (remainder <= 0) break;
    // The index comes from mapping over `exact`, which is the same length as
    // `floors`, so this is always in range — but the compiler cannot see that
    // and a silent `undefined + 1` here would produce a NaN quantity.
    floors[index] = (floors[index] ?? 0) + 1;
    remainder -= 1;
  }
  return floors;
}

function causeFor(species: 'poultry' | 'snail', index: number): string {
  const poultry = ['Heat stress', 'Disease', 'Culled', 'Unknown'];
  const snail = ['Desiccation', 'Disease', 'Predation', 'Unknown'];
  const list = species === 'poultry' ? poultry : snail;
  return list[index % list.length]!;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
