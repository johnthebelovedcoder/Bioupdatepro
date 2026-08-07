import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ItemType,
  PartyStatus,
  PrismaClient,
  RecipeVersionStatus,
  SalaryComponentType,
  TaxType,
} from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { PartyService } from '../../src/masters/party.service';
import { ItemService } from '../../src/masters/item.service';
import { EmployeeService } from '../../src/masters/employee.service';
import { RecipeService } from '../../src/masters/recipe.service';
import { kobo } from '../../src/common/money';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Phase 4 — Master Data (§5, §6, §7, §10).
 *
 * The recipe explosion is checked against the SnailPro workbook's own numbers:
 * PO-SN-001, 500 units of Cosmetic Snail Slime, whose Material_Issues rows sum
 * to ₦195,500. If this suite and that workbook ever disagree, one of them is
 * wrong and it matters which.
 */
describe('Master Data (§5, §6, §7, §10)', () => {
  let prisma: PrismaService;
  let parties: PartyService;
  let items: ItemService;
  let employees: EmployeeService;
  let recipes: RecipeService;
  let fixture: TestFixture;

  let uomUnitId: string;
  let uomLitreId: string;
  let vatStdCode: string;
  let whtContractCode: string;

  const JAN = new Date('2026-01-15');

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    parties = new PartyService(prisma, audit);
    items = new ItemService(prisma, audit);
    employees = new EmployeeService(prisma, audit);
    recipes = new RecipeService(prisma, audit);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);

    const unit = await prisma.unitOfMeasure.create({
      data: { companyId: fixture.companyId, code: 'Unit', name: 'Unit', precision: 0 },
    });
    uomUnitId = unit.id;
    const litre = await prisma.unitOfMeasure.create({
      data: { companyId: fixture.companyId, code: 'L', name: 'Litre', precision: 3 },
    });
    uomLitreId = litre.id;

    await prisma.paymentTerm.create({
      data: { companyId: fixture.companyId, code: 'NET30', name: 'Net 30 days', netDays: 30 },
    });

    const vat = await prisma.taxCode.create({
      data: {
        companyId: fixture.companyId,
        code: 'VAT-STD',
        name: 'VAT standard',
        taxType: TaxType.VAT,
        rates: { create: [{ rate: '0.07500000', effectiveFrom: new Date('2026-01-01') }] },
      },
    });
    vatStdCode = vat.code;

    const wht = await prisma.taxCode.create({
      data: {
        companyId: fixture.companyId,
        code: 'WHT-CONTRACT',
        name: 'WHT contracts',
        taxType: TaxType.WHT,
        whtCategory: 'Contracts/Supplies',
      },
    });
    whtContractCode = wht.code;
  });

  // -------------------------------------------------------------------------

  describe('supplier & customer masters (§5, §6)', () => {
    it('links a supplier WHT category to the tax engine, not to a rate', async () => {
      const supplier = await parties.createSupplier({
        companyId: fixture.companyId,
        code: 'SUP-001',
        name: 'Shell Supplies Ltd',
        tin: 'TIN-100',
        whtTaxCode: whtContractCode,
        paymentTermCode: 'NET30',
        defaultCurrencyId: fixture.currencyId,
        actorId: fixture.makerId,
      });

      expect(supplier.whtTaxCodeId).toBeTruthy();
      const linked = await prisma.taxCode.findUniqueOrThrow({
        where: { id: supplier.whtTaxCodeId! },
      });
      expect(linked.taxType).toBe(TaxType.WHT);
    });

    it('refuses a VAT code where a WHT category belongs', async () => {
      await expect(
        parties.createSupplier({
          companyId: fixture.companyId,
          code: 'SUP-002',
          name: 'Wrong Code Ltd',
          whtTaxCode: vatStdCode,
          defaultCurrencyId: fixture.currencyId,
          actorId: fixture.makerId,
        }),
      ).rejects.toThrow(/is a VAT code/i);
    });

    it('requires a reason to block a supplier', async () => {
      const supplier = await parties.createSupplier({
        companyId: fixture.companyId,
        code: 'SUP-003',
        name: 'To Be Blocked',
        defaultCurrencyId: fixture.currencyId,
        actorId: fixture.makerId,
      });

      await expect(
        parties.setSupplierStatus({
          supplierId: supplier.id,
          status: PartyStatus.BLOCKED,
          actorId: fixture.makerId,
        }),
      ).rejects.toThrow(/requires a reason/i);

      const blocked = await parties.setSupplierStatus({
        supplierId: supplier.id,
        status: PartyStatus.BLOCKED,
        reason: 'Failed quality audit',
        actorId: fixture.makerId,
      });
      expect(blocked.statusReason).toBe('Failed quality audit');
    });

    it('writes an audit record for every master change (Rule 9)', async () => {
      const supplier = await parties.createSupplier({
        companyId: fixture.companyId,
        code: 'SUP-004',
        name: 'Audited Ltd',
        defaultCurrencyId: fixture.currencyId,
        actorId: fixture.makerId,
      });
      await parties.setSupplierStatus({
        supplierId: supplier.id,
        status: PartyStatus.INACTIVE,
        actorId: fixture.makerId,
      });

      const audit = await prisma.auditRecord.findMany({
        where: { entityType: 'Supplier', entityId: supplier.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual(['CREATE', 'UPDATE']);
    });
  });

  describe('customer credit control (§6)', () => {
    async function makeCustomer(
      limit: bigint | null,
      status: PartyStatus = PartyStatus.ACTIVE,
    ) {
      const customer = await parties.createCustomer({
        companyId: fixture.companyId,
        code: `CUS-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Test Customer',
        creditLimit: limit !== null ? kobo(limit) : null,
        currencyId: fixture.currencyId,
        actorId: fixture.makerId,
      });
      if (status !== PartyStatus.ACTIVE) {
        await parties.setCustomerStatus({
          customerId: customer.id,
          status,
          reason: status === PartyStatus.BLOCKED ? 'Overdue' : null,
          actorId: fixture.makerId,
        });
      }
      return customer;
    }

    it('passes an order within the limit', async () => {
      const customer = await makeCustomer(1_000_000_00n);
      const result = await parties.creditCheck({
        customerId: customer.id,
        proposedAmount: kobo(400_000_00),
      });
      expect(result.passed).toBe(true);
      expect(result.availableKobo).toBe('100000000');
    });

    it('fails an order over the limit', async () => {
      const customer = await makeCustomer(100_000_00n);
      const result = await parties.creditCheck({
        customerId: customer.id,
        proposedAmount: kobo(400_000_00),
      });
      expect(result.passed).toBe(false);
      expect(result.reasons.join(' ')).toMatch(/Credit limit exceeded/i);
    });

    it('treats "no limit set" as unassessable, not unlimited', async () => {
      const customer = await makeCustomer(null);
      const result = await parties.creditCheck({
        customerId: customer.id,
        proposedAmount: kobo(1_00),
      });
      expect(result.passed).toBe(false);
      expect(result.creditLimitKobo).toBeNull();
      expect(result.reasons.join(' ')).toMatch(/No credit limit has been set/i);
    });

    it('reports every failing condition, not just the first', async () => {
      const customer = await makeCustomer(100_00n, PartyStatus.BLOCKED);
      const result = await parties.creditCheck({
        customerId: customer.id,
        proposedAmount: kobo(500_000_00),
      });
      expect(result.passed).toBe(false);
      expect(result.reasons).toHaveLength(2);
      expect(result.reasons.join(' ')).toMatch(/BLOCKED/);
      expect(result.reasons.join(' ')).toMatch(/Credit limit exceeded/);
    });
  });

  // -------------------------------------------------------------------------

  describe('item master (§5)', () => {
    it('refuses an inventory item with no inventory account', async () => {
      await expect(
        items.create({
          companyId: fixture.companyId,
          code: 'ITM-BAD',
          description: 'No account',
          itemType: ItemType.INVENTORY,
          unitOfMeasureCode: 'Unit',
          actorId: fixture.makerId,
        }),
      ).rejects.toThrow(/needs a default inventory GL account/i);
    });

    it('stores standard cost as effective-dated history, never in place', async () => {
      const item = await items.create({
        companyId: fixture.companyId,
        code: 'ITM-001',
        description: 'Bottle 100ml',
        unitOfMeasureCode: 'Unit',
        inventoryGlAccountId: fixture.accounts['1301']!,
        standardCost: kobo(180_00),
        standardCostFrom: new Date('2026-01-01'),
        actorId: fixture.makerId,
      });

      await items.setStandardCost({
        itemId: item.id,
        cost: kobo(200_00),
        effectiveFrom: new Date('2026-07-01'),
        actorId: fixture.makerId,
      });

      expect(await recipes.standardCostOn(item.id, new Date('2026-03-01'))).toBe(18_000n);
      expect(await recipes.standardCostOn(item.id, new Date('2026-08-01'))).toBe(20_000n);

      const history = await prisma.itemStandardCost.findMany({ where: { itemId: item.id } });
      expect(history).toHaveLength(2);
    });

    it('refuses two standard costs effective on the same day, at the database', async () => {
      const item = await items.create({
        companyId: fixture.companyId,
        code: 'ITM-002',
        description: 'Label',
        unitOfMeasureCode: 'Unit',
        inventoryGlAccountId: fixture.accounts['1301']!,
        standardCost: kobo(45_00),
        standardCostFrom: new Date('2026-01-01'),
        actorId: fixture.makerId,
      });

      await expect(
        prisma.itemStandardCost.create({
          data: {
            itemId: item.id,
            standardCostKobo: 50_00n,
            effectiveFrom: new Date('2026-03-01'),
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a costing with no standard cost rather than assuming zero', async () => {
      const item = await items.create({
        companyId: fixture.companyId,
        code: 'ITM-003',
        description: 'Uncosted',
        unitOfMeasureCode: 'Unit',
        inventoryGlAccountId: fixture.accounts['1301']!,
        actorId: fixture.makerId,
      });

      await expect(recipes.standardCostOn(item.id, JAN)).rejects.toThrow(
        /no standard cost effective/i,
      );
    });
  });

  // -------------------------------------------------------------------------

  describe('recipes and BOM (§9, §10)', () => {
    /** The SnailPro workbook's Cosmetic Snail Slime 100ml recipe, verbatim. */
    async function seedSlimeRecipe() {
      const mk = async (
        code: string,
        description: string,
        costKobo: bigint,
        uomId: string,
      ) => {
        const item = await prisma.item.create({
          data: {
            companyId: fixture.companyId,
            code,
            description,
            unitOfMeasureId: uomId,
            inventoryGlAccountId: fixture.accounts['1301']!,
            standardCosts: {
              create: [
                { standardCostKobo: costKobo, effectiveFrom: new Date('2026-01-01') },
              ],
            },
          },
        });
        return item;
      };

      // Workbook Masters sheet: unit costs in naira -> kobo here.
      const slime = await mk('RM-SLIME', 'Fresh Snail Slime', 1_500_00n, uomLitreId);
      const preservative = await mk('RM-PRES', 'Preservative', 8_000_00n, uomLitreId);
      const bottle = await mk('PK-BOTTLE', 'Bottle 100ml', 180_00n, uomUnitId);
      const label = await mk('PK-LABEL', 'Label', 45_00n, uomUnitId);

      const output = await prisma.item.create({
        data: {
          companyId: fixture.companyId,
          code: 'FG-COSMETIC',
          description: 'Cosmetic Snail Slime 100ml',
          unitOfMeasureId: uomUnitId,
          isManufactured: true,
          inventoryGlAccountId: fixture.accounts['1401']!,
        },
      });

      const recipe = await prisma.productRecipe.create({
        data: {
          companyId: fixture.companyId,
          code: 'REC-COSMETIC',
          name: 'Cosmetic Snail Slime 100ml',
          outputItemId: output.id,
        },
      });

      // Workbook BOM sheet, quantities per ONE finished unit.
      const version = await prisma.productRecipeVersion.create({
        data: {
          recipeId: recipe.id,
          version: 1,
          batchSize: '1',
          expectedYieldPercent: '92',
          effectiveFrom: new Date('2026-01-01'),
          components: {
            create: [
              { lineNumber: 1, componentItemId: slime.id, quantityPerBatch: '0.1', unitOfMeasureId: uomLitreId },
              { lineNumber: 2, componentItemId: preservative.id, quantityPerBatch: '0.002', unitOfMeasureId: uomLitreId },
              { lineNumber: 3, componentItemId: bottle.id, quantityPerBatch: '1', unitOfMeasureId: uomUnitId },
              { lineNumber: 4, componentItemId: label.id, quantityPerBatch: '1', unitOfMeasureId: uomUnitId },
            ],
          },
        },
      });

      return { recipe, version, output, slime };
    }

    it('reproduces the SnailPro workbook material cost for PO-SN-001', async () => {
      const { version } = await seedSlimeRecipe();
      await recipes.activateVersion({
        recipeVersionId: version.id,
        actorId: fixture.makerId,
      });

      const explosion = await recipes.explode({
        recipeVersionId: version.id,
        quantity: 500,
        on: JAN,
      });

      // Workbook Material_Issues MI-SN-001..004 for PO-SN-001:
      //   50 L slime    @ 1,500 = 75,000
      //    1 L preserv. @ 8,000 =  8,000
      //  500 bottles    @   180 = 90,000
      //  500 labels     @    45 = 22,500
      //                          -------
      //                          195,500
      expect(explosion.totalMaterialCostKobo).toBe('19550000');

      const byCode = Object.fromEntries(
        explosion.components.map((c) => [c.itemCode, c]),
      );
      expect(byCode['RM-SLIME']!.grossQuantity).toBe('50.000000');
      expect(byCode['RM-SLIME']!.extendedCostKobo).toBe('7500000');
      expect(byCode['RM-PRES']!.grossQuantity).toBe('1.000000');
      expect(byCode['RM-PRES']!.extendedCostKobo).toBe('800000');
      expect(byCode['PK-BOTTLE']!.extendedCostKobo).toBe('9000000');
      expect(byCode['PK-LABEL']!.extendedCostKobo).toBe('2250000');

      // 195,500 / 500 = 391.00 per unit.
      expect(explosion.unitMaterialCostKobo).toBe('39100');
    });

    it('keeps fractional component quantities intact', async () => {
      const { version } = await seedSlimeRecipe();
      await recipes.activateVersion({ recipeVersionId: version.id, actorId: fixture.makerId });

      const explosion = await recipes.explode({
        recipeVersionId: version.id,
        quantity: 1,
        on: JAN,
      });
      const preservative = explosion.components.find((c) => c.itemCode === 'RM-PRES')!;
      // 0.002 L per bottle must not be rounded away to zero.
      expect(preservative.grossQuantity).toBe('0.002000');
      expect(preservative.extendedCostKobo).toBe('1600');
    });

    it('inflates the issue quantity for expected wastage', async () => {
      const { version } = await seedSlimeRecipe();
      await prisma.productRecipeComponent.updateMany({
        where: { recipeVersionId: version.id, lineNumber: 1 },
        data: { wastagePercent: '20' },
      });
      await recipes.activateVersion({ recipeVersionId: version.id, actorId: fixture.makerId });

      const explosion = await recipes.explode({
        recipeVersionId: version.id,
        quantity: 100,
        on: JAN,
      });
      const slime = explosion.components.find((c) => c.itemCode === 'RM-SLIME')!;
      // Need 10 L net; at 20% wastage, issue 10 / 0.8 = 12.5 L.
      expect(slime.netQuantity).toBe('10.000000');
      expect(slime.grossQuantity).toBe('12.500000');
    });

    it('resolves component costs as at the explosion date', async () => {
      const { version, slime } = await seedSlimeRecipe();
      await recipes.activateVersion({ recipeVersionId: version.id, actorId: fixture.makerId });

      await items.setStandardCost({
        itemId: slime.id,
        cost: kobo(3_000_00),
        effectiveFrom: new Date('2026-07-01'),
        actorId: fixture.makerId,
      });

      const january = await recipes.explode({
        recipeVersionId: version.id, quantity: 500, on: JAN,
      });
      const august = await recipes.explode({
        recipeVersionId: version.id, quantity: 500, on: new Date('2026-08-01'),
      });

      expect(january.totalMaterialCostKobo).toBe('19550000');
      // Slime doubles: +75,000 naira on the same 500 units.
      expect(august.totalMaterialCostKobo).toBe('27050000');
    });

    it('allocates an actual cost so the parts sum to the whole exactly', async () => {
      const { version } = await seedSlimeRecipe();
      await recipes.activateVersion({ recipeVersionId: version.id, actorId: fixture.makerId });

      // A deliberately awkward number that does not divide evenly.
      const actual = kobo(1_000_001n);
      const allocation = await recipes.allocateActualCost({
        recipeVersionId: version.id,
        quantity: 500,
        on: JAN,
        actualCost: actual,
      });

      const total = allocation.reduce((s, a) => s + BigInt(a.allocatedKobo), 0n);
      expect(total).toBe(1_000_001n);
    });
  });

  describe('recipe versioning is what makes past production reproducible', () => {
    async function draftRecipe() {
      const component = await prisma.item.create({
        data: {
          companyId: fixture.companyId,
          code: 'RM-X',
          description: 'Component',
          unitOfMeasureId: uomUnitId,
          inventoryGlAccountId: fixture.accounts['1301']!,
          standardCosts: {
            create: [{ standardCostKobo: 100_00n, effectiveFrom: new Date('2026-01-01') }],
          },
        },
      });
      const output = await prisma.item.create({
        data: {
          companyId: fixture.companyId,
          code: 'FG-X',
          description: 'Output',
          unitOfMeasureId: uomUnitId,
          isManufactured: true,
          inventoryGlAccountId: fixture.accounts['1401']!,
        },
      });
      const recipe = await prisma.productRecipe.create({
        data: {
          companyId: fixture.companyId,
          code: 'REC-X',
          name: 'Recipe X',
          outputItemId: output.id,
        },
      });
      const version = await prisma.productRecipeVersion.create({
        data: {
          recipeId: recipe.id,
          version: 1,
          batchSize: '1',
          effectiveFrom: new Date('2026-01-01'),
          components: {
            create: [
              { lineNumber: 1, componentItemId: component.id, quantityPerBatch: '2', unitOfMeasureId: uomUnitId },
            ],
          },
        },
      });
      return { recipe, version, component, output };
    }

    it('freezes an active version against component edits, at the database', async () => {
      const { version, component } = await draftRecipe();
      await recipes.activateVersion({ recipeVersionId: version.id, actorId: fixture.makerId });

      await expect(
        prisma.productRecipeComponent.create({
          data: {
            recipeVersionId: version.id,
            lineNumber: 2,
            componentItemId: component.id,
            quantityPerBatch: '5',
            unitOfMeasureId: uomUnitId,
          },
        }),
      ).rejects.toThrow(/cannot be changed. Create a new version/i);
    });

    it('supersedes the previous version when a new one activates', async () => {
      const { recipe, version } = await draftRecipe();
      await recipes.activateVersion({ recipeVersionId: version.id, actorId: fixture.makerId });

      const v2 = await recipes.createDraftVersion({
        recipeId: recipe.id,
        batchSize: '1',
        effectiveFrom: new Date('2026-06-01'),
        copyFromVersionId: version.id,
      });
      expect(v2.version).toBe(2);
      expect(v2.components).toHaveLength(1);

      await recipes.activateVersion({ recipeVersionId: v2.id, actorId: fixture.makerId });

      const versions = await prisma.productRecipeVersion.findMany({
        where: { recipeId: recipe.id },
        orderBy: { version: 'asc' },
      });
      expect(versions[0]!.status).toBe(RecipeVersionStatus.SUPERSEDED);
      expect(versions[1]!.status).toBe(RecipeVersionStatus.ACTIVE);

      // The superseded version still explodes — a past production order must
      // still be able to resolve what it actually consumed.
      const old = await recipes.explode({
        recipeVersionId: version.id, quantity: 1, on: JAN,
      });
      expect(old.totalMaterialCostKobo).toBe('20000');
    });

    it('refuses to activate a recipe with no components', async () => {
      const output = await prisma.item.create({
        data: {
          companyId: fixture.companyId,
          code: 'FG-EMPTY',
          description: 'Empty',
          unitOfMeasureId: uomUnitId,
          inventoryGlAccountId: fixture.accounts['1401']!,
        },
      });
      const recipe = await prisma.productRecipe.create({
        data: {
          companyId: fixture.companyId,
          code: 'REC-EMPTY',
          name: 'Empty',
          outputItemId: output.id,
        },
      });
      const version = await prisma.productRecipeVersion.create({
        data: {
          recipeId: recipe.id,
          version: 1,
          batchSize: '1',
          effectiveFrom: new Date('2026-01-01'),
        },
      });

      await expect(
        recipes.activateVersion({ recipeVersionId: version.id, actorId: fixture.makerId }),
      ).rejects.toThrow(/has no components/i);
    });

    it('refuses a recipe that lists its own output, at the database', async () => {
      const { version, output } = await draftRecipe();
      await expect(
        prisma.productRecipeComponent.create({
          data: {
            recipeVersionId: version.id,
            lineNumber: 9,
            componentItemId: output.id,
            quantityPerBatch: '1',
            unitOfMeasureId: uomUnitId,
          },
        }),
      ).rejects.toThrow(/cannot list its own output/i);
    });

    it('refuses an indirect circular bill of materials', async () => {
      // A is made from B; now try to make B from A.
      const { recipe: recipeA, version: versionA, component: b, output: a } =
        await draftRecipe();
      await recipes.activateVersion({ recipeVersionId: versionA.id, actorId: fixture.makerId });
      expect(recipeA.code).toBe('REC-X');

      const recipeB = await prisma.productRecipe.create({
        data: {
          companyId: fixture.companyId,
          code: 'REC-Y',
          name: 'Recipe Y',
          outputItemId: b.id,
        },
      });
      const versionB = await prisma.productRecipeVersion.create({
        data: {
          recipeId: recipeB.id,
          version: 1,
          batchSize: '1',
          effectiveFrom: new Date('2026-01-01'),
          components: {
            create: [
              { lineNumber: 1, componentItemId: a.id, quantityPerBatch: '1', unitOfMeasureId: uomUnitId },
            ],
          },
        },
      });

      await expect(
        recipes.activateVersion({ recipeVersionId: versionB.id, actorId: fixture.makerId }),
      ).rejects.toThrow(/circular bill of materials/i);
    });

    it('refuses to explode a draft version', async () => {
      const { version } = await draftRecipe();
      await expect(
        recipes.explode({ recipeVersionId: version.id, quantity: 1, on: JAN }),
      ).rejects.toThrow(/still a draft/i);
    });

    it('allows only one active version at a time, at the database', async () => {
      const { recipe, version } = await draftRecipe();
      await recipes.activateVersion({ recipeVersionId: version.id, actorId: fixture.makerId });

      await expect(
        prisma.productRecipeVersion.create({
          data: {
            recipeId: recipe.id,
            version: 99,
            batchSize: '1',
            effectiveFrom: new Date('2026-01-01'),
            status: RecipeVersionStatus.ACTIVE,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------

  describe('employee master and payroll readiness (§7)', () => {
    async function seedSalaryComponents() {
      const specs = [
        { code: 'BASIC', name: 'Basic', taxable: true, pensionable: true },
        { code: 'HOUSING', name: 'Housing', taxable: true, pensionable: true },
        { code: 'TRANSPORT', name: 'Transport', taxable: true, pensionable: true },
        { code: 'MEAL', name: 'Meal allowance', taxable: true, pensionable: false },
      ];
      for (const spec of specs) {
        await prisma.salaryComponent.create({
          data: {
            companyId: fixture.companyId,
            code: spec.code,
            name: spec.name,
            type: SalaryComponentType.EARNING,
            isTaxable: spec.taxable,
            isPensionable: spec.pensionable,
            isGrossPayComponent: true,
          },
        });
      }
    }

    async function makeEmployee(overrides: Record<string, unknown> = {}) {
      return employees.create({
        companyId: fixture.companyId,
        employeeNumber: `EMP-${Math.random().toString(36).slice(2, 7)}`,
        firstName: 'Amina',
        surname: 'Yusuf',
        employmentDate: new Date('2026-01-01'),
        departmentId: fixture.departmentId,
        branchId: fixture.branchId,
        costCentreId: fixture.costCentreId,
        bankName: 'Test Bank',
        accountNumber: '0123456789',
        taxState: 'Lagos',
        actorId: fixture.makerId,
        ...overrides,
      });
    }

    it('computes the pensionable base from flagged components, not from gross', async () => {
      await seedSalaryComponents();
      const employee = await makeEmployee();

      // The statutory workbook's EMP001: 180,000 / 72,000 / 45,000 / 30,000.
      for (const [code, amount] of [
        ['BASIC', 180_000_00n],
        ['HOUSING', 72_000_00n],
        ['TRANSPORT', 45_000_00n],
        ['MEAL', 30_000_00n],
      ] as const) {
        await employees.setSalaryComponent({
          employeeId: employee.id,
          componentCode: code,
          amount: kobo(amount),
          effectiveFrom: new Date('2026-01-01'),
          actorId: fixture.makerId,
        });
      }

      const snapshot = await employees.salarySnapshot(employee.id, JAN);
      expect(snapshot.grossPayKobo).toBe('32700000');
      // Workbook Payroll_Calculation column K: 297,000 — basic+housing+transport.
      expect(snapshot.pensionableEmolumentsKobo).toBe('29700000');
      expect(snapshot.taxableGrossKobo).toBe('32700000');
    });

    it('closes the previous assignment rather than editing it', async () => {
      await seedSalaryComponents();
      const employee = await makeEmployee();

      await employees.setSalaryComponent({
        employeeId: employee.id,
        componentCode: 'BASIC',
        amount: kobo(180_000_00),
        effectiveFrom: new Date('2026-01-01'),
        actorId: fixture.makerId,
      });
      await employees.setSalaryComponent({
        employeeId: employee.id,
        componentCode: 'BASIC',
        amount: kobo(220_000_00),
        effectiveFrom: new Date('2026-07-01'),
        actorId: fixture.makerId,
      });

      const history = await prisma.employeeSalaryComponent.findMany({
        where: { employeeId: employee.id },
        orderBy: { effectiveFrom: 'asc' },
      });
      expect(history).toHaveLength(2);
      expect(history[0]!.effectiveTo?.toISOString().slice(0, 10)).toBe('2026-06-30');

      const before = await employees.salarySnapshot(employee.id, new Date('2026-03-01'));
      const after = await employees.salarySnapshot(employee.id, new Date('2026-08-01'));
      expect(before.grossPayKobo).toBe('18000000');
      expect(after.grossPayKobo).toBe('22000000');
    });

    it('refuses overlapping assignments for the same component, at the database', async () => {
      await seedSalaryComponents();
      const employee = await makeEmployee();
      const component = await prisma.salaryComponent.findFirstOrThrow({
        where: { companyId: fixture.companyId, code: 'BASIC' },
      });

      await prisma.employeeSalaryComponent.create({
        data: {
          employeeId: employee.id,
          salaryComponentId: component.id,
          amountKobo: 100_000_00n,
          effectiveFrom: new Date('2026-01-01'),
        },
      });

      await expect(
        prisma.employeeSalaryComponent.create({
          data: {
            employeeId: employee.id,
            salaryComponentId: component.id,
            amountKobo: 150_000_00n,
            effectiveFrom: new Date('2026-06-01'),
          },
        }),
      ).rejects.toThrow();
    });

    it('blocks payroll activation while a mandatory field is missing', async () => {
      await seedSalaryComponents();
      const employee = await makeEmployee({ costCentreId: null });
      await employees.setSalaryComponent({
        employeeId: employee.id,
        componentCode: 'BASIC',
        amount: kobo(180_000_00),
        effectiveFrom: new Date('2026-01-01'),
        actorId: fixture.makerId,
      });

      const readiness = await employees.payrollReadiness(employee.id, JAN);
      expect(readiness.ready).toBe(false);
      expect(readiness.blockers.join(' ')).toMatch(/No cost centre assigned/i);

      await expect(
        employees.activateForPayroll({
          employeeId: employee.id,
          on: JAN,
          actorId: fixture.makerId,
        }),
      ).rejects.toThrow(/cannot be activated for payroll/i);
    });

    it('blocks activation when enrolled in pension without an RSA number', async () => {
      await seedSalaryComponents();
      const employee = await makeEmployee({ pensionEnrolled: true });
      await employees.setSalaryComponent({
        employeeId: employee.id,
        componentCode: 'BASIC',
        amount: kobo(180_000_00),
        effectiveFrom: new Date('2026-01-01'),
        actorId: fixture.makerId,
      });

      const readiness = await employees.payrollReadiness(employee.id, JAN);
      expect(readiness.blockers.join(' ')).toMatch(/no RSA number/i);
    });

    it('blocks activation with no tax state, since PAYE could not be remitted', async () => {
      await seedSalaryComponents();
      const employee = await makeEmployee({ taxState: null });
      await employees.setSalaryComponent({
        employeeId: employee.id,
        componentCode: 'BASIC',
        amount: kobo(180_000_00),
        effectiveFrom: new Date('2026-01-01'),
        actorId: fixture.makerId,
      });

      const readiness = await employees.payrollReadiness(employee.id, JAN);
      expect(readiness.blockers.join(' ')).toMatch(/No tax state/i);
    });

    it('activates a complete employee', async () => {
      await seedSalaryComponents();
      const employee = await makeEmployee();
      await employees.setSalaryComponent({
        employeeId: employee.id,
        componentCode: 'BASIC',
        amount: kobo(180_000_00),
        effectiveFrom: new Date('2026-01-01'),
        actorId: fixture.makerId,
      });

      const activated = await employees.activateForPayroll({
        employeeId: employee.id,
        on: JAN,
        actorId: fixture.makerId,
      });
      expect(activated.payrollActive).toBe(true);

      const readiness = await employees.payrollReadiness(employee.id, JAN);
      expect(readiness.ready).toBe(true);
    });

    it('refuses a self-referencing reporting line, at the database', async () => {
      const employee = await makeEmployee();
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE employees SET reporting_manager_id = id WHERE id = $1::uuid`,
          employee.id,
        ),
      ).rejects.toThrow();
    });
  });
});
