import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, Prisma, ProductionOrderStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { RecipeService } from '../masters/recipe.service';
import { BiologicalAssetService } from '../biological-assets/biological-asset.service';
import { PostingControlService, ResolvedRule } from '../posting-control/posting-control.service';
import { StockMovementService } from '../inventory/stock-movement.service';
import { CostAllocationService, AllocationOutput, CostAllocationMethod } from './cost-allocation.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo, Kobo } from '../common/money';

/**
 * SnailPro processing (PCR-051–058): market snails harvested, issued to
 * processing, labour/overhead confirmed, joint outputs (meat/slime/shell)
 * received into finished goods, order settles at exactly zero WIP.
 *
 * The input to an order is NOT a recipe component. "Market snails" are a
 * biological asset (`LivestockGroup`), not an `Item` — PCR-051 posts
 * Dr WIP / Cr the population's own stage account, valued at its IAS 41
 * carrying value, the same way every other biological-asset transfer in this
 * codebase already posts. `recipeVersionId` governs the PACKAGING components
 * only. See the schema's file-level comment for the full rationale.
 */
@Injectable()
export class ProductionOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly recipes: RecipeService,
    private readonly biologicalAssets: BiologicalAssetService,
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
    orderNumber: string;
    plannedOutputQuantity: Decimal.Value;
    actor: WorkflowActor;
  }): Promise<{ id: string }> {
    const harvest = await this.prisma.harvestRecord.findUniqueOrThrow({
      where: { id: params.harvestRecordId },
      include: { group: true, productionOrder: true },
    });

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
        `${harvest.group.code} has never been valued, so the market snails this harvest took ` +
          `have no carrying value to move into WIP. Post a valuation first.`,
        { groupId: harvest.groupId },
      );
    }

    const marketSnailValueKobo = BigInt(harvest.count) * harvest.group.currentFvlctsPerUnitKobo;

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
          orderNumber: params.orderNumber,
          recipeVersionId: params.recipeVersionId,
          sourceGroupId: harvest.groupId,
          harvestRecordId: harvest.id,
          plannedOutputQuantity: new Prisma.Decimal(new Decimal(params.plannedOutputQuantity).toFixed(6)),
          marketSnailValueKobo,
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

      return { id: order.id };
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
      amount: kobo(order.marketSnailValueKobo + plannedPackagingKobo),
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
  // Issue — PCR-051 (market snails) + PCR-052 (packaging)
  // -------------------------------------------------------------------------

  async issueMaterials(params: { productionOrderId: string; actor: WorkflowActor }) {
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
    if (!order.sourceGroup) {
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
     */
    const [wipAccount, marketSnailsRule, packagingRule, componentItems] = await Promise.all([
      this.biologicalAssets.stageAccount({
        companyId: order.companyId,
        speciesKey: order.sourceGroup!.speciesKey,
        stage: 'Market-ready',
      }),
      this.postingControl.resolve({ companyId: order.companyId, ruleId: 'PCR-051', on: new Date() }),
      this.postingControl.resolve({ companyId: order.companyId, ruleId: 'PCR-052', on: new Date() }),
      this.prisma.item.findMany({ where: { id: { in: order.components.map((c) => c.componentItemId) } } }),
    ]);
    const fallbackWarehouseId = componentItems.some((i) => !i.defaultWarehouseId)
      ? await this.defaultWarehouse(this.prisma, order.companyId)
      : null;
    const warehouseByItem = new Map(componentItems.map((i) => [i.id, i.defaultWarehouseId ?? fallbackWarehouseId!]));

    const lines = [
      {
        glAccountId: this.requireSide(marketSnailsRule.debit, 'PCR-051', 'debit').glAccountId,
        description: `PCR-051 — market snails issued to processing (${order.orderNumber})`,
        debit: kobo(order.marketSnailValueKobo),
        dimensions,
      },
      {
        glAccountId: wipAccount.glAccountId,
        description: `PCR-051 — market snails issued to processing (${order.orderNumber})`,
        credit: kobo(order.marketSnailValueKobo),
        dimensions,
      },
    ];

    return this.prisma.$transaction(async (tx) => {
      let packagingTotal = 0n;
      const packagingLines: typeof lines = [];
      for (const component of order.components) {
        if (component.plannedQuantity.lessThanOrEqualTo(0)) continue;
        const issued = await this.stockMovements.issueOut({
          tx,
          companyId: order.companyId,
          branchId: order.branchId,
          itemId: component.componentItemId,
          warehouseId: warehouseByItem.get(component.componentItemId)!,
          quantity: new Decimal(component.plannedQuantity.toString()),
          sourceModule: 'production',
          sourceDocumentType: 'ProductionOrder',
          sourceDocumentId: order.id,
          documentReference: order.orderNumber,
          movementDate: new Date(),
        });
        await tx.productionOrderComponent.update({
          where: { id: component.id },
          data: {
            issuedQuantity: component.plannedQuantity,
            issuedCostKobo: issued.valueKobo,
            stockMovementId: issued.stockMovementId,
          },
        });
        packagingTotal += issued.valueKobo;
      }

      if (packagingTotal > 0n) {
        packagingLines.push(
          {
            glAccountId: this.requireSide(packagingRule.debit, 'PCR-052', 'debit').glAccountId,
            description: `PCR-052 — packaging issued to processing (${order.orderNumber})`,
            debit: kobo(packagingTotal),
            dimensions,
          },
          {
            glAccountId: this.requireSide(packagingRule.credit, 'PCR-052', 'credit').glAccountId,
            description: `PCR-052 — packaging issued to processing (${order.orderNumber})`,
            credit: kobo(packagingTotal),
            dimensions,
          },
        );
      }

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
          lines: [...lines, ...packagingLines],
        },
        tx,
      );

      await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: ProductionOrderStatus.RELEASED,
          packagingCostKobo: packagingTotal,
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
          comments: `Issued ${order.orderNumber}: market snails ${order.marketSnailValueKobo} kobo, packaging ${packagingTotal} kobo.`,
        },
        tx,
      );

      return result;
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Confirm labour/overhead — PCR-053 (standard) + PCR-054/055 (actual)
  // -------------------------------------------------------------------------

  async confirmConversion(params: {
    productionOrderId: string;
    standardConversionCostKobo: bigint;
    actualLabourCostKobo: bigint;
    actualOverheadCostKobo: bigint;
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: params.productionOrderId },
    });

    if (order.status !== ProductionOrderStatus.RELEASED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; materials must be issued before conversion is confirmed.`,
        { orderNumber: order.orderNumber },
      );
    }

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }
    const dimensions = this.dimensions(order, context);

    const on = new Date();
    // PCR-055 as a whole is NOT resolved through PostingControlService: its
    // credit key ("AP/Accrual/Accumulated Depreciation") is non-atomic, and
    // resolve() validates both sides eagerly, so calling it at all would
    // throw before the (perfectly atomic) debit side could ever be used.
    // The debit is looked up directly; the credit is the same disclosed
    // Trade-Payables policy FixedAssetService already uses for its own
    // dual-account key.
    const [standardRule, labourRule, overheadDebitAccountId, payablesAccount] = await Promise.all([
      this.postingControl.resolve({ companyId: order.companyId, ruleId: 'PCR-053', on }),
      this.postingControl.resolve({ companyId: order.companyId, ruleId: 'PCR-054', on }),
      this.resolvePostingKeyAccount(order.companyId, 'PCR-055-DR'),
      this.tradePayablesAccount(order.companyId),
    ]);

    return this.prisma.$transaction(async (tx) => {
      const postLines = [
        {
          glAccountId: this.requireSide(standardRule.debit, 'PCR-053', 'debit').glAccountId,
          description: `PCR-053 — standard conversion absorbed (${order.orderNumber})`,
          debit: kobo(params.standardConversionCostKobo),
          dimensions,
        },
        {
          glAccountId: this.requireSide(standardRule.credit, 'PCR-053', 'credit').glAccountId,
          description: `PCR-053 — standard conversion absorbed (${order.orderNumber})`,
          credit: kobo(params.standardConversionCostKobo),
          dimensions,
        },
        {
          glAccountId: this.requireSide(labourRule.debit, 'PCR-054', 'debit').glAccountId,
          description: `PCR-054 — actual processing labour (${order.orderNumber})`,
          debit: kobo(params.actualLabourCostKobo),
          dimensions,
        },
        {
          glAccountId: this.requireSide(labourRule.credit, 'PCR-054', 'credit').glAccountId,
          description: `PCR-054 — actual processing labour (${order.orderNumber})`,
          credit: kobo(params.actualLabourCostKobo),
          dimensions,
        },
        {
          glAccountId: overheadDebitAccountId,
          description: `PCR-055 — actual processing overhead (${order.orderNumber})`,
          debit: kobo(params.actualOverheadCostKobo),
          dimensions,
        },
        {
          glAccountId: payablesAccount,
          description: `PCR-055 — actual processing overhead (${order.orderNumber})`,
          credit: kobo(params.actualOverheadCostKobo),
          dimensions,
        },
      ].filter((line) => (line.debit ?? line.credit ?? 0n) > 0n);

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
          standardConversionCostKobo: params.standardConversionCostKobo,
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
          comments: `Confirmed conversion for ${order.orderNumber}: standard ${params.standardConversionCostKobo}, actual labour ${params.actualLabourCostKobo}, actual overhead ${params.actualOverheadCostKobo}.`,
        },
        tx,
      );

      return result;
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Abnormal loss — PCR-056
  // -------------------------------------------------------------------------

  async recordAbnormalLoss(params: {
    productionOrderId: string;
    quantity: Decimal.Value;
    costKobo: bigint;
    reason: string;
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({ where: { id: params.productionOrderId } });

    if (order.status !== ProductionOrderStatus.IN_PRODUCTION) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; loss can only be recorded once conversion is confirmed and before outputs are received.`,
        { orderNumber: order.orderNumber },
      );
    }

    const wipDebits = order.marketSnailValueKobo + order.packagingCostKobo + order.standardConversionCostKobo;
    if (order.abnormalLossCostKobo + params.costKobo > wipDebits) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Processing loss',
        `${order.orderNumber}'s abnormal loss would exceed the WIP it was raised against — ` +
          `${wipDebits} kobo debited, ${order.abnormalLossCostKobo + params.costKobo} kobo of loss claimed.`,
        { orderNumber: order.orderNumber },
      );
    }

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }
    const dimensions = this.dimensions(order, context);
    const rule = await this.postingControl.resolve({ companyId: order.companyId, ruleId: 'PCR-056', on: new Date() });

    return this.prisma.$transaction(async (tx) => {
      const result = await this.posting.post(
        {
          sourceModule: 'production',
          sourceDocumentType: 'ProductionOrder',
          sourceDocumentId: order.id,
          journalNumber: `${order.orderNumber}-LOSS-${order.abnormalLossCostKobo === 0n ? '1' : '2'}`,
          journalDate: new Date(),
          narration: `Abnormal processing loss on ${order.orderNumber}: ${params.reason}`,
          ...dimensions,
          idempotencyKey: `production-order:${order.id}:loss:${params.quantity}`,
          actor: params.actor,
          lines: [
            {
              glAccountId: this.requireSide(rule.debit, 'PCR-056', 'debit').glAccountId,
              description: `PCR-056 — abnormal processing loss (${order.orderNumber})`,
              debit: kobo(params.costKobo),
              dimensions,
            },
            {
              glAccountId: this.requireSide(rule.credit, 'PCR-056', 'credit').glAccountId,
              description: `PCR-056 — abnormal processing loss (${order.orderNumber})`,
              credit: kobo(params.costKobo),
              dimensions,
            },
          ],
        },
        tx,
      );

      await tx.productionOrderLossEvent.create({
        data: {
          productionOrderId: order.id,
          quantity: new Prisma.Decimal(new Decimal(params.quantity).toFixed(6)),
          classification: 'ABNORMAL',
          costKobo: params.costKobo,
          reason: params.reason,
          journalEntryId: result.journalEntryId,
        },
      });

      await tx.productionOrder.update({
        where: { id: order.id },
        data: { abnormalLossCostKobo: order.abnormalLossCostKobo + params.costKobo },
      });

      return result;
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Joint-product completion — PCR-057
  // -------------------------------------------------------------------------

  /**
   * Receive the order's outputs into finished goods, cost split by
   * `CostAllocationService`.
   *
   * `totalToAllocate` is the RESIDUAL WIP after abnormal loss — WIP debits
   * minus what PCR-056 already wrote off — never an independently priced
   * total. That is what makes Rule 7 hold by construction: FG + by-product +
   * abnormal loss can never fail to equal WIP debits, because FG *is*
   * whatever WIP debits minus the other two leaves.
   */
  async recordOutputs(params: {
    productionOrderId: string;
    method: CostAllocationMethod;
    outputs: AllocationOutput[];
    warehouseId: string;
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({ where: { id: params.productionOrderId } });

    if (order.status !== ProductionOrderStatus.IN_PRODUCTION) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; outputs can only be received once conversion is confirmed.`,
        { orderNumber: order.orderNumber },
      );
    }

    const wipDebits = order.marketSnailValueKobo + order.packagingCostKobo + order.standardConversionCostKobo;
    const totalToAllocate = wipDebits - order.abnormalLossCostKobo;
    if (totalToAllocate <= 0n) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Joint-cost allocation',
        `${order.orderNumber} has nothing left to allocate to outputs — abnormal loss already ` +
          `wrote off the whole WIP balance.`,
        { orderNumber: order.orderNumber },
      );
    }

    const allocated = this.costAllocation.allocate({
      method: params.method,
      totalKobo: kobo(totalToAllocate),
      outputs: params.outputs,
    });

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }
    const dimensions = this.dimensions(order, context);
    const rule = await this.postingControl.resolve({ companyId: order.companyId, ruleId: 'PCR-057', on: new Date() });
    const fgAccount = this.requireSide(rule.debit, 'PCR-057', 'debit').glAccountId;
    const wipAccount = this.requireSide(rule.credit, 'PCR-057', 'credit').glAccountId;

    return this.prisma.$transaction(async (tx) => {
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
              description: `PCR-057 — joint outputs received (${order.orderNumber})`,
              debit: kobo(totalToAllocate),
              dimensions,
            },
            {
              glAccountId: wipAccount,
              description: `PCR-057 — joint outputs received (${order.orderNumber})`,
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
          finishedGoodsCostKobo: totalToAllocate,
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
          comments: `Completed ${order.orderNumber}: ${allocated.length} outputs, ${totalToAllocate} kobo allocated by ${params.method}.`,
        },
        tx,
      );

      return { ...result, allocated };
    }, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // Settle — PCR-058
  // -------------------------------------------------------------------------

  /**
   * Close the recovery/actual-pool accounts for this order into the
   * variance line. Rule 7 (WIP identity) is asserted here as a hard check,
   * not a hope — `recordOutputs()`'s residual-plug computation should
   * already guarantee it, and this refuses to post if it somehow does not.
   */
  async settle(params: { productionOrderId: string; actor: WorkflowActor }) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({ where: { id: params.productionOrderId } });

    if (order.status !== ProductionOrderStatus.COMPLETED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Production order',
        `${order.orderNumber} is ${order.status}; only a completed order can settle.`,
        { orderNumber: order.orderNumber },
      );
    }

    const wipDebits = order.marketSnailValueKobo + order.packagingCostKobo + order.standardConversionCostKobo;
    if (wipDebits !== order.finishedGoodsCostKobo + order.abnormalLossCostKobo) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9/Rule 7 — WIP identity',
        `${order.orderNumber} does not clear: WIP debits ${wipDebits} kobo, but finished goods ` +
          `(${order.finishedGoodsCostKobo}) plus abnormal loss (${order.abnormalLossCostKobo}) is ` +
          `${order.finishedGoodsCostKobo + order.abnormalLossCostKobo} kobo. Refusing to post a wrong figure.`,
        { orderNumber: order.orderNumber },
      );
    }

    // Variance: what was actually incurred for conversion vs. what standard
    // absorption recovered into WIP against 219810. A positive figure means
    // the order cost more than standard and 219810 needs a further debit
    // from the variance line to bring it to zero for this order; negative
    // means the reverse.
    const actualIncurred = order.actualLabourCostKobo + order.actualOverheadCostKobo;
    const variance = actualIncurred - order.standardConversionCostKobo;
    if (variance === 0n) {
      await this.prisma.productionOrder.update({ where: { id: order.id }, data: { settledAt: new Date() } });
      return { journalEntryId: null, variance: '0' };
    }

    const context = await this.postingContext(order.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${order.orderNumber}.`, {});
    }
    const dimensions = this.dimensions(order, context);
    // PCR-058 as a whole is NOT resolved through PostingControlService, same
    // reason as PCR-055: its credit key ("219810/6211xx/6212xx") is
    // non-atomic, and resolve() validates both sides eagerly. The debit
    // (520100, atomic) is looked up directly; the credit is the disclosed
    // recovery-account policy — it is the account PCR-053's standard
    // absorption already credited for this order.
    const [varianceAccount, recoveryAccount] = await Promise.all([
      this.resolvePostingKeyAccount(order.companyId, 'PCR-058-DR'),
      this.recoveryAccount(order.companyId),
    ]);

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
          narration: `Settle conversion variance on processing order ${order.orderNumber}`,
          ...dimensions,
          idempotencyKey: `production-order:${order.id}:settle`,
          actor: params.actor,
          lines: [
            {
              glAccountId: favourable ? recoveryAccount : varianceAccount,
              description: `PCR-058 — conversion variance settled (${order.orderNumber})`,
              debit: kobo(magnitude),
              dimensions,
            },
            {
              glAccountId: favourable ? varianceAccount : recoveryAccount,
              description: `PCR-058 — conversion variance settled (${order.orderNumber})`,
              credit: kobo(magnitude),
              dimensions,
            },
          ],
        },
        tx,
      );

      await tx.productionOrder.update({
        where: { id: order.id },
        data: { settlementJournalEntryId: result.journalEntryId, settledAt: new Date() },
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

  /**
   * One posting key's account, directly — for the rare case (PCR-055) where
   * the RULE has one non-atomic side and one atomic side, so calling
   * `PostingControlService.resolve()` for the rule as a whole would throw
   * before the atomic side could ever be read.
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

  private async postingContext(companyId: string, on: Date) {
    const [period, costCentre, company] = await Promise.all([
      this.prisma.financialPeriod.findFirst({
        where: { financialYear: { companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' },
        select: { id: true, financialYearId: true },
      }),
      this.prisma.costCentre.findFirst({
        where: { companyId, active: true },
        orderBy: { code: 'asc' },
        select: { id: true },
      }),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
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
        'No active Trade Payables account (210100) exists for actual overhead to credit.',
        {},
      );
    }
    return account.id;
  }

  private async recoveryAccount(companyId: string): Promise<string> {
    const account = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber: '219810', active: true },
    });
    if (!account) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting chart',
        'No active S_Recovery_GL account (219810) exists to settle variance against.',
        {},
      );
    }
    return account.id;
  }
}
