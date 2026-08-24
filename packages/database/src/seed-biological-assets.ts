import { PrismaClient } from '../generated/client';

/**
 * Wire the product's own species stage vocabulary to the workbook's GL accounts.
 *
 * Two species, two different shapes, taken from the posting keys already
 * resolved in `posting-control.json` (PCR-037 through PCR-071) rather than
 * invented here.
 *
 * Snail carries six distinct stage accounts (130200-130204, plus 130203
 * shared) — every stage transfer is a real reclassification the workbook
 * wants visible on its own line. `apps/web/src/lib/modules.ts` gives the
 * product's stage list as `['Egg', 'Hatchling', 'Juvenile', 'Grower',
 * 'Market-ready', 'Breeder']`; Grower shares Juvenile's account (130203)
 * because the workbook names no separate one.
 *
 * 130204 "BA — Market Snails" WAS left unmapped here, because the workbook's
 * lifecycle treats "market-ready" as its own stage before a live sale or
 * transfer to processing, and this product instead harvested/sold directly
 * out of Grower via `HarvestRecord` with no stage in between. That was
 * flagged as a product decision rather than defaulted silently. The decision:
 * Market-ready is now a real stage, mapped to the account the workbook
 * already reserved for it — but `HarvestRecord` still does not require
 * passing through it first. A farm that wants the explicit reclassification
 * records a StageChange to Market-ready before harvesting; one that does not
 * still harvests straight out of Grower exactly as before. Nothing about the
 * existing harvest path changed.
 *
 * Poultry carries almost everything in one account (130210) — PCR-061 through
 * PCR-066 and PCR-070 through PCR-074 all name it regardless of stage — with
 * eggs split into their own two accounts (130215 collected, 130216 in
 * incubation) per PCR-067/068/069. The product's poultry stages are
 * `['Chick', 'Grower', 'Market-ready', 'Pullet', 'Point of lay', 'Layer']`;
 * none of them is an egg, because eggs are not a life stage of the bird —
 * they are the bird's output, tracked by `ProductionLine`, not by
 * `LivestockGroup`. So every poultry stage maps to 130210 regardless of which
 * branch of the lifecycle it is on, and the egg accounts stay unmapped until
 * table-egg production gets its own accounting pass.
 *
 * A second vocabulary mismatch turned up building this: `LivestockGroup.stage`
 * is not always populated from `terms.stages`. `OperationsService.placeGroup`
 * sets a newly placed population's stage from `payload.purpose` — the "what
 * it's kept for" list (`terms.purposes`) — not from the lifecycle list. A
 * colony placed as a "Breeder colony" carries that exact string as its stage
 * until a `StageChange` event later moves it onto the lifecycle vocabulary
 * ('Breeder', 'Egg', ...). So the mapping below covers both: every value
 * `LivestockGroup.stage` can actually hold at any point in a population's
 * life, not only the lifecycle list a stage transfer moves between. Every
 * purpose maps to the SAME account its nearest lifecycle stage would — this
 * adds no new accounts, it recognises that this product's placement flow and
 * its stage-transfer flow write two different strings into the one field.
 */

const SNAIL_STAGE_ACCOUNTS: Record<string, string> = {
  // Lifecycle stages (`terms.stages`) — what a StageChange moves between.
  Breeder: '130200',
  Egg: '130201',
  Hatchling: '130202',
  Juvenile: '130203',
  Grower: '130203',
  'Market-ready': '130204',
  // Purposes (`terms.purposes`) — what a placement's initial stage is set
  // from. Mapped to the same account as their nearest lifecycle stage.
  'Breeder colony': '130200',
  Growers: '130203',
  Juveniles: '130203',
};

const POULTRY_STAGE_ACCOUNTS: Record<string, string> = {
  // Every poultry stage and purpose carries the one BA account (§66: PCR-061
  // through PCR-066, PCR-070 through PCR-074 all name 130210 regardless).
  // 'Spent' removed — it was never a term the spec used; a layer's end-of-lay
  // sale or cull is an EXIT from Layer, not a further stage (see the comment
  // on `terms.stages` in modules.ts).
  Chick: '130210',
  Grower: '130210',
  'Market-ready': '130210',
  'Point of lay': '130210',
  Layer: '130210',
  Broiler: '130210',
  Pullet: '130210',
  Cockerel: '130210',
  Breeder: '130210',
};

export async function seedBiologicalAssets(prisma: PrismaClient, companyId: string) {
  const accounts = await prisma.gLAccount.findMany({
    where: { companyId },
    select: { id: true, accountNumber: true },
  });
  const byNumber = new Map(accounts.map((a) => [a.accountNumber, a.id]));

  let mapped = 0;
  let missing = 0;

  for (const [speciesKey, stages] of [
    ['snail', SNAIL_STAGE_ACCOUNTS],
    ['poultry', POULTRY_STAGE_ACCOUNTS],
  ] as const) {
    for (const [stage, accountNumber] of Object.entries(stages)) {
      const glAccountId = byNumber.get(accountNumber);
      if (!glAccountId) {
        missing += 1;
        continue;
      }
      await prisma.biologicalAssetStageAccount.upsert({
        where: { companyId_speciesKey_stage: { companyId, speciesKey, stage } },
        update: { glAccountId, active: true },
        create: { companyId, speciesKey, stage, glAccountId },
      });
      mapped += 1;
    }
  }

  /*
   * The abnormal-mortality threshold. PROVISIONAL — see the schema-level note.
   * 2% of a single population in a single day is a commonly cited alarm
   * threshold for both poultry and snail husbandry, kept only as a working
   * default until the client states their own figure. It governs which
   * account a day's deaths post through, not whether they get recorded.
   */
  const existingConfig = await prisma.biologicalAssetConfiguration.findFirst({
    where: { companyId },
  });
  if (!existingConfig) {
    await prisma.biologicalAssetConfiguration.create({
      data: {
        companyId,
        abnormalMortalityThresholdPercent: '2',
        effectiveFrom: new Date('2026-01-01'),
      },
    });
  }

  return { mapped, missing };
}

/* Runnable on its own: `tsx packages/database/src/seed-biological-assets.ts`. */
if (process.argv[1]?.includes('seed-biological-assets')) {
  const prisma = new PrismaClient();
  (async () => {
    for (const company of await prisma.company.findMany({ select: { id: true, name: true } })) {
      const result = await seedBiologicalAssets(prisma, company.id);
      console.log(`${company.name}: ${result.mapped} stage accounts mapped, ${result.missing} skipped (account not in chart)`);
    }
    await prisma.$disconnect();
  })();
}
