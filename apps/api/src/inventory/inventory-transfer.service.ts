import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { AuditAction, Prisma, InventoryTransferStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { PostingControlService, ResolvedRule } from '../posting-control/posting-control.service';
import { StockMovementService } from './stock-movement.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

/**
 * General inventory transfer and write-off (§14 — PCR-012/013/014,
 * US-897-008), outside any production order or delivery. The
 * production-order material-issue path already proved the negative-stock
 * guard and WAC costing (`StockMovementService`) — this is the same
 * primitive, reused for the client's own approved general-inventory rules.
 *
 * A transfer is genuinely two steps, not one: `issueTransfer()` posts PCR-012
 * (Dr Inventory in Transit / Cr Raw Materials) and moves stock out of the
 * source warehouse; `receiveTransfer()` posts PCR-013 (Dr Raw Materials / Cr
 * Inventory in Transit) at the ORIGINAL transfer value — frozen at issue,
 * never re-derived from wherever the item's WAC has since moved — and moves
 * stock into the destination warehouse. A return to source is not a third
 * concept: PCR-012's own reversal note reads "reverse transfer or return to
 * source", so a return is just a new transfer with the warehouses swapped.
 */
@Injectable()
export class InventoryTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly postingControl: PostingControlService,
    private readonly stockMovements: StockMovementService,
  ) {}

  async issueTransfer(params: {
    companyId: string;
    branchId: string;
    itemId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: Decimal.Value;
    transferNumber: string;
    actor: WorkflowActor;
  }): Promise<{ id: string; journalEntryId: string }> {
    if (params.fromWarehouseId === params.toWarehouseId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §14 — Inventory transfer',
        `${params.transferNumber} names the same warehouse as both source and destination.`,
        { transferNumber: params.transferNumber },
      );
    }

    const context = await this.postingContext(params.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Financial calendar',
        `No open period or cost centre to issue ${params.transferNumber} against.`,
        {},
      );
    }
    const dimensions = this.dimensions(params, context);
    const rule = await this.postingControl.resolve({ companyId: params.companyId, ruleId: 'PCR-012', on: new Date() });

    return this.prisma.$transaction(async (tx) => {
      const quantity = new Decimal(params.quantity);
      const issued = await this.stockMovements.issueOut({
        tx,
        companyId: params.companyId,
        branchId: params.branchId,
        itemId: params.itemId,
        warehouseId: params.fromWarehouseId,
        quantity,
        sourceModule: 'inventory',
        sourceDocumentType: 'InventoryTransfer',
        sourceDocumentId: params.transferNumber,
        documentReference: params.transferNumber,
        movementDate: new Date(),
      });

      const result = await this.posting.post(
        {
          sourceModule: 'inventory',
          sourceDocumentType: 'InventoryTransfer',
          sourceDocumentId: params.transferNumber,
          journalNumber: `${params.transferNumber}-ISSUE`,
          journalDate: new Date(),
          narration: `Transfer issue ${params.transferNumber}`,
          ...dimensions,
          idempotencyKey: `inventory-transfer:${params.transferNumber}:issue`,
          actor: params.actor,
          lines: [
            {
              glAccountId: this.requireSide(rule.debit, 'PCR-012', 'debit').glAccountId,
              description: `PCR-012 — transfer issue (${params.transferNumber})`,
              debit: kobo(issued.valueKobo),
              dimensions,
            },
            {
              glAccountId: this.requireSide(rule.credit, 'PCR-012', 'credit').glAccountId,
              description: `PCR-012 — transfer issue (${params.transferNumber})`,
              credit: kobo(issued.valueKobo),
              dimensions,
            },
          ],
        },
        tx,
      );

      const transfer = await tx.inventoryTransfer.create({
        data: {
          companyId: params.companyId,
          branchId: params.branchId,
          transferNumber: params.transferNumber,
          itemId: params.itemId,
          fromWarehouseId: params.fromWarehouseId,
          toWarehouseId: params.toWarehouseId,
          quantity: new Prisma.Decimal(quantity.toFixed(6)),
          valueKobo: issued.valueKobo,
          status: InventoryTransferStatus.IN_TRANSIT,
          issueJournalEntryId: result.journalEntryId,
          issuedAt: new Date(),
          createdById: params.actor.userId,
        },
      });

      await this.audit.write(
        {
          transactionId: transfer.id,
          module: 'inventory',
          entityType: 'InventoryTransfer',
          entityId: transfer.id,
          status: transfer.status,
          action: AuditAction.CREATE,
          userId: params.actor.userId,
          ipAddress: params.actor.ipAddress,
          device: params.actor.device,
          comments: `Issued transfer ${params.transferNumber}: ${quantity.toString()} units, ${issued.valueKobo} kobo.`,
        },
        tx,
      );

      return { id: transfer.id, journalEntryId: result.journalEntryId };
    }, { timeout: 15000 });
  }

  async receiveTransfer(params: {
    transferId: string;
    actor: WorkflowActor;
  }): Promise<{ journalEntryId: string }> {
    const transfer = await this.prisma.inventoryTransfer.findUniqueOrThrow({ where: { id: params.transferId } });

    if (transfer.status !== InventoryTransferStatus.IN_TRANSIT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §14 — Inventory transfer',
        `${transfer.transferNumber} is ${transfer.status}; only an in-transit transfer can be received.`,
        { transferNumber: transfer.transferNumber },
      );
    }

    const context = await this.postingContext(transfer.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', `No open period for ${transfer.transferNumber}.`, {});
    }
    const dimensions = this.dimensions(transfer, context);
    const rule = await this.postingControl.resolve({ companyId: transfer.companyId, ruleId: 'PCR-013', on: new Date() });

    return this.prisma.$transaction(async (tx) => {
      // Received at PCR-013's own basis — "original transfer value" — never
      // re-priced at the destination's current WAC.
      await this.stockMovements.receiveIn({
        tx,
        companyId: transfer.companyId,
        branchId: transfer.branchId,
        itemId: transfer.itemId,
        warehouseId: transfer.toWarehouseId,
        quantity: new Decimal(transfer.quantity.toString()),
        valueKobo: transfer.valueKobo,
        sourceModule: 'inventory',
        sourceDocumentType: 'InventoryTransfer',
        sourceDocumentId: transfer.transferNumber,
        documentReference: transfer.transferNumber,
        movementDate: new Date(),
      });

      const result = await this.posting.post(
        {
          sourceModule: 'inventory',
          sourceDocumentType: 'InventoryTransfer',
          sourceDocumentId: transfer.transferNumber,
          journalNumber: `${transfer.transferNumber}-RECEIPT`,
          journalDate: new Date(),
          narration: `Transfer receipt ${transfer.transferNumber}`,
          ...dimensions,
          idempotencyKey: `inventory-transfer:${transfer.transferNumber}:receipt`,
          actor: params.actor,
          lines: [
            {
              glAccountId: this.requireSide(rule.debit, 'PCR-013', 'debit').glAccountId,
              description: `PCR-013 — transfer receipt (${transfer.transferNumber})`,
              debit: kobo(transfer.valueKobo),
              dimensions,
            },
            {
              glAccountId: this.requireSide(rule.credit, 'PCR-013', 'credit').glAccountId,
              description: `PCR-013 — transfer receipt (${transfer.transferNumber})`,
              credit: kobo(transfer.valueKobo),
              dimensions,
            },
          ],
        },
        tx,
      );

      await tx.inventoryTransfer.update({
        where: { id: transfer.id },
        data: {
          status: InventoryTransferStatus.RECEIVED,
          receiptJournalEntryId: result.journalEntryId,
          receivedAt: new Date(),
        },
      });

      await this.audit.write(
        {
          transactionId: transfer.id,
          module: 'inventory',
          entityType: 'InventoryTransfer',
          entityId: transfer.id,
          status: InventoryTransferStatus.RECEIVED,
          action: AuditAction.UPDATE,
          userId: params.actor.userId,
          comments: `Received transfer ${transfer.transferNumber}.`,
        },
        tx,
      );

      return { journalEntryId: result.journalEntryId };
    }, { timeout: 15000 });
  }

  /** PCR-014 — an approved write-off, outside any production order or delivery. */
  async writeOff(params: {
    companyId: string;
    branchId: string;
    itemId: string;
    warehouseId: string;
    quantity: Decimal.Value;
    reason: string;
    actor: WorkflowActor;
  }): Promise<{ id: string; journalEntryId: string }> {
    if (!params.reason?.trim()) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §14 — Inventory write-off',
        'PCR-014 requires a reason — count evidence and reason approval is the rule’s own blocking condition.',
        {},
      );
    }

    const context = await this.postingContext(params.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', 'No open period for this write-off.', {});
    }
    const dimensions = this.dimensions(params, context);
    const rule = await this.postingControl.resolve({ companyId: params.companyId, ruleId: 'PCR-014', on: new Date() });

    // stock_movements is append-only (a DB trigger refuses UPDATE) — the id
    // this write-off will be created with has to be known BEFORE issueOut()
    // writes the movement, not patched in afterward.
    const writeOffId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const issued = await this.stockMovements.issueOut({
        tx,
        companyId: params.companyId,
        branchId: params.branchId,
        itemId: params.itemId,
        warehouseId: params.warehouseId,
        quantity: new Decimal(params.quantity),
        sourceModule: 'inventory',
        sourceDocumentType: 'InventoryWriteOff',
        sourceDocumentId: writeOffId,
        documentReference: params.reason,
        movementDate: new Date(),
      });

      const result = await this.posting.post(
        {
          sourceModule: 'inventory',
          sourceDocumentType: 'InventoryWriteOff',
          sourceDocumentId: writeOffId,
          journalNumber: `WO-${writeOffId.slice(0, 8).toUpperCase()}`,
          journalDate: new Date(),
          narration: `Inventory write-off: ${params.reason}`,
          ...dimensions,
          idempotencyKey: `inventory-write-off:${issued.stockMovementId}`,
          actor: params.actor,
          lines: [
            {
              glAccountId: this.requireSide(rule.debit, 'PCR-014', 'debit').glAccountId,
              description: `PCR-014 — inventory write-off (${params.reason})`,
              debit: kobo(issued.valueKobo),
              dimensions,
            },
            {
              glAccountId: this.requireSide(rule.credit, 'PCR-014', 'credit').glAccountId,
              description: `PCR-014 — inventory write-off (${params.reason})`,
              credit: kobo(issued.valueKobo),
              dimensions,
            },
          ],
        },
        tx,
      );

      const writeOff = await tx.inventoryWriteOff.create({
        data: {
          id: writeOffId,
          companyId: params.companyId,
          branchId: params.branchId,
          itemId: params.itemId,
          warehouseId: params.warehouseId,
          quantity: new Prisma.Decimal(new Decimal(params.quantity).toFixed(6)),
          valueKobo: issued.valueKobo,
          reason: params.reason,
          journalEntryId: result.journalEntryId,
          createdById: params.actor.userId,
        },
      });

      await this.audit.write(
        {
          transactionId: writeOff.id,
          module: 'inventory',
          entityType: 'InventoryWriteOff',
          entityId: writeOff.id,
          status: 'POSTED',
          action: AuditAction.CREATE,
          userId: params.actor.userId,
          ipAddress: params.actor.ipAddress,
          device: params.actor.device,
          comments: `Wrote off ${params.quantity.toString()} units — ${issued.valueKobo} kobo — ${params.reason}`,
        },
        tx,
      );

      return { id: writeOff.id, journalEntryId: result.journalEntryId };
    }, { timeout: 15000 });
  }

  private requireSide(side: ResolvedRule['debit'], ruleId: string, name: string) {
    if (!side) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting rule',
        `${ruleId}'s ${name} side posts nothing, which inventory cannot use.`,
        { ruleId },
      );
    }
    return side;
  }

  private dimensions(
    entity: { companyId: string; branchId: string },
    context: { period: { id: string; financialYearId: string }; costCentre: { id: string }; company: { baseCurrencyId: string } },
  ) {
    return {
      companyId: entity.companyId,
      branchId: entity.branchId,
      financialYearId: context.period.financialYearId,
      financialPeriodId: context.period.id,
      currencyId: context.company.baseCurrencyId,
      exchangeRate: '1',
      costCentreId: context.costCentre.id,
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
}
