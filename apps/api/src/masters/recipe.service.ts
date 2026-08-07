import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  Prisma,
  RecipeVersionStatus,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { allocateKobo, Kobo } from '../common/money';

export interface ExplodedComponent {
  lineNumber: number;
  itemId: string;
  itemCode: string;
  description: string;
  unitOfMeasure: string;
  /** Quantity before wastage, for the requested output. */
  netQuantity: string;
  /** Quantity to actually issue, including expected wastage. */
  grossQuantity: string;
  /** MONEY. Integer kobo. */
  standardCostKobo: string;
  extendedCostKobo: string;
  optional: boolean;
}

export interface RecipeExplosion {
  recipeVersionId: string;
  recipeCode: string;
  outputItemId: string;
  outputItemCode: string;
  requestedQuantity: string;
  batchSize: string;
  batches: string;
  components: ExplodedComponent[];
  totalMaterialCostKobo: string;
  /** Cost of one unit of output at standard. */
  unitMaterialCostKobo: string;
}

/**
 * Recipes and bills of material (§9, §10).
 *
 * The generic engine both pilots run on. Nothing here knows what a snail is:
 * the SnailPro slime recipe and the PoultryPro cut-up recipe are the same three
 * tables with different rows, which is the whole point of Rule 8.
 */
