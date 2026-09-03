import { PrismaClient, RoutingResourceType } from '../generated/client';

/**
 * Routing operations and ABC cost pools — BOM_Routing, ABC_Pools_Drivers
 * (US-897-014/015). Real client data: the workbook's own sheets, titled
 * "Illustrative BOM and Routing Master" and carrying an "Illustrative rate
 * calculation" — the mechanism is real, the rates are the client's own
 * illustration pending confirmation, the same caveat Feed Mill's formula
 * already carries.
 *
 * Scoped to SnailPro's real, already-seeded slime recipe (REC-SLIME-COSMETIC
 * — `masters/recipe.service.ts`'s own RTE-SLIME-01 shape) because no
 * PoultryPro item/recipe exists in this seed at all yet ("PoultryPro has no
 * FG items seeded" is an existing, already-accepted gap elsewhere in this
 * codebase, not invented here).
 */

const POOLS = [
  {
    code: 'POOL-001',
    name: 'Direct Farm Labour',
    driverName: 'Approved labour hours',
    poolCostKobo: 1_200_000_00n,
    practicalCapacity: '4000',
    ratePerUnitKobo: 300_00n,
  },
  {
    code: 'POOL-002',
    name: 'Production Labour',
    driverName: 'Labour hours',
    poolCostKobo: 900_000_00n,
    practicalCapacity: '3000',
    ratePerUnitKobo: 300_00n,
  },
  {
    code: 'POOL-003',
    name: 'Machine Depreciation',
    driverName: 'Machine hours',
    poolCostKobo: 600_000_00n,
    practicalCapacity: '3000',
    ratePerUnitKobo: 200_00n,
  },
  {
    code: 'POOL-004',
    name: 'Power and Utilities',
    driverName: 'Machine hours or kWh',
    poolCostKobo: 300_000_00n,
    practicalCapacity: '1000',
    ratePerUnitKobo: 300_00n,
  },
] as const;

const SLIME_ROUTING = [
  {
    sequence: 1,
    operationName: 'Setup & sanitation',
    resourceType: RoutingResourceType.MACHINE,
    setupHours: '2',
    runHoursPerUnit: '0',
    costCentreCode: 'SN-SLIME',
    poolCode: 'POOL-003',
  },
  {
    sequence: 2,
    operationName: 'Extraction run',
    resourceType: RoutingResourceType.MACHINE,
    setupHours: '0',
    runHoursPerUnit: '0.58',
    costCentreCode: 'SN-SLIME',
    poolCode: 'POOL-003',
  },
  {
    sequence: 3,
    operationName: 'Inspection/pack',
    resourceType: RoutingResourceType.LABOUR,
    setupHours: '0',
    runHoursPerUnit: '0.25',
    costCentreCode: 'SN-QC',
    poolCode: 'POOL-002',
  },
] as const;

export async function seedRouting(prisma: PrismaClient, companyId: string) {
  const from = new Date('2026-01-01');
  const pools: Record<string, string> = {};

  for (const spec of POOLS) {
    const pool = await prisma.costPool.upsert({
      where: { companyId_code: { companyId, code: spec.code } },
      update: {},
      create: {
        companyId,
        code: spec.code,
        name: spec.name,
        driverName: spec.driverName,
      },
    });
    pools[spec.code] = pool.id;

    const hasRate = await prisma.costPoolRate.findFirst({ where: { poolId: pool.id } });
    if (!hasRate) {
      await prisma.costPoolRate.create({
        data: {
          poolId: pool.id,
          poolCostKobo: spec.poolCostKobo,
          practicalCapacity: spec.practicalCapacity,
          ratePerUnitKobo: spec.ratePerUnitKobo,
          effectiveFrom: from,
          sourceReference: 'ABC_Pools_Drivers — illustrative rate calculation, pending client confirmation',
        },
      });
    }
  }

  const recipe = await prisma.productRecipe.findUnique({
    where: { companyId_code: { companyId, code: 'REC-SLIME-COSMETIC' } },
    include: { versions: { where: { status: 'ACTIVE' }, take: 1 } },
  });
  const version = recipe?.versions[0];
  if (!version) {
    console.log('Routing: REC-SLIME-COSMETIC has no active version yet — skipped.');
    return { pools: POOLS.length, operations: 0 };
  }

  let operations = 0;
  for (const op of SLIME_ROUTING) {
    const costCentre = await prisma.costCentre.findUniqueOrThrow({
      where: { companyId_code: { companyId, code: op.costCentreCode } },
    });
    const existing = await prisma.routingOperation.findUnique({
      where: { recipeVersionId_sequence: { recipeVersionId: version.id, sequence: op.sequence } },
    });
    if (existing) continue;

    await prisma.routingOperation.create({
      data: {
        companyId,
        recipeVersionId: version.id,
        costCentreId: costCentre.id,
        costPoolId: pools[op.poolCode]!,
        sequence: op.sequence,
        operationName: op.operationName,
        resourceType: op.resourceType,
        setupHours: op.setupHours,
        runHoursPerUnit: op.runHoursPerUnit,
      },
    });
    operations += 1;
  }

  console.log(`Seeded routing: ${POOLS.length} cost pools, ${operations} routing operation(s) for ${recipe!.code}.`);
  return { pools: POOLS.length, operations };
}

if (process.argv[1]?.includes('seed-routing')) {
  const prisma = new PrismaClient();
  (async () => {
    for (const company of await prisma.company.findMany({ select: { id: true, name: true } })) {
      const result = await seedRouting(prisma, company.id);
      console.log(`${company.name}: ${result.pools} pools, ${result.operations} operations.`);
    }
    await prisma.$disconnect();
  })();
}
