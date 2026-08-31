import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma, StockDirection } from '@bioassetpro/database';
import { AccountingRuleViolation } from '../common/errors';

export interface StockPosition {
  /** QUANTITY on hand, summed across every warehouse — company-wide, the
   * same scope `ItemStandardCost` already uses. */
  quantity: Decimal;
  /** MONEY. Total value on hand at moving weighted-average cost. */
  valueKobo: bigint;
  /** MONEY. Null when nothing has ever moved for this item — there is no
   * average of zero movements. */
  wacKobo: bigint | null;
}

/**
 * The generic inventory ledger (`StockMovement`) and the moving
 * weighted-average cost it materialises onto `Item.weightedAverageCostKobo`.
 *
 * Extracted from `goods-receipt.service.ts`, which had this logic private to
 * itself and only ever wrote the IN side. US-897-016's production-order
 * material issue needs the same on-hand/WAC read to write the OUT side —
 * same query, same computation, now one copy instead of two.
 */
@Injectable()
export class StockMovementService {
  /**
   * On-hand quantity, value and moving weighted-average cost for an item,
   * from every `StockMovement` recorded so far. Never a stored balance —
   * always derived, the same materialised-balance discipline
   * `LivestockGroup.population` uses, just without the "materialised" part:
   * there is no single row to keep in sync, only the ledger itself.
   */
  async currentPosition(
    tx: Prisma.TransactionClient,
    companyId: string,
    itemId: string,
  ): Promise<StockPosition> {
    const movements = await tx.stockMovement.findMany({
      where: { companyId, itemId },
      select: { direction: true, quantity: true, valueKobo: true },
    });

    let quantity = new Decimal(0);
    let valueKobo = 0n;
    for (const movement of movements) {
      const sign = movement.direction === StockDirection.IN ? 1 : -1;
      quantity = quantity.plus(new Decimal(movement.quantity.toString()).mul(sign));
      valueKobo += movement.valueKobo * BigInt(sign);
    }

    const wacKobo =
      movements.length === 0 || quantity.lessThanOrEqualTo(0)
        ? null
        : BigInt(
            new Decimal(valueKobo.toString())
              .div(quantity)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toFixed(0),
          );

    return { quantity, valueKobo, wacKobo };
  }

  /**
   * Advance the moving WAC for a receipt, from the position just before this
   * receipt lands — before the caller creates the `StockMovement` row, or
   * this receipt would be averaged against itself.
   */
  async advanceWeightedAverageCostOnReceipt(params: {
    tx: Prisma.TransactionClient;
    companyId: string;
    itemId: string;
    receivedQuantity: Decimal;
    receivedValueKobo: bigint;
  }): Promise<void> {
    const before = await this.currentPosition(params.tx, params.companyId, params.itemId);
    const newQuantity = before.quantity.plus(params.receivedQuantity);
    if (newQuantity.lessThanOrEqualTo(0)) return; // Nothing on hand to average.

    const newValueKobo = before.valueKobo + params.receivedValueKobo;
    const newWac = BigInt(
      new Decimal(newValueKobo.toString())
        .div(newQuantity)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toFixed(0),
    );

    await params.tx.item.update({
      where: { id: params.itemId },
      data: { weightedAverageCostKobo: newWac, weightedAverageCostSetAt: new Date() },
    });
  }

  /**
   * Receive stock IN at a known total value — the caller has already priced
   * it (a joint-cost allocation, a goods receipt line), so this only records
   * the movement and rolls the item's WAC forward, exactly the way
   * `goods-receipt.service.ts` always has.
   */
  async receiveIn(params: {
    tx: Prisma.TransactionClient;
    companyId: string;
    branchId: string;
    itemId: string;
    warehouseId: string;
    quantity: Decimal;
    valueKobo: bigint;
    batchReference?: string | null;
    sourceModule: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    documentReference: string;
    movementDate: Date;
    journalEntryId?: string | null;
  }): Promise<{ stockMovementId: string; unitCostKobo: bigint }> {
    if (params.quantity.lessThanOrEqualTo(0)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §14 — Inventory receipt',
        `${params.documentReference} cannot receive a non-positive quantity.`,
        { itemId: params.itemId, quantity: params.quantity.toString() },
      );
    }

    await this.advanceWeightedAverageCostOnReceipt({
      tx: params.tx,
      companyId: params.companyId,
      itemId: params.itemId,
      receivedQuantity: params.quantity,
      receivedValueKobo: params.valueKobo,
    });

    const unitCostKobo = BigInt(
      new Decimal(params.valueKobo.toString())
        .div(params.quantity)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toFixed(0),
    );

    const movement = await params.tx.stockMovement.create({
      data: {
        companyId: params.companyId,
        branchId: params.branchId,
        itemId: params.itemId,
        warehouseId: params.warehouseId,
        direction: StockDirection.IN,
        quantity: new Prisma.Decimal(params.quantity.toFixed(6)),
        unitCostKobo,
        valueKobo: params.valueKobo,
        batchReference: params.batchReference ?? null,
        sourceModule: params.sourceModule,
        sourceDocumentType: params.sourceDocumentType,
        sourceDocumentId: params.sourceDocumentId,
        documentReference: params.documentReference,
        movementDate: params.movementDate,
        journalEntryId: params.journalEntryId ?? null,
      },
    });

    return { stockMovementId: movement.id, unitCostKobo };
  }

  /**
   * Issue stock OUT at its current WAC, refusing anything that would take the
   * balance negative (US-897-008). An OUT does not change the average — it
   * removes quantity and value in the same proportion — so `Item` is not
   * touched here, only the ledger.
   */
  async issueOut(params: {
    tx: Prisma.TransactionClient;
    companyId: string;
    branchId: string;
    itemId: string;
    warehouseId: string;
    quantity: Decimal;
    batchReference?: string | null;
    sourceModule: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    documentReference: string;
    movementDate: Date;
    journalEntryId?: string | null;
  }): Promise<{ stockMovementId: string; unitCostKobo: bigint; valueKobo: bigint }> {
    const before = await this.currentPosition(params.tx, params.companyId, params.itemId);

    if (before.wacKobo === null) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §14 — Inventory issue',
        `${params.documentReference} cannot issue this item — nothing has ever been received ` +
          `for it, so there is no cost to issue at.`,
        { itemId: params.itemId },
      );
    }

    if (before.quantity.lessThan(params.quantity)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §14 — Inventory issue',
        `${params.documentReference} would take stock negative — ${before.quantity.toFixed(6)} ` +
          `on hand, ${params.quantity.toString()} requested.`,
        { itemId: params.itemId, onHand: before.quantity.toFixed(6), requested: params.quantity.toString() },
      );
    }

    const valueKobo = BigInt(
      new Decimal(before.wacKobo.toString())
        .mul(params.quantity)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toFixed(0),
    );

    const movement = await params.tx.stockMovement.create({
      data: {
        companyId: params.companyId,
        branchId: params.branchId,
        itemId: params.itemId,
        warehouseId: params.warehouseId,
        direction: StockDirection.OUT,
        quantity: new Prisma.Decimal(params.quantity.toFixed(6)),
        unitCostKobo: before.wacKobo,
        valueKobo,
        batchReference: params.batchReference ?? null,
        sourceModule: params.sourceModule,
        sourceDocumentType: params.sourceDocumentType,
        sourceDocumentId: params.sourceDocumentId,
        documentReference: params.documentReference,
        movementDate: params.movementDate,
        journalEntryId: params.journalEntryId ?? null,
      },
    });

    return { stockMovementId: movement.id, unitCostKobo: before.wacKobo, valueKobo };
  }
}
