import { Injectable } from '@nestjs/common';
import { RoutingService } from '../routing/routing.service';
import { JointCostService } from './joint-cost.service';
import { StandardCostService } from './standard-cost.service';
import { nextReference, siteOf } from '../numbering/numbering';
import Decimal from 'decimal.js';
import { AuditAction, Prisma, ProductionOrderCycle, ProductionOrderStatus } from '@bioassetpro/database';
import { chartVersionOf, speciesNumberFor } from '../chart/chart';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { RecipeService } from '../masters/recipe.service';
import { PostingControlService, ResolvedRule } from '../posting-control/posting-control.service';
import { StockMovementService } from '../inventory/stock-movement.service';
import { CostAllocationService, AllocationOutput, AllocatedOutput, CostAllocationMethod } from './cost-allocation.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo, Kobo } from '../common/money';

/**
 * Which PCR rule this order's processing cycle uses at each step. SnailPro
 * (PCR-051–058) and PoultryPro (PCR-074–080) are the same eight-step shape
 * with one real difference: snail posts actual labour and actual overhead
 * as two separate lines (PCR-054/055, each its own account); poultry posts
 * one combined actual-conversion line (PCR-077, a single pool account) —
 * `actualConversionRuleId` is set for poultry and null for snail, and
 * `confirmConversion()` branches on which one is set.
 *
 * Feed Mill (PCR-032–036) is a genuinely smaller five-step cycle: no
 * biological-input leg at all (`issueRuleId: null` — its one issue rule IS
 * the "packaging" leg, PCR-032), and no dedicated actual-conversion posting
 * rule either (`actualLabourRuleId`/`actualConversionRuleId` both null) —
 * PCR-033 only ever posts standard absorption; actual resource cost
 * reappears solely as an input to PCR-036's variance calculation at
 * settlement, never its own journal. `confirmConversion()`'s third branch
 * (both actual-rule ids null) covers this.
 */
interface ProcessingCycleRules {
  /** PCR-051 / PCR-074 / null — biological input issued to WIP. Null for Feed Mill,
   * which has no biological population and posts its one issue leg as "packaging" below. */
  issueRuleId: string | null;
  /** PCR-052 / PCR-075 / PCR-032 — the recipe/BOM issue. Fully atomic both sides. */
  packagingRuleId: string;
  /** PCR-053 / PCR-076 / PCR-033 — standard conversion absorbed. Fully atomic both sides. */
  standardRuleId: string;
  /** PCR-054 / null / null — snail's separate actual-labour line. Fully atomic both sides. */
  actualLabourRuleId: string | null;
  /** PCR-055 / null / null — snail's separate actual-overhead line. Credit side is non-atomic. */
  actualOverheadRuleId: string | null;
  /** null / PCR-077 / null — poultry's single combined actual-conversion line. Credit side is non-atomic. */
  actualConversionRuleId: string | null;
  /** PCR-056 / PCR-078 / PCR-035 — abnormal processing loss. Fully atomic both sides. */
  abnormalLossRuleId: string;
  /** PCR-057 / PCR-079 / PCR-034 — completion (Dr FG / Cr WIP). Fully atomic both sides. */
  completionRuleId: string;
  /** PCR-058-DR / PCR-080-DR / PCR-036-DR — settlement variance debit key. The rule's credit
   * side is non-atomic for every cycle ("recovery/actual pool"), so only the debit key is
   * used through PostingControlService; the credit resolves to `recoveryAccountNumber` below. */
  settleDebitKey: string;
  /** 219810 / 219820 / 219830 — the clearing account standard absorption already
   * credited, closed by settle(). */
  recoveryAccountNumber: string;
}

const PROCESSING_CYCLE_RULES: Record<ProductionOrderCycle, ProcessingCycleRules> = {
  SNAILPRO: {
    issueRuleId: 'PCR-051',
    packagingRuleId: 'PCR-052',
    standardRuleId: 'PCR-053',
    actualLabourRuleId: 'PCR-054',
    actualOverheadRuleId: 'PCR-055',
    actualConversionRuleId: null,
    abnormalLossRuleId: 'PCR-056',
    completionRuleId: 'PCR-057',
    settleDebitKey: 'PCR-058-DR',
    recoveryAccountNumber: '219810',
  },
  POULTRYPRO: {
    issueRuleId: 'PCR-074',
    packagingRuleId: 'PCR-075',
    standardRuleId: 'PCR-076',
    actualLabourRuleId: null,
    actualOverheadRuleId: null,
    actualConversionRuleId: 'PCR-077',
    abnormalLossRuleId: 'PCR-078',
    completionRuleId: 'PCR-079',
    settleDebitKey: 'PCR-080-DR',
    recoveryAccountNumber: '219820',
  },
  FEED_MILL: {
    issueRuleId: null,
    packagingRuleId: 'PCR-032',
    standardRuleId: 'PCR-033',
    actualLabourRuleId: null,
    actualOverheadRuleId: null,
    actualConversionRuleId: null,
    abnormalLossRuleId: 'PCR-035',
    completionRuleId: 'PCR-034',
    settleDebitKey: 'PCR-036-DR',
    recoveryAccountNumber: '219830',
  },
};

/**
 * Production orders: market snails or birds harvested and processed, or raw
 * ingredients milled into feed — issued to WIP, conversion cost confirmed,
 * outputs received into finished goods, order settles at exactly zero WIP.
 * One engine, driven by `PROCESSING_CYCLE_RULES` above and `order.
 * processingCycle` — SnailPro (PCR-051–058) was built and live-verified
 * first; PoultryPro (PCR-074–080) and Feed Mill (PCR-032–036) reuse every
 * method here, selecting their own rule ids from the order's own cycle.
 *
 * SnailPro/PoultryPro's input is NOT a recipe component. A live population is
 * a biological asset (`LivestockGroup`), not an `Item` — the issue step posts
 * Dr WIP / Cr the population's own BA account, valued at its IAS 41 carrying
 * value, the same way every other biological-asset transfer in this codebase
 * already posts. `recipeVersionId` governs the PACKAGING components only.
 * Feed Mill has no biological input at all — its recipe IS the whole issue,
 * raw ingredients milled into one finished feed product; see `createFeedOrder()`.
 * See the schema's file-level comment for the full rationale.
 */
