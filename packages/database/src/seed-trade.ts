/**
 * Trading parties for the demo farm — who it buys from and sells to.
 *
 * Illustrative, like seed-operations.ts, and for the same reason: the sales and
 * purchase screens were choosing from a list held in the browser, so every id
 * they submitted resolved to nothing on the server. A sale cannot be recorded
 * against a customer that does not exist.
 *
 * The names mirror the fixtures the interface has been showing all along, so
 * the screens look the same and the ids behind them are finally real.
 *
 * Run from the repo root:  npm run db:seed:trade
 */

import { PrismaClient, PartyStatus } from '../generated/client';

const prisma = new PrismaClient();

const SUPPLIERS = [
  { code: 'SUP-GREENFIELDS', name: 'Greenfields Feeds', category: 'Feed' },
  { code: 'SUP-ZARTECH', name: 'Zartech Hatchery', category: 'Day-old chicks' },
  { code: 'SUP-CHI', name: 'CHI Farms', category: 'Day-old chicks' },
  { code: 'SUP-VETCARE', name: 'VetCare Supplies', category: 'Veterinary' },
  { code: 'SUP-AGROTOOLS', name: 'AgroTools NG', category: 'Equipment' },
];

const CUSTOMERS = [
  { code: 'CUS-SUNRISE', name: 'Sunrise Foods', category: 'Wholesale', state: 'Lagos', creditKobo: 150_000_000n },
  { code: 'CUS-MAMANGOZI', name: 'Mama Ngozi Provisions', category: 'Retail', state: 'Ogun', creditKobo: 20_000_000n },
  { code: 'CUS-LAGOON', name: 'Lagoon Hotel', category: 'Hospitality', state: 'Lagos', creditKobo: 80_000_000n },
  { code: 'CUS-FRESHMART', name: 'FreshMart Supermarket', category: 'Retail', state: 'Lagos', creditKobo: 60_000_000n },
  { code: 'CUS-CHIDI', name: 'Chidi Okeke', category: 'Gate sale', state: 'Ogun', creditKobo: 0n },
];

/**
 * What the farm buys.
 *
 * The item master held only snail processing goods, so every purchase raised
 * from the phone named a feed that did not exist and was refused. These are the
 * feeds and medications the operational seed already issues by name — making
 * them real items is what lets a feed issue point at stock rather than a string.
 *
 * `standardCostKobo` is per kilogram, and is a STANDARD cost, not a price
 * anybody paid: it is what the farm expects, so a purchase that differs from it
 * is worth noticing.
 *
 * VAT: marked zero-rated, on the same basis the product list already states —
 * basic food and agricultural inputs are zero-rated under the Nigeria Tax Act
 * 2025, so the farm charges no VAT and still recovers input VAT. FLAG FOR THE
 * FARM'S ACCOUNTANT: the treatment of compounded animal feed specifically is
 * worth confirming against their own advice before any return is filed on it.
 */