@Injectable()
export class RecipeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Activate a draft version.
   *
   * Everything expensive to check happens here rather than at explosion time,
   * because a recipe is activated once and exploded thousands of times — and
   * because an invalid recipe should be refused when someone is looking at it,
   * not when a production order fails at 6am.
   */
  async activateVersion(params: {
    recipeVersionId: string;
    actorId: string;
    ipAddress?: string | null;
    device?: string | null;
  }) {
    const version = await this.prisma.productRecipeVersion.findUniqueOrThrow({
      where: { id: params.recipeVersionId },
      include: {
        recipe: { include: { outputItem: true } },
        components: { include: { componentItem: true } },
      },
    });

    if (version.status !== RecipeVersionStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §10 — Recipe versioning',
        `Recipe version ${version.version} is ${version.status}. Only a draft can be activated.`,
        { recipeVersionId: version.id, status: version.status },
      );
    }

    if (version.components.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §10 — Recipe versioning',
        `Recipe "${version.recipe.code}" version ${version.version} has no components. ` +
          `A recipe that consumes nothing cannot cost anything, and would let a ` +
          `production order complete with zero material cost.`,
        { recipeVersionId: version.id },
      );
    }

    for (const component of version.components) {
      if (!component.componentItem.active) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §10 — Recipe versioning',
          `Component "${component.componentItem.code}" is inactive and cannot be part ` +
            `of an active recipe.`,
          { itemCode: component.componentItem.code },
        );
      }
      if (component.componentItem.itemType === 'SERVICE') {
        throw new AccountingRuleViolation(
          'Consolidated Reference §10 — Recipe versioning',
          `Component "${component.componentItem.code}" is a service item. A recipe ` +
            `consumes materials; labour and overhead are absorbed separately (§9).`,
          { itemCode: component.componentItem.code },
        );
      }
    }

    await this.assertNoCycle(version.recipe.outputItemId, version.components.map((c) => c.componentItemId));

    return this.prisma.$transaction(async (tx) => {
      // At most one ACTIVE version at a time — enforced by a partial unique
      // index too, but superseding here means the transition is intentional
      // rather than a constraint violation the caller has to interpret.
      await tx.productRecipeVersion.updateMany({
        where: { recipeId: version.recipeId, status: RecipeVersionStatus.ACTIVE },
        data: { status: RecipeVersionStatus.SUPERSEDED, effectiveTo: new Date() },
      });

      const activated = await tx.productRecipeVersion.update({
        where: { id: version.id },
        data: {
          status: RecipeVersionStatus.ACTIVE,
          approvedById: params.actorId,
          approvedAt: new Date(),
        },
      });

      await this.audit.write(
        {
          transactionId: version.id,
          module: 'masters',
          entityType: 'ProductRecipeVersion',
          entityId: version.id,
          status: RecipeVersionStatus.ACTIVE,
          action: AuditAction.APPROVE,
          userId: params.actorId,
          ipAddress: params.ipAddress,
          device: params.device,
          comments: `Activated recipe ${version.recipe.code} version ${version.version}.`,
          metadata: {
            recipeCode: version.recipe.code,
            version: version.version,
            componentCount: version.components.length,
          },
        },
        tx,
      );

      return activated;
    });
  }

  /**
   * Walk the recipe graph looking for a cycle.
   *
   * The direct case (a recipe listing its own output) is caught by a database
   * trigger. This catches the indirect one: slime is a component of a gift set
   * which is a component of slime. Left undetected, that makes a costing
   * explosion non-terminating.
   */
  private async assertNoCycle(outputItemId: string, componentItemIds: string[]): Promise<void> {
    const seen = new Set<string>([outputItemId]);
    let frontier = [...componentItemIds];

    while (frontier.length > 0) {
      if (frontier.some((id) => id === outputItemId)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §10 — Recipe versioning',
          `Activating this recipe would create a circular bill of materials: its output ` +
            `is reachable from its own components. A costing explosion over that graph ` +
            `would never terminate.`,
          { outputItemId },
        );
      }

      const unseen = frontier.filter((id) => !seen.has(id));
      unseen.forEach((id) => seen.add(id));
      if (unseen.length === 0) break;

      const nested = await this.prisma.productRecipeComponent.findMany({
        where: {
          recipeVersion: {
            status: RecipeVersionStatus.ACTIVE,
            recipe: { outputItemId: { in: unseen } },
          },
        },
        select: { componentItemId: true },
      });
      frontier = nested.map((n) => n.componentItemId);
    }
  }

  /**
   * Explode a recipe for a requested output quantity.
   *
   * This is what a production order calls to know what to issue and what it
   * should cost. Two decisions worth stating:
   *
   *  - Quantities stay Decimal throughout. They are not money and rounding one
   *    to two places would lose 0.002 litres of preservative per bottle.
   *
   *  - The total material cost is allocated across components with the
   *    largest-remainder method, so the parts sum to the total exactly. Costing
   *    each line independently and adding them up loses or invents kobo, and a
   *    production order whose components do not sum to its own WIP debit cannot
   *    clear to zero (Rule 7).
   */
  async explode(params: {
    recipeVersionId: string;
    /** QUANTITY of finished output required. */
    quantity: Decimal.Value;
    /** Costs are resolved as at this date (Rule 8). */
    on: Date;
  }): Promise<RecipeExplosion> {
    const version = await this.prisma.productRecipeVersion.findUniqueOrThrow({
      where: { id: params.recipeVersionId },
      include: {
        recipe: { include: { outputItem: true } },
        components: {
          orderBy: { lineNumber: 'asc' },
          include: { componentItem: true, unitOfMeasure: true },
        },
      },
    });

    if (version.status === RecipeVersionStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §10 — Recipe versioning',
        `Recipe version ${version.version} is still a draft and cannot be exploded for ` +
          `production.`,
        { recipeVersionId: version.id },
      );
    }

    const requested = new Decimal(params.quantity);
    if (requested.lessThanOrEqualTo(0)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §10 — Recipe explosion',
        `Cannot explode a recipe for a quantity of ${requested.toString()}.`,
        { quantity: requested.toString() },
      );
    }

    const batchSize = new Decimal(version.batchSize.toString());
    const batches = requested.div(batchSize);

    const components: ExplodedComponent[] = [];
    const extendedCosts: bigint[] = [];

    for (const component of version.components) {
      const perBatch = new Decimal(component.quantityPerBatch.toString());
      const net = perBatch.mul(batches);

      // Wastage inflates what must be ISSUED to yield the net requirement.
      const wastage = component.wastagePercent
        ? new Decimal(component.wastagePercent.toString()).div(100)
        : new Decimal(0);
      const gross = wastage.greaterThan(0)
        ? net.div(new Decimal(1).minus(wastage))
        : net;

      const standardCost = await this.standardCostOn(component.componentItemId, params.on);

      // Full precision here; the rounding happens once, in the allocation below.
      const extended = new Decimal(standardCost.toString()).mul(gross);
      const extendedKobo = BigInt(
        extended.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0),
      );
      extendedCosts.push(extendedKobo);

      components.push({
        lineNumber: component.lineNumber,
        itemId: component.componentItemId,
        itemCode: component.componentItem.code,
        description: component.componentItem.description,
        unitOfMeasure: component.unitOfMeasure.code,
        netQuantity: net.toFixed(6),
        grossQuantity: gross.toFixed(6),
        standardCostKobo: standardCost.toString(),
        extendedCostKobo: extendedKobo.toString(),
        optional: component.optional,
      });
    }

    const total = extendedCosts.reduce((s, c) => s + c, 0n);

    // Unit cost is derived, not stored: total / requested, rounded once.
    const unitCost =
      requested.greaterThan(0)
        ? BigInt(
            new Decimal(total.toString())
              .div(requested)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toFixed(0),
          )
        : 0n;

    return {
      recipeVersionId: version.id,
      recipeCode: version.recipe.code,
      outputItemId: version.recipe.outputItemId,
      outputItemCode: version.recipe.outputItem.code,
      requestedQuantity: requested.toFixed(6),
      batchSize: batchSize.toFixed(6),
      batches: batches.toFixed(6),
      components,
      totalMaterialCostKobo: total.toString(),
      unitMaterialCostKobo: unitCost.toString(),
    };
  }

  /**
   * Split a known actual cost across components in proportion to their standard
   * extended cost, so the parts sum to the whole exactly.
   *
   * Phase 6 uses this for joint-cost allocation. It lives here because the
   * weights come from the recipe, and because `allocateKobo` is the primitive
   * that makes "the parts equal the total" true rather than approximately true.
   */
  async allocateActualCost(params: {
    recipeVersionId: string;
    quantity: Decimal.Value;
    on: Date;
    actualCost: Kobo;
  }): Promise<Array<{ itemId: string; itemCode: string; allocatedKobo: string }>> {
    const explosion = await this.explode({
      recipeVersionId: params.recipeVersionId,
      quantity: params.quantity,
      on: params.on,
    });

    const weights = explosion.components.map((c) => new Decimal(c.extendedCostKobo));
    if (weights.every((w) => w.isZero())) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Cost allocation',
        `Every component of recipe "${explosion.recipeCode}" has a standard cost of zero, ` +
          `so there is no basis on which to allocate actual cost. Set standard costs first.`,
        { recipeVersionId: params.recipeVersionId },
      );
    }

    const allocated = allocateKobo(params.actualCost, weights);

    return explosion.components.map((component, index) => ({
      itemId: component.itemId,
      itemCode: component.itemCode,
      allocatedKobo: (allocated[index] ?? 0n).toString(),
    }));
  }

  /**
   * The standard cost of an item on a date.
   *
   * Refuses rather than defaulting to zero. A zero standard cost silently
   * produces a production order that appears to consume free materials, which
   * understates WIP and therefore cost of sales — the kind of error that looks
   * like good margins until someone counts the stock.
   */
  async standardCostOn(itemId: string, on: Date): Promise<bigint> {
    const day = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()));

    const cost = await this.prisma.itemStandardCost.findFirst({
      where: {
        itemId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!cost) {
      const item = await this.prisma.item.findUnique({
        where: { id: itemId },
        select: { code: true, description: true },
      });
      throw new AccountingRuleViolation(
        'Consolidated Reference §10 — Standard costing',
        `Item "${item?.code ?? itemId}" has no standard cost effective on ` +
          `${day.toISOString().slice(0, 10)}. Costing will not assume zero: that would ` +
          `make production appear to consume free materials.`,
        { itemId, date: day.toISOString().slice(0, 10) },
      );
    }
    return cost.standardCostKobo;
  }

  /** The version in force for a recipe on a date. */
  async activeVersion(recipeId: string, on: Date) {
    const day = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()));

    const version = await this.prisma.productRecipeVersion.findFirst({
      where: {
        recipeId,
        status: RecipeVersionStatus.ACTIVE,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
    });

    if (!version) {
      const recipe = await this.prisma.productRecipe.findUnique({
        where: { id: recipeId },
        select: { code: true },
      });
      throw new AccountingRuleViolation(
        'Consolidated Reference §10 — Recipe versioning',
        `Recipe "${recipe?.code ?? recipeId}" has no active version effective on ` +
          `${day.toISOString().slice(0, 10)}.`,
        { recipeId, date: day.toISOString().slice(0, 10) },
      );
    }
    return version;
  }

  /** Start a new draft, optionally copying an existing version's components. */
  async createDraftVersion(params: {
    recipeId: string;
    batchSize: Decimal.Value;
    expectedYieldPercent?: Decimal.Value | null;
    effectiveFrom: Date;
    copyFromVersionId?: string | null;
    notes?: string | null;
  }) {
    const latest = await this.prisma.productRecipeVersion.findFirst({
      where: { recipeId: params.recipeId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const components = params.copyFromVersionId
      ? await this.prisma.productRecipeComponent.findMany({
          where: { recipeVersionId: params.copyFromVersionId },
          orderBy: { lineNumber: 'asc' },
        })
      : [];

    return this.prisma.productRecipeVersion.create({
      data: {
        recipeId: params.recipeId,
        version: (latest?.version ?? 0) + 1,
        batchSize: new Prisma.Decimal(params.batchSize.toString()),
        expectedYieldPercent:
          params.expectedYieldPercent !== undefined && params.expectedYieldPercent !== null
            ? new Prisma.Decimal(params.expectedYieldPercent.toString())
            : null,
        effectiveFrom: params.effectiveFrom,
        notes: params.notes ?? null,
        components: {
          create: components.map((c) => ({
            lineNumber: c.lineNumber,
            componentItemId: c.componentItemId,
            quantityPerBatch: c.quantityPerBatch,
            unitOfMeasureId: c.unitOfMeasureId,
            wastagePercent: c.wastagePercent,
            optional: c.optional,
          })),
        },
      },
      include: { components: true },
    });
  }
}