@Injectable()
export class ProductionOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly recipes: RecipeService,
    private readonly postingControl: PostingControlService,
    private readonly stockMovements: StockMovementService,
    private readonly costAllocation: CostAllocationService,
  ) {}

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Start an order from a harvest. One order per harvest — `harvestRecordId`
   * is unique, so a second attempt against the same harvest is refused
   * rather than silently double-counting its WIP debit.
   */
  async createFromHarvest(params: {
    harvestRecordId: string;
    recipeVersionId: string;
    warehouseId: string;
    /** Given by NumberingService when not supplied (Numbering_Parameters). */
    orderNumber?: string;
    plannedOutputQuantity: Decimal.Value;
    actor: WorkflowActor;
  }): Promise<{ id: string; orderNumber: string }> {
    const harvest = await this.prisma.harvestRecord.findUniqueOrThrow({
      where: { id: params.harvestRecordId },
      include: { group: true, productionOrder: true },
    });
    const orderNumber =
      params.orderNumber?.trim() ||
      (await nextReference(this.prisma, {
        companyId: harvest.companyId,
        type: 'PRO',
        site: await siteOf(this.prisma, { farmId: harvest.group.farmId, branchId: harvest.group.branchId }),
        date: new Date(),
      }));


    if (harvest.productionOrder) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `Harvest ${harvest.id} already has a processing order. A second order against the ` +
          `same harvest would double-count its WIP debit.`,
        { harvestRecordId: harvest.id },
      );
    }

    if (harvest.group.currentFvlctsPerUnitKobo === null) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §61 — Biological asset valuation',
        `${harvest.group.code} has never been valued, so the population this harvest took ` +
          `has no carrying value to move into WIP. Post a valuation first.`,
        { groupId: harvest.groupId },
      );
    }

    const biologicalInputValueKobo = BigInt(harvest.count) * harvest.group.currentFvlctsPerUnitKobo;
    // The feed and treatments these animals ate, at weighted average, taken
    // out of the population when they were harvested (RearingCostService).
    const rearingRelief = await this.prisma.livestockRearingRelief.findUnique({
      where: {
        groupId_eventType_sourceId: { groupId: harvest.groupId, eventType: 'HARVEST', sourceId: harvest.id },
      },
    });
    const rearingCostKobo = rearingRelief?.amountKobo ?? 0n;
    const processingCycle = this.cycleForSpecies(harvest.group.speciesKey);

    const explosion = await this.recipes.explode({
      recipeVersionId: params.recipeVersionId,
      quantity: params.plannedOutputQuantity,
      on: harvest.harvestedOn,
    });

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.create({
        data: {
          companyId: harvest.companyId,
          branchId: harvest.group.branchId,
          farmId: harvest.group.farmId,
          orderNumber,
          recipeVersionId: params.recipeVersionId,
          sourceGroupId: harvest.groupId,
          harvestRecordId: harvest.id,
          processingCycle,
          plannedOutputQuantity: new Prisma.Decimal(new Decimal(params.plannedOutputQuantity).toFixed(6)),
          biologicalInputValueKobo,
          rearingCostKobo,
          createdById: params.actor.userId,
          components: {
            create: explosion.components.map((component) => ({
              lineNumber: component.lineNumber,
              componentItemId: component.itemId,
              plannedQuantity: new Prisma.Decimal(component.grossQuantity),
              plannedCostKobo: BigInt(component.extendedCostKobo),
            })),
          },
        },
      });

      await this.audit.write(
        {
          transactionId: order.id,
          module: 'production',
          entityType: 'ProductionOrder',
          entityId: order.id,
          status: order.status,
          action: AuditAction.CREATE,
          userId: params.actor.userId,
          ipAddress: params.actor.ipAddress,
          device: params.actor.device,
          comments: `Raised processing order ${order.orderNumber} from harvest of ${harvest.group.code} — ${harvest.count} animals.`,
        },
        tx,
      );

      return { id: order.id, orderNumber: order.orderNumber };
    }, { timeout: 15000 });
  }

  /**
   * Start a Feed Mill order. Unlike `createFromHarvest()`, there is no
   * biological population and no harvest to derive dimensions from — the
   * caller supplies `branchId`/`farmId`/`warehouseId` directly, and the
   * recipe explosion IS the whole issue (raw ingredients milled into one
   * finished feed product), not a packaging-only BOM on top of a biological
   * transfer. `biologicalInputValueKobo` stays 0 — Rule 7's identity still
   * holds unchanged, since that term simply drops out.
   */
  async createFeedOrder(params: {
    companyId: string;
    branchId: string;
    farmId: string;
    warehouseId: string;
    recipeVersionId: string;
    /** Given by NumberingService when not supplied (Numbering_Parameters). */
    orderNumber?: string;
    plannedOutputQuantity: Decimal.Value;
    actor: WorkflowActor;
  }): Promise<{ id: string; orderNumber: string }> {
    const orderNumber =
      params.orderNumber?.trim() ||
      (await nextReference(this.prisma, {
        companyId: params.companyId,
        type: 'PRO',
        site: await siteOf(this.prisma, { farmId: params.farmId, branchId: params.branchId }),
        date: new Date(),
      }));

    const explosion = await this.recipes.explode({
      recipeVersionId: params.recipeVersionId,
      quantity: params.plannedOutputQuantity,
      on: new Date(),
    });

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.create({
        data: {
          companyId: params.companyId,
          branchId: params.branchId,
          farmId: params.farmId,
          orderNumber,
          recipeVersionId: params.recipeVersionId,
          processingCycle: ProductionOrderCycle.FEED_MILL,
          plannedOutputQuantity: new Prisma.Decimal(new Decimal(params.plannedOutputQuantity).toFixed(6)),
          biologicalInputValueKobo: 0n,
          createdById: params.actor.userId,
          components: {
            create: explosion.components.map((component) => ({
              lineNumber: component.lineNumber,
              componentItemId: component.itemId,
              plannedQuantity: new Prisma.Decimal(component.grossQuantity),
              plannedCostKobo: BigInt(component.extendedCostKobo),
            })),
          },
        },
      });

      await this.audit.write(
        {
          transactionId: order.id,
          module: 'production',
          entityType: 'ProductionOrder',
          entityId: order.id,
          status: order.status,
          action: AuditAction.CREATE,
          userId: params.actor.userId,
          ipAddress: params.actor.ipAddress,
          device: params.actor.device,
          comments: `Raised feed mill order ${order.orderNumber} for ${params.plannedOutputQuantity} planned output.`,
        },
        tx,
      );

      return { id: order.id, orderNumber: order.orderNumber };
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Workflow
  // -------------------------------------------------------------------------

  async submit(params: { productionOrderId: string; actor: WorkflowActor }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: params.productionOrderId },
      include: { components: true },
    });

    if (order.status !== ProductionOrderStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status} and cannot be submitted.`,
        { orderNumber: order.orderNumber },
      );
    }

    const plannedPackagingKobo = order.components.reduce((sum, c) => sum + c.plannedCostKobo, 0n);

    const result = await this.workflow.submit({
      companyId: order.companyId,
      transactionType: 'PRODUCTION_ORDER',
      module: 'production',
      documentType: 'ProductionOrder',
      documentId: order.id,
      documentReference: order.orderNumber,
      amount: kobo(order.biologicalInputValueKobo + order.rearingCostKobo + plannedPackagingKobo),
      currencyId: (await this.baseCurrencyId(order.companyId)),
      branchId: order.branchId,
      farmId: order.farmId,
      actor: params.actor,
    });

    await this.prisma.productionOrder.update({
      where: { id: order.id },
      data: { status: ProductionOrderStatus.SUBMITTED, workflowTransactionId: result.transactionId },
    });

    return result;
  }

  /**
   * Bring the order's own status in from its workflow transaction.
   *
   * Approving a `PRODUCTION_ORDER` transaction posts nothing (autoPost is
   * false — see the schema comment), so no handler runs, so nothing writes
   * the outcome back onto the row on its own. Same gap `PurchaseOrderService
   * .syncRequisitionStatus()` already closed for requisitions — called
   * lazily wherever the order's current status is about to matter, not on a
   * timer.
   */
  async syncOrderStatus(productionOrderId: string): Promise<void> {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({ where: { id: productionOrderId } });

    if (
      order.status !== ProductionOrderStatus.SUBMITTED ||
      !order.workflowTransactionId
    ) {
      return;
    }

    const transaction = await this.prisma.workflowTransaction.findUnique({
      where: { id: order.workflowTransactionId },
      select: { status: true },
    });

    if (transaction?.status === 'REJECTED' || transaction?.status === 'CANCELLED') {
      await this.prisma.productionOrder.update({ where: { id: order.id }, data: { status: ProductionOrderStatus.CANCELLED } });
      return;
    }

    const approved = transaction?.status === 'APPROVED' || transaction?.status === 'POSTED';
    if (approved) {
      await this.prisma.productionOrder.update({ where: { id: order.id }, data: { status: ProductionOrderStatus.APPROVED } });
    }
  }

  // -------------------------------------------------------------------------
  // Issue — biological input + packaging
  // -------------------------------------------------------------------------

  async issueMaterials(params: {
    productionOrderId: string;
    /**
     * What was actually issued, per component line id, when it differs from
     * the standard (BOM) quantity. WIP takes the standard either way; the
     * difference is the material usage variance (PCR-052/075).
     */
    actualQuantities?: Record<string, Decimal.Value>;
    actor: WorkflowActor;
  }) {
    await this.syncOrderStatus(params.productionOrderId);

    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: params.productionOrderId },
      include: { components: true, sourceGroup: true },
    });

    if (order.status !== ProductionOrderStatus.APPROVED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; only an approved order may issue materials.`,
        { orderNumber: order.orderNumber },
      );
    }
    const rules = this.cycleRules(order.processingCycle);
    if (rules.issueRuleId && !order.sourceGroup) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} has no source population to issue.`,
        { orderNumber: order.orderNumber },
      );
    }

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Financial calendar',
        `No open period or cost centre to issue ${order.orderNumber} against.`,
        {},
      );
    }
    const dimensions = this.dimensions(order, context);

    /*
     * Every resolve/lookup that does NOT need to be inside the posting
     * transaction happens here, before it opens — Neon's round-trip latency
     * already blew Prisma's five-second interactive-transaction budget once
     * this session (see AuditService's own doc comment on the same lesson).
     * Only the writes below are transactional.
     *
     * Both the biological-input rule (PCR-051/074) and the packaging rule
     * (PCR-052/075/032) are fully atomic on both sides for every cycle, so
     * both resolve through PostingControlService directly — no separate
     * stageAccount() lookup needed, unlike US-897-035's own courtesy layer.
     * Feed Mill has no biological-input rule at all (`issueRuleId: null`) —
     * its one issue rule (PCR-032) IS the packaging rule below.
     */
    for (const [componentId, value] of Object.entries(params.actualQuantities ?? {})) {
      if (!order.components.some((c) => c.id === componentId)) {
        throw new AccountingRuleViolation('PCR-052 — Material issue', `${order.orderNumber} has no component line ${componentId}.`, { componentId });
      }
      if (value === '' || value === null || new Decimal(value).isNaN() || new Decimal(value).lt(0)) {
        throw new AccountingRuleViolation('PCR-052 — Material issue', 'Give each issued quantity as zero or more.', { componentId });
      }
    }
    const standardCosts = new StandardCostService(this.prisma, this.audit, this.recipes);
    const varianceAccount = await this.resolvePostingKeyAccount(order.companyId, rules.settleDebitKey);

    const [issueRule, packagingRule, componentItems] = await Promise.all([
      rules.issueRuleId
        ? this.postingControl.resolve({ companyId: order.companyId, ruleId: rules.issueRuleId, on: new Date() })
        : null,
      this.postingControl.resolve({ companyId: order.companyId, ruleId: rules.packagingRuleId, on: new Date() }),
      this.prisma.item.findMany({ where: { id: { in: order.components.map((c) => c.componentItemId) } } }),
    ]);
    const fallbackWarehouseId = componentItems.some((i) => !i.defaultWarehouseId)
      ? await this.defaultWarehouse(this.prisma, order.companyId)
      : null;
    const warehouseByItem = new Map(componentItems.map((i) => [i.id, i.defaultWarehouseId ?? fallbackWarehouseId!]));

    /*
     * Guarded the same way packagingLines below guards packagingTotal — a
     * harvest valued at exactly zero (no FVLCTS valuation posted yet, a
     * legitimate starting state, not an error) would otherwise produce a
     * debit-0/credit-0 line pair, which PostingService.post() correctly
     * refuses as an empty line, blocking issue() entirely for that order.
     */
    const lines =
      issueRule && rules.issueRuleId && order.biologicalInputValueKobo > 0n
        ? [
            {
              glAccountId: this.requireSide(issueRule.debit, rules.issueRuleId, 'debit').glAccountId,
              description: `${rules.issueRuleId} — biological input issued to processing (${order.orderNumber})`,
              debit: kobo(order.biologicalInputValueKobo),
              dimensions,
            },
            {
              glAccountId: this.requireSide(issueRule.credit, rules.issueRuleId, 'credit').glAccountId,
              description: `${rules.issueRuleId} — biological input issued to processing (${order.orderNumber})`,
              credit: kobo(order.biologicalInputValueKobo),
              dimensions,
            },
          ]
        : [];

    /*
     * The harvested animals' rearing cost — feed and treatments absorbed in
     * the population's WIP (1501) — follows them into processing, so the
     * finished goods carry the feed that produced them. Debited to the same
     * processing WIP as the biological input; credited out of rearing WIP.
     */
    // 1501 on the old chart; 130210 for poultry on the client's (a snail
    // population holds no rearing cost there, so carries none into here).
    const rearingNumber = speciesNumberFor(
      await chartVersionOf(this.prisma, order.companyId),
      'rearingCost',
      order.processingCycle === 'SNAILPRO' ? 'snail' : 'poultry',
    );
    const rearingWip =
      order.rearingCostKobo > 0n && rearingNumber
        ? await this.prisma.gLAccount.findFirst({
            where: { companyId: order.companyId, accountNumber: rearingNumber, active: true },
            select: { id: true },
          })
        : null;
    if (order.rearingCostKobo > 0n && (!issueRule || !rules.issueRuleId || !rearingWip)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} carries rearing cost but there is no processing WIP rule or no active ` +
          'Work in Progress (1501) account to move it with.',
        { orderNumber: order.orderNumber },
      );
    }
    const rearingLines =
      order.rearingCostKobo > 0n && issueRule && rules.issueRuleId && rearingWip
        ? [
            {
              glAccountId: this.requireSide(issueRule.debit, rules.issueRuleId, 'debit').glAccountId,
              description: `Rearing cost of the harvested population, into processing (${order.orderNumber})`,
              debit: kobo(order.rearingCostKobo),
              dimensions,
            },
            {
              glAccountId: rearingWip.id,
              description: `Rearing cost out of the population's WIP (${order.orderNumber})`,
              credit: kobo(order.rearingCostKobo),
              dimensions,
            },
          ]
        : [];

    return this.prisma.$transaction(async (tx) => {
      // POL-001 / AC-MFG-002: the year's standard-cost policy, locked by the
      // first production posting in it.
      await standardCosts.requirePolicy(tx, order.companyId, new Date());

      /*
       * PCR-052/075/032: WIP takes each line at standard — BOM quantity ×
       * approved standard rate, which is the line's planned cost. Inventory
       * gives up what was actually issued at moving-average cost (POL-002).
       * The difference is split: usage is the extra (or saved) quantity at
       * the standard rate, price is the rest (500_Std_Cost).
       */
      let standardTotal = 0n;
      let actualTotal = 0n;
      let usageTotal = 0n;
      let priceTotal = 0n;
      const packagingLines: typeof lines = [];
      for (const component of order.components) {
        const standardQty = new Decimal(component.plannedQuantity.toString());
        const given = params.actualQuantities?.[component.id];
        const actualQty = given === undefined ? standardQty : new Decimal(given);
        if (standardQty.lte(0) && actualQty.lte(0)) continue;
        const issued = actualQty.gt(0)
          ? await this.stockMovements.issueOut({
              tx,
              companyId: order.companyId,
              branchId: order.branchId,
              itemId: component.componentItemId,
              warehouseId: warehouseByItem.get(component.componentItemId)!,
              quantity: actualQty,
              sourceModule: 'production',
              sourceDocumentType: 'ProductionOrder',
              sourceDocumentId: order.id,
              documentReference: order.orderNumber,
              movementDate: new Date(),
            })
          : { valueKobo: 0n, stockMovementId: null };
        const standard = component.plannedCostKobo;
        const usage = standardQty.gt(0)
          ? BigInt(actualQty.minus(standardQty).mul(standard.toString()).div(standardQty).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0))
          : issued.valueKobo;
        const price = issued.valueKobo - standard - usage;
        await tx.productionOrderComponent.update({
          where: { id: component.id },
          data: {
            issuedQuantity: new Prisma.Decimal(actualQty.toFixed(6)),
            issuedCostKobo: issued.valueKobo,
            stockMovementId: issued.stockMovementId,
            usageVarianceKobo: usage,
            priceVarianceKobo: price,
          },
        });
        standardTotal += standard;
        actualTotal += issued.valueKobo;
        usageTotal += usage;
        priceTotal += price;
      }

      const wipAccount = this.requireSide(packagingRule.debit, rules.packagingRuleId, 'debit').glAccountId;
      const stockAccount = this.requireSide(packagingRule.credit, rules.packagingRuleId, 'credit').glAccountId;
      if (standardTotal > 0n) {
        packagingLines.push({
          glAccountId: wipAccount,
          description: `${rules.packagingRuleId} — materials issued at standard (${order.orderNumber})`,
          debit: kobo(standardTotal),
          dimensions,
        });
      }
      if (actualTotal > 0n) {
        packagingLines.push({
          glAccountId: stockAccount,
          description: `${rules.packagingRuleId} — materials issued at moving average (${order.orderNumber})`,
          credit: kobo(actualTotal),
          dimensions,
        });
      }
      for (const [label, amount] of [['usage', usageTotal], ['price', priceTotal]] as const) {
        if (amount === 0n) continue;
        packagingLines.push({
          glAccountId: varianceAccount,
          description: `Material ${label} variance, ${amount > 0n ? 'adverse' : 'favourable'} (${order.orderNumber})`,
          ...(amount > 0n ? { debit: kobo(amount) } : { credit: kobo(-amount) }),
          dimensions,
        });
      }
      const packagingTotal = standardTotal;

      const result = await this.posting.post(
        {
          sourceModule: 'production',
          sourceDocumentType: 'ProductionOrder',
          sourceDocumentId: order.id,
          journalNumber: `${order.orderNumber}-ISSUE`,
          journalDate: new Date(),
          narration: `Issue materials to processing order ${order.orderNumber}`,
          ...dimensions,
          idempotencyKey: `production-order:${order.id}:issue`,
          actor: params.actor,
          lines: [...lines, ...rearingLines, ...packagingLines],
        },
        tx,
      );

      if (rearingLines.length > 0 && order.harvestRecordId && order.sourceGroupId) {
        await tx.livestockRearingRelief.updateMany({
          where: {
            groupId: order.sourceGroupId,
            eventType: 'HARVEST',
            sourceId: order.harvestRecordId,
            journalEntryId: null,
          },
          data: { journalEntryId: result.journalEntryId },
        });
      }

      await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: ProductionOrderStatus.RELEASED,
          packagingCostKobo: packagingTotal,
          materialUsageVarianceKobo: usageTotal,
          materialPriceVarianceKobo: priceTotal,
          issueJournalEntryId: result.journalEntryId,
          issuedAt: new Date(),
        },
      });

      await this.audit.write(
        {
          transactionId: order.id,
          module: 'production',
          entityType: 'ProductionOrder',
          entityId: order.id,
          status: ProductionOrderStatus.RELEASED,
          action: AuditAction.POST,
          userId: params.actor.userId,
          comments: `Issued ${order.orderNumber}: biological input ${order.biologicalInputValueKobo} kobo, materials ${packagingTotal} kobo at standard (actual ${actualTotal}; usage variance ${usageTotal}, price variance ${priceTotal}).`,
        },
        tx,
      );

      return result;
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Confirm labour/overhead — standard absorption + actual cost
  // -------------------------------------------------------------------------

  async confirmConversion(params: {
    productionOrderId: string;
    /**
     * Only for an order whose recipe has no routing. With a routing the
     * standard is derived — actual hours × each operation's approved rate
     * (PCR-053) — and a typed figure that disagrees is refused.
     */
    standardConversionCostKobo?: bigint;
    /** Actual driver quantity per routing operation (keyed by operation name or line id); standard hours where omitted. */
    actualHours?: Record<string, number | string>;
    actualLabourCostKobo: bigint;
    actualOverheadCostKobo: bigint;
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: params.productionOrderId },
      include: { sourceGroup: true },
    });

    if (order.status !== ProductionOrderStatus.RELEASED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; materials must be issued before conversion is confirmed.`,
        { orderNumber: order.orderNumber },
      );
    }
    const rules = this.cycleRules(order.processingCycle);

    // --- The standard, from the routing (ABC_Pools_Drivers, PCR-053) --------
    const routing = new RoutingService(this.prisma, this.audit);
    await routing.snapshotRouting(order.id);
    const lines = await this.prisma.productionOrderRoutingLine.findMany({
      where: { productionOrderId: order.id },
      include: { routingOperation: { select: { operationName: true } } },
    });
    let standardConversionCostKobo: bigint;
    if (lines.length > 0) {
      const absorbed = lines.map((line) => {
        const given = params.actualHours?.[line.id] ?? params.actualHours?.[line.routingOperation.operationName];
        const hours = given === undefined || given === '' ? new Decimal(line.standardHours.toString()) : new Decimal(given);
        if (hours.lt(0)) {
          throw new AccountingRuleViolation('ABC_Pools_Drivers — driver quantity', `${line.routingOperation.operationName}: hours cannot be negative.`, {});
        }
        const cost = BigInt(hours.mul(line.ratePerHourKobo.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
        return { id: line.id, hours, cost };
      });
      standardConversionCostKobo = absorbed.reduce((sum, a) => sum + a.cost, 0n);
      if (params.standardConversionCostKobo !== undefined && params.standardConversionCostKobo !== standardConversionCostKobo) {
        throw new AccountingRuleViolation(
          'PCR-053 — Standard conversion from the routing',
          `${order.orderNumber}'s standard conversion comes from its routing: ${standardConversionCostKobo} kobo (actual hours × approved rates), not the ${params.standardConversionCostKobo} kobo given.`,
          { derived: standardConversionCostKobo.toString() },
        );
      }
      for (const a of absorbed) {
        await this.prisma.productionOrderRoutingLine.update({
          where: { id: a.id },
          data: { actualHours: new Prisma.Decimal(a.hours.toFixed(6)), absorbedCostKobo: a.cost },
        });
      }
    } else {
      if (params.standardConversionCostKobo === undefined) {
        throw new AccountingRuleViolation(
          'PCR-053 — Standard conversion',
          `${order.orderNumber}'s recipe has no routing, so give its standard conversion cost — or set up the routing (operations, cost pools and rates) so it is worked out.`,
          {},
        );
      }
      standardConversionCostKobo = params.standardConversionCostKobo;
    }

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }
    const dimensions = this.dimensions(order, context);

    const on = new Date();
    const standardRule = await this.postingControl.resolve({ companyId: order.companyId, ruleId: rules.standardRuleId, on });

    let postLines: Array<{ glAccountId: string; description: string; debit?: Kobo; credit?: Kobo; dimensions: ReturnType<ProductionOrderService['dimensions']> }>;

    if (!rules.actualConversionRuleId && !rules.actualLabourRuleId) {
      // Feed Mill: no dedicated actual-conversion posting rule exists at all
      // (PCR-033's basis is "driver quantity × approved standard rate" only)
      // — post the standard absorption line and nothing else. The caller's
      // actual cost figures are still stored on the order row below, unposted,
      // for settle()'s variance calculation to read later.
      postLines = [
        {
          glAccountId: this.requireSide(standardRule.debit, rules.standardRuleId, 'debit').glAccountId,
          description: `${rules.standardRuleId} — standard conversion absorbed (${order.orderNumber})`,
          debit: kobo(standardConversionCostKobo),
          dimensions,
        },
        {
          glAccountId: this.requireSide(standardRule.credit, rules.standardRuleId, 'credit').glAccountId,
          description: `${rules.standardRuleId} — standard conversion absorbed (${order.orderNumber})`,
          credit: kobo(standardConversionCostKobo),
          dimensions,
        },
      ];
    } else if (rules.actualConversionRuleId) {
      // Poultry: one combined actual-conversion line (PCR-077). Its credit
      // key ("Payroll/AP/FA source") is non-atomic — resolve() validates both
      // sides eagerly, so calling it at all would throw before the (perfectly
      // atomic) debit side could ever be used. The debit is looked up
      // directly; the credit is the same disclosed Trade-Payables policy
      // FixedAssetService already uses for its own dual-account key.
      const combinedActual = params.actualLabourCostKobo + params.actualOverheadCostKobo;
      const [actualDebitAccountId, payablesAccount] = await Promise.all([
        this.resolvePostingKeyAccount(order.companyId, `${rules.actualConversionRuleId}-DR`),
        this.tradePayablesAccount(order.companyId),
      ]);
      postLines = [
        {
          glAccountId: this.requireSide(standardRule.debit, rules.standardRuleId, 'debit').glAccountId,
          description: `${rules.standardRuleId} — standard conversion absorbed (${order.orderNumber})`,
          debit: kobo(standardConversionCostKobo),
          dimensions,
        },
        {
          glAccountId: this.requireSide(standardRule.credit, rules.standardRuleId, 'credit').glAccountId,
          description: `${rules.standardRuleId} — standard conversion absorbed (${order.orderNumber})`,
          credit: kobo(standardConversionCostKobo),
          dimensions,
        },
        {
          glAccountId: actualDebitAccountId,
          description: `${rules.actualConversionRuleId} — actual processing conversion (${order.orderNumber})`,
          debit: kobo(combinedActual),
          dimensions,
        },
        {
          glAccountId: payablesAccount,
          description: `${rules.actualConversionRuleId} — actual processing conversion (${order.orderNumber})`,
          credit: kobo(combinedActual),
          dimensions,
        },
      ];
    } else {
      // Snail: two separate actual lines (PCR-054 labour, PCR-055
      // overhead), the latter's credit side non-atomic the same way.
      const [labourRule, overheadDebitAccountId, payablesAccount] = await Promise.all([
        this.postingControl.resolve({ companyId: order.companyId, ruleId: rules.actualLabourRuleId!, on }),
        this.resolvePostingKeyAccount(order.companyId, `${rules.actualOverheadRuleId}-DR`),
        this.tradePayablesAccount(order.companyId),
      ]);
      postLines = [
        {
          glAccountId: this.requireSide(standardRule.debit, rules.standardRuleId, 'debit').glAccountId,
          description: `${rules.standardRuleId} — standard conversion absorbed (${order.orderNumber})`,
          debit: kobo(standardConversionCostKobo),
          dimensions,
        },
        {
          glAccountId: this.requireSide(standardRule.credit, rules.standardRuleId, 'credit').glAccountId,
          description: `${rules.standardRuleId} — standard conversion absorbed (${order.orderNumber})`,
          credit: kobo(standardConversionCostKobo),
          dimensions,
        },
        {
          glAccountId: this.requireSide(labourRule.debit, rules.actualLabourRuleId!, 'debit').glAccountId,
          description: `${rules.actualLabourRuleId} — actual processing labour (${order.orderNumber})`,
          debit: kobo(params.actualLabourCostKobo),
          dimensions,
        },
        {
          glAccountId: this.requireSide(labourRule.credit, rules.actualLabourRuleId!, 'credit').glAccountId,
          description: `${rules.actualLabourRuleId} — actual processing labour (${order.orderNumber})`,
          credit: kobo(params.actualLabourCostKobo),
          dimensions,
        },
        {
          glAccountId: overheadDebitAccountId,
          description: `${rules.actualOverheadRuleId} — actual processing overhead (${order.orderNumber})`,
          debit: kobo(params.actualOverheadCostKobo),
          dimensions,
        },
        {
          glAccountId: payablesAccount,
          description: `${rules.actualOverheadRuleId} — actual processing overhead (${order.orderNumber})`,
          credit: kobo(params.actualOverheadCostKobo),
          dimensions,
        },
      ];
    }
    postLines = postLines.filter((line) => (line.debit ?? line.credit ?? 0n) > 0n);

    return this.prisma.$transaction(async (tx) => {

      const result = await this.posting.post(
        {
          sourceModule: 'production',
          sourceDocumentType: 'ProductionOrder',
          sourceDocumentId: order.id,
          journalNumber: `${order.orderNumber}-CONV`,
          journalDate: on,
          narration: `Confirm conversion cost for processing order ${order.orderNumber}`,
          ...dimensions,
          idempotencyKey: `production-order:${order.id}:conversion`,
          actor: params.actor,
          lines: postLines,
        },
        tx,
      );

      await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: ProductionOrderStatus.IN_PRODUCTION,
          standardConversionCostKobo: standardConversionCostKobo,
          actualLabourCostKobo: params.actualLabourCostKobo,
          actualOverheadCostKobo: params.actualOverheadCostKobo,
          conversionJournalEntryId: result.journalEntryId,
        },
      });

      await this.audit.write(
        {
          transactionId: order.id,
          module: 'production',
          entityType: 'ProductionOrder',
          entityId: order.id,
          status: ProductionOrderStatus.IN_PRODUCTION,
          action: AuditAction.POST,
          userId: params.actor.userId,
          comments: `Confirmed conversion for ${order.orderNumber}: standard ${standardConversionCostKobo}, actual labour ${params.actualLabourCostKobo}, actual overhead ${params.actualOverheadCostKobo}.`,
        },
        tx,
      );

      return result;
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Abnormal loss
  // -------------------------------------------------------------------------

  async recordAbnormalLoss(params: {
    productionOrderId: string;
    quantity: Decimal.Value;
    costKobo: bigint;
    reason: string;
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: params.productionOrderId },
      include: { sourceGroup: true, recipeVersion: true },
    });

    if (order.status !== ProductionOrderStatus.IN_PRODUCTION) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; loss can only be recorded once conversion is confirmed and before outputs are received.`,
        { orderNumber: order.orderNumber },
      );
    }
    const rules = this.cycleRules(order.processingCycle);

    const wipDebits =
      order.biologicalInputValueKobo +
      order.rearingCostKobo +
      order.packagingCostKobo +
      order.standardConversionCostKobo;

    /*
     * Classification is decided here, against the recipe's own approved
     * tolerance, not left to whoever is recording the loss — the same
     * discipline `BiologicalAssetService.postMortality()` already applies to
     * mortality. PCR-056/078/035's own "blocking" condition reads "Normal
     * threshold exceeded" — the rule is only meant to fire once CUMULATIVE
     * loss claimed against this order exceeds what the recipe's expected
     * yield already bakes in as ordinary wastage. A recipe with no
     * `expectedYieldPercent` set has no governed tolerance yet, so the
     * allowance defaults to zero rather than assuming one — the same "don't
     * invent a threshold" stance this session has taken everywhere else (age
     * thresholds, etc.), which also preserves existing behaviour for every
     * recipe that predates this field.
     *
     * A claim can straddle the boundary — most of it within tolerance, a tail
     * beyond it — so the SPLIT, not the whole claim, is what gets posted:
     * only the portion pushing cumulative claimed loss past the allowance is
     * written off through PCR-056/078/035. The rest stays capitalised in WIP,
     * which is correct — it is exactly what `recordOutputs()`'s residual-plug
     * allocation is for: the same total WIP kobo spread across whatever
     * quantity of good output actually comes back, naturally raising the
     * per-unit cost rather than needing a separate write-off.
     */
    const normalLossAllowanceKobo = order.recipeVersion.expectedYieldPercent
      ? BigInt(
          new Decimal(wipDebits.toString())
            .mul(new Decimal(100).minus(order.recipeVersion.expectedYieldPercent.toString()))
            .div(100)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toFixed(0),
        )
      : 0n;

    const priorEvents = await this.prisma.productionOrderLossEvent.findMany({
      where: { productionOrderId: order.id },
      select: { costKobo: true },
    });
    const totalClaimedBefore = priorEvents.reduce((s, e) => s + e.costKobo, 0n);
    const totalClaimedAfter = totalClaimedBefore + params.costKobo;
    const previouslyAbnormal = totalClaimedBefore > normalLossAllowanceKobo ? totalClaimedBefore - normalLossAllowanceKobo : 0n;
    const cumulativeAbnormal = totalClaimedAfter > normalLossAllowanceKobo ? totalClaimedAfter - normalLossAllowanceKobo : 0n;
    const abnormalPortionKobo = cumulativeAbnormal - previouslyAbnormal;

    if (order.abnormalLossCostKobo + abnormalPortionKobo > wipDebits) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Processing loss',
        `${order.orderNumber}'s abnormal loss would exceed the WIP it was raised against — ` +
          `${wipDebits} kobo debited, ${order.abnormalLossCostKobo + abnormalPortionKobo} kobo of abnormal loss claimed.`,
        { orderNumber: order.orderNumber },
      );
    }

    if (abnormalPortionKobo === 0n) {
      await this.prisma.productionOrderLossEvent.create({
        data: {
          productionOrderId: order.id,
          quantity: new Prisma.Decimal(new Decimal(params.quantity).toFixed(6)),
          classification: 'NORMAL',
          costKobo: params.costKobo,
          reason: params.reason,
          journalEntryId: null,
        },
      });
      return {
        posted: false,
        classification: 'NORMAL' as const,
        reason: `Within ${order.orderNumber}'s recipe-tolerated loss (${normalLossAllowanceKobo} kobo from ` +
          `${order.recipeVersion.expectedYieldPercent ?? '0'}% expected yield) — already absorbed in WIP, not separately expensed.`,
      };
    }

    /*
     * An excess/abnormal claim moves real money out of WIP into an expense
     * nobody has approved yet — the register's own audit named this as the
     * one gap left in US-897-018 ("excess requires reason/evidence/approval").
     * So this does not post directly: it records the claim (journalEntryId
     * null — the same "visible but unposted until approved" convention
     * OperationsPostingService already uses) and submits it through the same
     * maker-checker engine every other posting-bearing document goes through.
     * `postApprovedAbnormalLoss()` below does the actual posting once
     * approved.
     */
    const lossEvent = await this.prisma.productionOrderLossEvent.create({
      data: {
        productionOrderId: order.id,
        quantity: new Prisma.Decimal(new Decimal(params.quantity).toFixed(6)),
        classification: 'ABNORMAL',
        costKobo: abnormalPortionKobo,
        reason:
          abnormalPortionKobo < params.costKobo
            ? `${params.reason} (${params.costKobo} kobo claimed; ${normalLossAllowanceKobo - previouslyAbnormal} kobo of it within recipe tolerance)`
            : params.reason,
        journalEntryId: null,
      },
    });

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }

    const result = await this.workflow.submit({
      companyId: order.companyId,
      transactionType: 'PRODUCTION_ORDER_ABNORMAL_LOSS',
      module: 'production',
      documentType: 'ProductionOrderLossEvent',
      documentId: lossEvent.id,
      documentReference: `${order.orderNumber}-LOSS`,
      amount: kobo(abnormalPortionKobo),
      currencyId: context.company.baseCurrencyId,
      branchId: order.branchId,
      farmId: order.farmId,
      costCentreId: context.costCentre.id,
      actor: params.actor,
    });

    return {
      posted: false,
      classification: 'ABNORMAL' as const,
      lossEventId: lossEvent.id,
      abnormalPortionKobo: abnormalPortionKobo.toString(),
      awaitingApproval: result.transactionId,
    };
  }

  /** Posts the journal for an approved abnormal-loss claim. */
  async postApprovedAbnormalLoss(params: {
    lossEventId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const lossEvent = await params.tx.productionOrderLossEvent.findUniqueOrThrow({
      where: { id: params.lossEventId },
      include: { productionOrder: { include: { sourceGroup: true, recipeVersion: true } } },
    });

    if (lossEvent.journalEntryId) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `This loss claim on ${lossEvent.productionOrder.orderNumber} is already posted.`,
        { productionOrderId: lossEvent.productionOrderId },
      );
    }

    const order = lossEvent.productionOrder;
    const rules = this.cycleRules(order.processingCycle);
    const context = await this.postingContext(order.companyId, new Date(), params.tx);
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }
    const dimensions = this.dimensions(order, context);
    const rule = await this.postingControl.resolve({ companyId: order.companyId, ruleId: rules.abnormalLossRuleId, on: new Date() });

    const result = await this.posting.post(
      {
        sourceModule: 'production',
        sourceDocumentType: 'ProductionOrder',
        sourceDocumentId: order.id,
        journalNumber: `${order.orderNumber}-LOSS-${order.abnormalLossCostKobo === 0n ? '1' : '2'}`,
        journalDate: new Date(),
        narration: `Abnormal processing loss on ${order.orderNumber}: ${lossEvent.reason}`,
        ...dimensions,
        idempotencyKey: `production-order-loss-event:${lossEvent.id}`,
        actor: params.actor,
        lines: [
          {
            glAccountId: this.requireSide(rule.debit, rules.abnormalLossRuleId, 'debit').glAccountId,
            description: `${rules.abnormalLossRuleId} — abnormal processing loss (${order.orderNumber})`,
            debit: kobo(lossEvent.costKobo),
            dimensions,
          },
          {
            glAccountId: this.requireSide(rule.credit, rules.abnormalLossRuleId, 'credit').glAccountId,
            description: `${rules.abnormalLossRuleId} — abnormal processing loss (${order.orderNumber})`,
            credit: kobo(lossEvent.costKobo),
            dimensions,
          },
        ],
      },
      params.tx,
    );

    await params.tx.productionOrderLossEvent.update({
      where: { id: lossEvent.id },
      data: { journalEntryId: result.journalEntryId },
    });

    await params.tx.productionOrder.update({
      where: { id: order.id },
      data: { abnormalLossCostKobo: order.abnormalLossCostKobo + lossEvent.costKobo },
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Joint-product completion
  // -------------------------------------------------------------------------

  /**
   * Receive the order's outputs into finished goods, cost split by
   * `CostAllocationService`.
   *
   * `totalToAllocate` is the RESIDUAL WIP after abnormal loss — WIP debits
   * minus what the abnormal-loss step already wrote off — never an
   * independently priced total. That is what makes Rule 7 hold by
   * construction: FG + by-product + abnormal loss can never fail to equal
   * WIP debits, because FG *is* whatever WIP debits minus the other two
   * leaves.
   */
  async recordOutputs(params: {
    productionOrderId: string;
    /** Optional: the company's released method is used; naming another is refused (handbook §62). */
    method?: CostAllocationMethod;
    outputs: AllocationOutput[];
    /**
     * Normal process loss, in the harvest's unit (kg): what the input lost on
     * the way to good output. With the outputs and any abnormal loss it must
     * add up to the harvest (handbook §62.5), so it is required for an order
     * from a harvest.
     */
    normalLossQuantity?: Decimal.Value;
    warehouseId: string;
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: params.productionOrderId },
      include: { sourceGroup: true },
    });

    if (order.status !== ProductionOrderStatus.IN_PRODUCTION) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; outputs can only be received once conversion is confirmed.`,
        { orderNumber: order.orderNumber },
      );
    }

    /*
     * An abnormal claim still awaiting approval has not moved anything out
     * of WIP yet (`order.abnormalLossCostKobo` only increments on posting,
     * see `postApprovedAbnormalLoss()`) — allocating outputs now would spread
     * that claim's cost across finished goods as if it had been approved,
     * silently pre-empting whatever a reviewer decides. Refuse until every
     * claim has a real journalEntryId, one way or the other.
     */
    const pendingLoss = await this.prisma.productionOrderLossEvent.findFirst({
      where: { productionOrderId: order.id, classification: 'ABNORMAL', journalEntryId: null },
    });
    if (pendingLoss) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Processing loss',
        `${order.orderNumber} has an abnormal-loss claim still awaiting approval — outputs cannot be received until it posts or is rejected.`,
        { orderNumber: order.orderNumber, lossEventId: pendingLoss.id },
      );
    }

    const rules = this.cycleRules(order.processingCycle);

    // --- PCR-034: a feed order's output is received at its released standard --
    const feedAtStandard = order.processingCycle === ProductionOrderCycle.FEED_MILL;
    const standardCosts = new StandardCostService(this.prisma, this.audit, this.recipes);

    // --- Handbook §62: one released method, approved prices, mass balance --
    const joint = new JointCostService(this.prisma, this.audit);
    const method = await joint.releasedMethod(order.companyId);
    if (!feedAtStandard && params.method && params.method !== method) {
      throw new AccountingRuleViolation(
        'JOINT_COST_ALLOCATION — one released method',
        `This company allocates joint cost by ${method} on every order; ${params.method} was asked for. The CFO changes the released method, not the order.`,
        { released: method, requested: params.method },
      );
    }
    let outputs = params.outputs;
    if (method === 'NRV' && !feedAtStandard) {
      const prices = await joint.pricesOn(order.companyId, [...new Set(outputs.map((o) => o.itemId))], new Date());
      outputs = outputs.map((o) => ({
        ...o,
        salePricePerUnitKobo: prices.get(o.itemId)!.sellingPricePerUnitKobo,
        costsToSellPerUnitKobo: prices.get(o.itemId)!.furtherCostPerUnitKobo,
      }));
    }
    if (order.harvestRecordId) {
      const harvest = await this.prisma.harvestRecord.findUniqueOrThrow({ where: { id: order.harvestRecordId }, select: { weightKg: true } });
      const input = new Decimal(harvest.weightKg.toString());
      const good = outputs.reduce((sum, o) => sum.plus(new Decimal(o.weight ?? o.quantity)), new Decimal(0));
      const abnormal = (
        await this.prisma.productionOrderLossEvent.findMany({ where: { productionOrderId: order.id, classification: 'ABNORMAL' }, select: { quantity: true } })
      ).reduce((sum, l) => sum.plus(new Decimal(l.quantity.toString())), new Decimal(0));
      const implied = input.minus(good).minus(abnormal);
      if (params.normalLossQuantity === undefined || params.normalLossQuantity === null || params.normalLossQuantity === '') {
        throw new AccountingRuleViolation(
          'Handbook §62.5 — Mass balance',
          `State the normal process loss. ${input.toFixed(3)} kg went in; outputs are ${good.toFixed(3)} kg${abnormal.gt(0) ? ` and abnormal loss ${abnormal.toFixed(3)} kg` : ''}, so normal loss would be ${implied.toFixed(3)} kg.`,
          { inputKg: input.toFixed(3), outputKg: good.toFixed(3), abnormalKg: abnormal.toFixed(3) },
        );
      }
      const normal = new Decimal(params.normalLossQuantity);
      if (normal.lt(0) || good.plus(normal).plus(abnormal).minus(input).abs().gt('0.001')) {
        throw new AccountingRuleViolation(
          'Handbook §62.5 — Mass balance',
          `Outputs ${good.toFixed(3)} kg + normal loss ${normal.toFixed(3)} kg + abnormal loss ${abnormal.toFixed(3)} kg is ${good.plus(normal).plus(abnormal).toFixed(3)} kg, but ${input.toFixed(3)} kg went in. Correct the quantities before the order completes.`,
          { inputKg: input.toFixed(3) },
        );
      }
    }

    const wipDebits =
      order.biologicalInputValueKobo +
      order.rearingCostKobo +
      order.packagingCostKobo +
      order.standardConversionCostKobo;
    const totalToAllocate = wipDebits - order.abnormalLossCostKobo;
    if (totalToAllocate <= 0n) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Joint-cost allocation',
        `${order.orderNumber} has nothing left to allocate to outputs — abnormal loss already ` +
          `wrote off the whole WIP balance.`,
        { orderNumber: order.orderNumber },
      );
    }

    /*
     * Feed mill: each output at good quantity × its released standard cost a
     * unit; whatever WIP holds beyond that is the yield variance, cleared to
     * the order's variance account in the same journal so WIP ends at zero.
     * Processing: the whole WIP is shared by the released joint-cost method.
     */
    let allocated: AllocatedOutput[];
    let standardVersionId: string | null = null;
    if (feedAtStandard) {
      allocated = [];
      for (const output of outputs) {
        const version = await standardCosts.releasedFor(this.prisma, order.companyId, output.itemId, new Date());
        if (output.outputType === 'MAIN' || !standardVersionId) standardVersionId = version.id;
        const value = BigInt(new Decimal(output.quantity).mul(version.unitCostKobo.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
        allocated.push({
          itemId: output.itemId,
          outputType: output.outputType,
          quantity: new Decimal(output.quantity).toFixed(6),
          allocationWeightKobo: version.unitCostKobo.toString(),
          allocatedCostKobo: value.toString(),
        });
      }
    } else {
      allocated = this.costAllocation.allocate({
        method,
        totalKobo: kobo(totalToAllocate),
        outputs,
      });
    }
    const finishedGoods = allocated.reduce((sum, o) => sum + BigInt(o.allocatedCostKobo), 0n);
    const yieldVariance = totalToAllocate - finishedGoods;
    const varianceAccount = yieldVariance !== 0n ? await this.resolvePostingKeyAccount(order.companyId, rules.settleDebitKey) : null;

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }
    const dimensions = this.dimensions(order, context);
    const rule = await this.postingControl.resolve({ companyId: order.companyId, ruleId: rules.completionRuleId, on: new Date() });
    const fgAccount = this.requireSide(rule.debit, rules.completionRuleId, 'debit').glAccountId;
    const wipAccount = this.requireSide(rule.credit, rules.completionRuleId, 'credit').glAccountId;

    return this.prisma.$transaction(async (tx) => {
      await standardCosts.requirePolicy(tx, order.companyId, new Date());
      for (const output of allocated) {
        const stockMovement = await this.stockMovements.receiveIn({
          tx,
          companyId: order.companyId,
          branchId: order.branchId,
          itemId: output.itemId,
          warehouseId: params.warehouseId,
          quantity: new Decimal(output.quantity),
          valueKobo: BigInt(output.allocatedCostKobo),
          sourceModule: 'production',
          sourceDocumentType: 'ProductionOrder',
          sourceDocumentId: order.id,
          documentReference: order.orderNumber,
          movementDate: new Date(),
        });

        await tx.productionOrderOutput.create({
          data: {
            productionOrderId: order.id,
            itemId: output.itemId,
            outputType: output.outputType,
            quantity: new Prisma.Decimal(output.quantity),
            allocationWeightKobo: BigInt(output.allocationWeightKobo),
            allocatedCostKobo: BigInt(output.allocatedCostKobo),
            stockMovementId: stockMovement.stockMovementId,
          },
        });
      }

      const result = await this.posting.post(
        {
          sourceModule: 'production',
          sourceDocumentType: 'ProductionOrder',
          sourceDocumentId: order.id,
          journalNumber: `${order.orderNumber}-COMPLETE`,
          journalDate: new Date(),
          narration: `Receive finished goods from processing order ${order.orderNumber}`,
          ...dimensions,
          idempotencyKey: `production-order:${order.id}:complete`,
          actor: params.actor,
          lines: [
            {
              glAccountId: fgAccount,
              description: feedAtStandard
                ? `${rules.completionRuleId} — good output at standard (${order.orderNumber})`
                : `${rules.completionRuleId} — joint outputs received (${order.orderNumber})`,
              debit: kobo(finishedGoods),
              dimensions,
            },
            ...(yieldVariance !== 0n && varianceAccount
              ? [
                  {
                    glAccountId: varianceAccount,
                    description: `Yield variance, ${yieldVariance > 0n ? 'adverse' : 'favourable'} (${order.orderNumber})`,
                    ...(yieldVariance > 0n ? { debit: kobo(yieldVariance) } : { credit: kobo(-yieldVariance) }),
                    dimensions,
                  },
                ]
              : []),
            {
              glAccountId: wipAccount,
              description: `${rules.completionRuleId} — WIP cleared on completion (${order.orderNumber})`,
              credit: kobo(totalToAllocate),
              dimensions,
            },
          ],
        },
        tx,
      );

      await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: ProductionOrderStatus.COMPLETED,
          finishedGoodsCostKobo: finishedGoods,
          yieldVarianceKobo: yieldVariance,
          standardCostVersionId: standardVersionId,
          completionJournalEntryId: result.journalEntryId,
          completedAt: new Date(),
        },
      });

      await this.audit.write(
        {
          transactionId: order.id,
          module: 'production',
          entityType: 'ProductionOrder',
          entityId: order.id,
          status: ProductionOrderStatus.COMPLETED,
          action: AuditAction.POST,
          userId: params.actor.userId,
          comments: feedAtStandard
            ? `Completed ${order.orderNumber}: ${allocated.length} outputs, ${finishedGoods} kobo at standard, yield variance ${yieldVariance}.`
            : `Completed ${order.orderNumber}: ${allocated.length} outputs, ${totalToAllocate} kobo allocated by ${method}.`,
        },
        tx,
      );

      return { ...result, allocated };
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Settle
  // -------------------------------------------------------------------------

  /**
   * Close the recovery/actual-pool accounts for this order into the
   * variance line. Rule 7 (WIP identity) is asserted here as a hard check,
   * not a hope — `recordOutputs()`'s residual-plug computation should
   * already guarantee it, and this refuses to post if it somehow does not.
   */
  /**
   * The order's total variance against its standard good output, and whether
   * it is beyond the year's tolerance (FeedMill_Cost_Model: "Variance ÷
   * standard good output … WITHIN 20%"). Material usage and price, yield, and
   * conversion (actual less absorbed) together; a large favourable variance
   * counts as much as an adverse one, since either says the standard is wrong.
   */
  async varianceCheck(productionOrderId: string) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({ where: { id: productionOrderId } });
    const policy = await new StandardCostService(this.prisma, this.audit, this.recipes).policyOn(this.prisma, order.companyId, new Date());
    const conversion = order.actualLabourCostKobo + order.actualOverheadCostKobo - order.standardConversionCostKobo;
    const total = order.materialUsageVarianceKobo + order.materialPriceVarianceKobo + order.yieldVarianceKobo + conversion;
    const basis = order.finishedGoodsCostKobo;
    const magnitude = total < 0n ? -total : total;
    const percent = basis > 0n ? new Decimal(magnitude.toString()).div(basis.toString()).mul(100) : null;
    const tolerance = policy ? new Decimal(policy.varianceTolerancePercent.toString()) : null;
    const overTolerance =
      tolerance === null ? false : percent === null ? total !== 0n : percent.gt(tolerance);
    return {
      orderNumber: order.orderNumber,
      materialUsageKobo: order.materialUsageVarianceKobo.toString(),
      materialPriceKobo: order.materialPriceVarianceKobo.toString(),
      yieldKobo: order.yieldVarianceKobo.toString(),
      conversionKobo: conversion.toString(),
      totalKobo: total.toString(),
      standardGoodOutputKobo: basis.toString(),
      percent: percent?.toFixed(2) ?? null,
      tolerancePercent: tolerance?.toString() ?? null,
      overTolerance,
      reason: order.varianceReason,
    };
  }

  async settle(params: { productionOrderId: string; varianceReason?: string; actor: WorkflowActor }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: params.productionOrderId },
      include: { sourceGroup: true },
    });

    if (order.status !== ProductionOrderStatus.COMPLETED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; only a completed order can settle.`,
        { orderNumber: order.orderNumber },
      );
    }
    const rules = this.cycleRules(order.processingCycle);

    const wipDebits =
      order.biologicalInputValueKobo +
      order.rearingCostKobo +
      order.packagingCostKobo +
      order.standardConversionCostKobo;
    if (wipDebits !== order.finishedGoodsCostKobo + order.abnormalLossCostKobo + order.yieldVarianceKobo) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9/Rule 7 — WIP identity',
        `${order.orderNumber} does not clear: WIP debits ${wipDebits} kobo, but finished goods ` +
          `(${order.finishedGoodsCostKobo}) plus abnormal loss (${order.abnormalLossCostKobo}) plus yield variance (${order.yieldVarianceKobo}) is ` +
          `${order.finishedGoodsCostKobo + order.abnormalLossCostKobo + order.yieldVarianceKobo} kobo. Refusing to post a wrong figure.`,
        { orderNumber: order.orderNumber },
      );
    }

    // Variance: what was actually incurred for conversion vs. what standard
    // absorption recovered into WIP against the recovery clearing account.
    // A positive figure means the order cost more than standard and the
    // recovery account needs a further debit from the variance line to bring
    // it to zero for this order; negative means the reverse.
    const actualIncurred = order.actualLabourCostKobo + order.actualOverheadCostKobo;
    const variance = actualIncurred - order.standardConversionCostKobo;
    /*
     * PCR-058 / PCR-080: settlement clears the recovery account AND the
     * actual expense pools the order charged (621100/621200, 622100) —
     * "actual-standard variance and recovery clear". Dr recovery with the
     * standard absorbed, Cr each pool with what it was charged, and the
     * variance takes the difference. Until 2026-09-25 only the variance was
     * posted, so the recovery kept the standard as a credit and the pools kept
     * the actual as expense: conversion cost counted twice, once in expense
     * and once in the finished goods. Feed-mill orders post no actual pools
     * of their own (their resource costs arrive through PCR-031 and payroll),
     * so they settle the variance against recovery as before.
     */
    /*
     * A feed order's actual labour, power and depreciation are posted at
     * source to the feed-mill cost pool (623100 — payroll, PCR-031), not by
     * the order. Settlement clears the order's share of that pool against the
     * recovery the standard absorbed, so recovery ends at zero
     * (FeedMill_Accounting: "WIP=0; recovery=0"). Until 2026-09-26 only the
     * variance was posted, which left recovery holding the actual cost.
     */
    const feedPool = order.processingCycle === ProductionOrderCycle.FEED_MILL;
    const clearsPools = rules.actualLabourRuleId !== null || rules.actualConversionRuleId !== null || feedPool;

    /*
     * The year's tolerance (Costing_Policy_v2, FeedMill_Cost_Model): a total
     * variance beyond it settles only with a reason, recorded on the order
     * and in the audit trail (PCR-036 "variance type; reason").
     */
    const check = await this.varianceCheck(order.id);
    const reason = params.varianceReason?.trim() || null;
    if (check.overTolerance && !reason) {
      throw new AccountingRuleViolation(
        'Costing_Policy_v2 — Variance tolerance',
        `${order.orderNumber}'s total variance is ${check.totalKobo} kobo${check.percent !== null ? `, ${check.percent}% of its standard good output` : ''} — beyond the ${check.tolerancePercent}% tolerance. Say why before it settles.`,
        { ...check },
      );
    }
    const reasonData = reason ? { varianceReason: reason, varianceReasonById: params.actor.userId } : {};

    if (clearsPools ? order.standardConversionCostKobo === 0n && actualIncurred === 0n : variance === 0n) {
      await this.prisma.productionOrder.update({ where: { id: order.id }, data: { settledAt: new Date(), ...reasonData } });
      return { journalEntryId: null, variance: '0' };
    }

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }
    const dimensions = this.dimensions(order, context);
    // The settlement rule as a whole is NOT resolved through
    // PostingControlService, same reason as the actual-conversion rule: its
    // credit key ("recovery/actual pool") is non-atomic, and resolve()
    // validates both sides eagerly. The debit is looked up directly; the
    // credit is the recovery account the standard-absorption step already
    // credited for this order.
    const [varianceAccount, recoveryAccount] = await Promise.all([
      this.resolvePostingKeyAccount(order.companyId, rules.settleDebitKey),
      this.recoveryAccount(order.companyId, rules.recoveryAccountNumber),
    ]);
    // The pools the order's own conversion step charged, and how much to each.
    const pools: Array<{ account: string; amount: bigint }> = !clearsPools
      ? []
      : feedPool
        ? [{ account: await this.recoveryAccount(order.companyId, '623100'), amount: actualIncurred }]
        : rules.actualConversionRuleId
        ? [{ account: await this.resolvePostingKeyAccount(order.companyId, `${rules.actualConversionRuleId}-DR`), amount: actualIncurred }]
        : [
            { account: await this.resolvePostingKeyAccount(order.companyId, `${rules.actualLabourRuleId}-DR`), amount: order.actualLabourCostKobo },
            { account: await this.resolvePostingKeyAccount(order.companyId, `${rules.actualOverheadRuleId}-DR`), amount: order.actualOverheadCostKobo },
          ];

    const rule = rules.settleDebitKey.replace('-DR', '');
    return this.prisma.$transaction(async (tx) => {
      const favourable = variance < 0n;
      const magnitude = favourable ? -variance : variance;

      const result = await this.posting.post(
        {
          sourceModule: 'production',
          sourceDocumentType: 'ProductionOrder',
          sourceDocumentId: order.id,
          journalNumber: `${order.orderNumber}-SETTLE`,
          journalDate: new Date(),
          narration: `Settle processing order ${order.orderNumber}: recovery and actual pools cleared, variance ${variance} kobo`,
          ...dimensions,
          idempotencyKey: `production-order:${order.id}:settle`,
          actor: params.actor,
          lines: clearsPools
            ? [
                ...(order.standardConversionCostKobo > 0n
                  ? [{
                      glAccountId: recoveryAccount,
                      description: `${rule} — recovery cleared (${order.orderNumber})`,
                      debit: kobo(order.standardConversionCostKobo),
                      dimensions,
                    }]
                  : []),
                ...(magnitude > 0n
                  ? [{
                      glAccountId: varianceAccount,
                      description: `${rule} — conversion variance (${order.orderNumber})`,
                      ...(favourable ? { credit: kobo(magnitude) } : { debit: kobo(magnitude) }),
                      dimensions,
                    }]
                  : []),
                ...pools
                  .filter((pool) => pool.amount > 0n)
                  .map((pool) => ({
                    glAccountId: pool.account,
                    description: `${rule} — actual pool cleared (${order.orderNumber})`,
                    credit: kobo(pool.amount),
                    dimensions,
                  })),
              ]
            : [
                {
                  glAccountId: favourable ? recoveryAccount : varianceAccount,
                  description: `${rule} — conversion variance settled (${order.orderNumber})`,
                  debit: kobo(magnitude),
                  dimensions,
                },
                {
                  glAccountId: favourable ? varianceAccount : recoveryAccount,
                  description: `${rule} — conversion variance settled (${order.orderNumber})`,
                  credit: kobo(magnitude),
                  dimensions,
                },
              ],
        },
        tx,
      );

      await tx.productionOrder.update({
        where: { id: order.id },
        data: { settlementJournalEntryId: result.journalEntryId, settledAt: new Date(), ...reasonData },
      });

      await this.audit.write(
        {
          transactionId: order.id,
          module: 'production',
          entityType: 'ProductionOrder',
          entityId: order.id,
          status: order.status,
          action: AuditAction.POST,
          userId: params.actor.userId,
          comments: `Settled ${order.orderNumber}: ${favourable ? 'favourable' : 'unfavourable'} variance of ${magnitude} kobo.`,
        },
        tx,
      );

      return { ...result, variance: variance.toString() };
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Which PCR rule ids this order's processing cycle uses at each step. */
  private cycleRules(cycle: ProductionOrderCycle): ProcessingCycleRules {
    const rules = PROCESSING_CYCLE_RULES[cycle];
    if (!rules) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `No processing posting rules are defined for cycle "${cycle}".`,
        { cycle },
      );
    }
    return rules;
  }

  /** SnailPro/PoultryPro orders derive their cycle from the source population's species. */
  private cycleForSpecies(speciesKey: string): ProductionOrderCycle {
    if (speciesKey === 'poultry') return ProductionOrderCycle.POULTRYPRO;
    if (speciesKey === 'snail') return ProductionOrderCycle.SNAILPRO;
    throw new AccountingRuleViolation(
      'Consolidated Reference §9 — Production order',
      `No processing cycle is defined for species "${speciesKey}" — only snail and poultry processing are built.`,
      { speciesKey },
    );
  }

  /**
   * One posting key's account, directly — for the rule steps that have one
   * non-atomic side and one atomic side (the actual-conversion rule, the
   * settlement rule), so calling `PostingControlService.resolve()` for the
   * rule as a whole would throw before the atomic side could ever be read.
   */
  private async resolvePostingKeyAccount(companyId: string, key: string): Promise<string> {
    const row = await this.prisma.postingKey.findUnique({
      where: { companyId_key: { companyId, key } },
      include: { glAccount: true },
    });
    if (!row?.glAccount?.active) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting key',
        `Posting key ${key} does not resolve to an active account.`,
        { key },
      );
    }
    return row.glAccount.id;
  }

  private requireSide(side: ResolvedRule['debit'], ruleId: string, name: string) {
    if (!side) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting rule',
        `${ruleId}'s ${name} side posts nothing, which processing cannot use.`,
        { ruleId },
      );
    }
    return side;
  }

  private dimensions(
    order: { companyId: string; branchId: string; farmId: string },
    context: { period: { id: string; financialYearId: string }; costCentre: { id: string }; company: { baseCurrencyId: string } },
  ) {
    return {
      companyId: order.companyId,
      branchId: order.branchId,
      financialYearId: context.period.financialYearId,
      financialPeriodId: context.period.id,
      currencyId: context.company.baseCurrencyId,
      exchangeRate: '1',
      costCentreId: context.costCentre.id,
      farmId: order.farmId,
    };
  }

  /**
   * `client` defaults to the plain PrismaService — pass a transaction's own
   * `tx` when this is called from inside a workflow-approval handler, so the
   * read is part of the same transaction as the posting it feeds, not a
   * separate one racing alongside it.
   */
  private async postingContext(
    companyId: string,
    on: Date,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const [period, costCentre, company] = await Promise.all([
      client.financialPeriod.findFirst({
        where: { financialYear: { companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' },
        select: { id: true, financialYearId: true },
      }),
      client.costCentre.findFirst({
        where: { companyId, active: true },
        orderBy: { code: 'asc' },
        select: { id: true },
      }),
      client.company.findUniqueOrThrow({ where: { id: companyId } }),
    ]);
    if (!period || !costCentre) return null;
    return { period, costCentre, company };
  }

  private async baseCurrencyId(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return company.baseCurrencyId;
  }

  private async defaultWarehouse(client: PrismaService | Prisma.TransactionClient, companyId: string): Promise<string> {
    const warehouse = await client.warehouse.findFirstOrThrow({ where: { companyId, active: true }, orderBy: { code: 'asc' } });
    return warehouse.id;
  }

  private async tradePayablesAccount(companyId: string): Promise<string> {
    const account = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber: '210100', active: true },
    });
    if (!account) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting chart',
        'No active Trade Payables account (210100) exists for actual conversion cost to credit.',
        {},
      );
    }
    return account.id;
  }

  private async recoveryAccount(companyId: string, accountNumber: string): Promise<string> {
    const account = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber, active: true },
    });
    if (!account) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting chart',
        `No active recovery clearing account (${accountNumber}) exists to settle variance against.`,
        {},
      );
    }
    return account.id;
  }
}