const SUPPLIES: Array<{
  code: string;
  description: string;
  feed: boolean;
  costKobo: bigint;
  reorderLevel: number;
  unit: 'Kg' | 'Unit';
}> = [
  { code: 'FD-LAYER', description: 'Layer mash', feed: true, costKobo: 62_000n, reorderLevel: 3000, unit: 'Kg' },
  { code: 'FD-BRSTART', description: 'Broiler starter', feed: true, costKobo: 68_000n, reorderLevel: 800, unit: 'Kg' },
  { code: 'FD-BRFIN', description: 'Broiler finisher', feed: true, costKobo: 66_000n, reorderLevel: 3500, unit: 'Kg' },
  { code: 'FD-GROWER', description: 'Grower mash', feed: true, costKobo: 58_000n, reorderLevel: 2000, unit: 'Kg' },
  { code: 'FD-SNAIL', description: 'Snail feed concentrate', feed: true, costKobo: 41_000n, reorderLevel: 250, unit: 'Kg' },
  { code: 'MD-LASOTA', description: 'Newcastle (Lasota) vaccine', feed: false, costKobo: 1_200n, reorderLevel: 2000, unit: 'Unit' },
  { code: 'MD-GUMB', description: 'Gumboro vaccine', feed: false, costKobo: 1_450n, reorderLevel: 2000, unit: 'Unit' },
  { code: 'MD-VITAMIX', description: 'Vitamin premix', feed: false, costKobo: 290_000n, reorderLevel: 25, unit: 'Kg' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo trading parties in production.');
  }

  const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) throw new Error('No company. Run `npm run db:seed` first.');

  const branch = await prisma.branch.findFirst({ where: { companyId: company.id } });

  /*
   * Net 14 where one exists. A payment term decides an invoice's due date, and
   * an invoice with no due date cannot be reported as overdue — which is the
   * whole point of the receivables screen.
   */
  const term =
    (await prisma.paymentTerm.findFirst({ where: { companyId: company.id, netDays: 14 } })) ??
    (await prisma.paymentTerm.findFirst({ where: { companyId: company.id } }));

  for (const supplier of SUPPLIERS) {
    await prisma.supplier.upsert({
      where: { companyId_code: { companyId: company.id, code: supplier.code } },
      update: { name: supplier.name, status: PartyStatus.ACTIVE },
      create: {
        // Relations connected rather than set by scalar id: Prisma refuses a
        // create that mixes the two styles, and every one of these is required.
        company: { connect: { id: company.id } },
        // Supplier and Customer name these relations differently —
        // `defaultCurrency`/`branch` here, `currency`/`defaultBranch` below.
        defaultCurrency: { connect: { id: company.baseCurrencyId } },
        code: supplier.code,
        name: supplier.name,
        category: supplier.category,
        // No `state` here — a Supplier does not carry one, only a Customer
        // does, because the customer's state is what decides WHT and PAYE
        // jurisdiction downstream.
        ...(term ? { paymentTerm: { connect: { id: term.id } } } : {}),
        ...(branch ? { branch: { connect: { id: branch.id } } } : {}),
        status: PartyStatus.ACTIVE,
      },
    });
  }

  for (const customer of CUSTOMERS) {
    await prisma.customer.upsert({
      where: { companyId_code: { companyId: company.id, code: customer.code } },
      update: { name: customer.name, status: PartyStatus.ACTIVE },
      create: {
        company: { connect: { id: company.id } },
        currency: { connect: { id: company.baseCurrencyId } },
        code: customer.code,
        name: customer.name,
        category: customer.category,
        state: customer.state,
        ...(term ? { paymentTerm: { connect: { id: term.id } } } : {}),
        ...(branch ? { defaultBranch: { connect: { id: branch.id } } } : {}),
        // Set rather than left at the default, so the credit warning on the
        // sale screen has a real limit to compare against.
        creditLimitKobo: customer.creditKobo,
        creditLimitSet: customer.creditKobo > 0n,
        status: PartyStatus.ACTIVE,
      },
    });
  }

  // --- What the farm buys -------------------------------------------------
  const zeroRated = await prisma.taxCode.findFirst({
    where: { companyId: company.id, code: 'VAT-ZERO' },
  });
  const rawStore = await prisma.warehouse.findFirst({
    where: { companyId: company.id, type: 'RAW_MATERIAL' },
  });

  /*
   * Where receiving these lands on the balance sheet.
   *
   * Feed and medication are raw material. Without this every one of these
   * items was created with no stock account, and a goods receipt against them
   * had nowhere to put its debit — which is a refusal at the moment somebody
   * is standing next to a delivery, and the least helpful time to discover it.
   */
  const rawMaterialAccount = await prisma.gLAccount.findFirst({
    where: { companyId: company.id, accountNumber: '1301', active: true },
    select: { id: true },
  });
  if (!rawMaterialAccount) {
    throw new Error('No 1301 Raw Material Inventory account. Run `npm run db:seed` first.');
  }

  let supplies = 0;
  for (const supply of SUPPLIES) {
    const unit = await prisma.unitOfMeasure.findFirst({
      where: { companyId: company.id, code: supply.unit },
    });
    if (!unit) throw new Error(`No unit of measure "${supply.unit}". Run \`npm run db:seed\`.`);

    const item = await prisma.item.upsert({
      where: { companyId_code: { companyId: company.id, code: supply.code } },
      update: {
        description: supply.description,
        active: true,
        // Applied on update too, so databases seeded before this existed are
        // repaired by re-running rather than needing a migration.
        inventoryGlAccount: { connect: { id: rawMaterialAccount.id } },
      },
      create: {
        company: { connect: { id: company.id } },
        unitOfMeasure: { connect: { id: unit.id } },
        inventoryGlAccount: { connect: { id: rawMaterialAccount.id } },
        ...(zeroRated ? { vatTaxCode: { connect: { id: zeroRated.id } } } : {}),
        ...(rawStore ? { defaultWarehouse: { connect: { id: rawStore.id } } } : {}),
        code: supply.code,
        description: supply.description,
        category: supply.feed ? 'Feed' : 'Medication',
        isBiologicalFeed: supply.feed,
        reorderLevel: supply.reorderLevel,
      },
    });

    /*
     * A standard cost, effective from the start of the year. Without one the
     * purchase screen has no expected price to show and every feed order
     * starts from a blank field.
     */
    const existingCost = await prisma.itemStandardCost.findFirst({ where: { itemId: item.id } });
    if (!existingCost) {
      await prisma.itemStandardCost.create({
        data: {
          item: { connect: { id: item.id } },
          standardCostKobo: supply.costKobo,
          effectiveFrom: new Date(`${new Date().getUTCFullYear()}-01-01`),
          sourceReference: 'Illustrative demo cost',
        },
      });
    }
    supplies += 1;
  }

  console.log(`Seeded ${SUPPLIERS.length} suppliers, ${CUSTOMERS.length} customers, ${supplies} supply items.`);
  console.log('Illustrative only. Nothing here describes a real business.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
