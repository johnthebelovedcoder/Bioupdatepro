import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { nextReference, siteOf } from '../numbering/numbering';
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
/** Who may approve a write-off (PCR-014): not the storekeeper who asked for it. */
const WRITE_OFF_APPROVERS = ['FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO', 'ADMINISTRATOR'];

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
    /** Given by NumberingService when not supplied (Numbering_Parameters). */
    transferNumber?: string;
    actor: WorkflowActor;
  }): Promise<{ id: string; journalEntryId: string; transferNumber: string }> {
    const transferNumber =
      params.transferNumber?.trim() ||
      (await nextReference(this.prisma, {
        companyId: params.companyId,
        type: 'WTR',
        site: await siteOf(this.prisma, { farmId: null, branchId: params.branchId }),
        date: new Date(),
      }));

    if (params.fromWarehouseId === params.toWarehouseId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §14 — Inventory transfer',
        `${transferNumber} names the same warehouse as both source and destination.`,
        { transferNumber: transferNumber },
      );
    }

    const context = await this.postingContext(params.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Financial calendar',
        `No open period or cost centre to issue ${transferNumber} against.`,
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
        sourceDocumentId: transferNumber,
        documentReference: transferNumber,
        movementDate: new Date(),
        perStore: true,
      });

      const result = await this.posting.post(
        {
          sourceModule: 'inventory',
          sourceDocumentType: 'InventoryTransfer',
          sourceDocumentId: transferNumber,
          journalNumber: `${transferNumber}-ISSUE`,
          journalDate: new Date(),
          narration: `Transfer issue ${transferNumber}`,
          ...dimensions,
          idempotencyKey: `inventory-transfer:${transferNumber}:issue`,
          actor: params.actor,
          lines: [
            {
              glAccountId: this.requireSide(rule.debit, 'PCR-012', 'debit').glAccountId,
              description: `PCR-012 — transfer issue (${transferNumber})`,
              debit: kobo(issued.valueKobo),
              dimensions,
            },
            {
              glAccountId: this.requireSide(rule.credit, 'PCR-012', 'credit').glAccountId,
              description: `PCR-012 — transfer issue (${transferNumber})`,
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
          transferNumber,
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
          comments: `Issued transfer ${transferNumber}: ${quantity.toString()} units, ${issued.valueKobo} kobo.`,
        },
        tx,
      );

      return { id: transfer.id, journalEntryId: result.journalEntryId, transferNumber: transfer.transferNumber };
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

  /**
   * PCR-014 — an *approved* write-off, outside any production order or
   * delivery. Requesting one records it as PENDING: nothing leaves the store
   * and nothing posts until someone other than the requester approves it.
   */
  async writeOff(params: {
    companyId: string;
    branchId: string;
    itemId: string;
    warehouseId: string;
    quantity: Decimal.Value;
    reason: string;
    actor: WorkflowActor;
  }): Promise<{ id: string; status: string; journalEntryId: string | null }> {
    if (!params.reason?.trim()) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §14 — Inventory write-off',
        'PCR-014 requires a reason — count evidence and reason approval is the rule’s own blocking condition.',
        {},
      );
    }
    const quantity = new Decimal(params.quantity);
    if (quantity.isNaN() || quantity.lte(0)) {
      throw new AccountingRuleViolation('Consolidated Reference §14 — Inventory write-off', 'Write off a quantity greater than zero.', {});
    }
    const item = await this.prisma.item.findFirst({ where: { id: params.itemId, companyId: params.companyId }, select: { id: true, code: true } });
    if (!item) throw new NotFoundException('No such item.');

    return this.prisma.$transaction(async (tx) => {
      // Refused now, in words, if the store does not hold it — not only at approval.
      await this.stockMovements.assertStoreHolds({
        tx, companyId: params.companyId, itemId: params.itemId, warehouseId: params.warehouseId, quantity, documentReference: params.reason,
      });
      const position = await this.stockMovements.currentPosition(tx, params.companyId, params.itemId);
      const estimate = BigInt(quantity.mul((position.wacKobo ?? 0n).toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      const writeOff = await tx.inventoryWriteOff.create({
        data: {
          companyId: params.companyId,
          branchId: params.branchId,
          itemId: params.itemId,
          warehouseId: params.warehouseId,
          quantity: new Prisma.Decimal(quantity.toFixed(6)),
          valueKobo: estimate,
          reason: params.reason.trim(),
          status: 'PENDING',
          createdById: params.actor.userId,
        },
      });
      await this.audit.write(
        {
          transactionId: writeOff.id,
          module: 'inventory',
          entityType: 'InventoryWriteOff',
          entityId: writeOff.id,
          status: 'PENDING',
          action: AuditAction.CREATE,
          userId: params.actor.userId,
          ipAddress: params.actor.ipAddress,
          device: params.actor.device,
          comments: `Requested write-off of ${quantity.toString()} ${item.code} (about ${estimate} kobo) — ${params.reason.trim()}`,
        },
        tx,
      );
      return { id: writeOff.id, status: 'PENDING', journalEntryId: null };
    });
  }

  /**
   * Approve (issue the stock at moving average now and post PCR-014) or
   * reject a requested write-off — by someone other than the requester.
   */
  async decideWriteOff(params: { companyId: string; writeOffId: string; approve: boolean; reason?: string | null; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => WRITE_OFF_APPROVERS.includes(r))) {
      throw new ForbiddenException('A farm manager or finance approver decides a write-off.');
    }
    const writeOff = await this.prisma.inventoryWriteOff.findFirst({
      where: { id: params.writeOffId, companyId: params.companyId },
      include: { item: { select: { code: true } } },
    });
    if (!writeOff) throw new NotFoundException('No such write-off.');
    if (writeOff.status !== 'PENDING') throw new BadRequestException(`That write-off was already ${writeOff.status.toLowerCase()}.`);
    if (params.approve && writeOff.createdById === params.actor.userId) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) throw new ForbiddenException('You requested this write-off, so someone else approves it (PCR-014).');
    }
    const reason = params.reason?.trim() || null;

    if (!params.approve) {
      if (!reason) throw new BadRequestException('Say why the write-off is rejected.');
      await this.prisma.inventoryWriteOff.update({
        where: { id: writeOff.id },
        data: { status: 'REJECTED', approvedById: params.actor.userId, approvedAt: new Date(), rejectionReason: reason },
      });
      await this.audit.write({
        transactionId: writeOff.id,
        module: 'inventory',
        entityType: 'InventoryWriteOff',
        entityId: writeOff.id,
        status: 'REJECTED',
        action: AuditAction.REJECT,
        userId: params.actor.userId,
        comments: reason,
      });
      return { id: writeOff.id, status: 'REJECTED', journalEntryId: null };
    }

    const context = await this.postingContext(params.companyId, new Date());
    if (!context) {
      throw new AccountingRuleViolation('Consolidated Reference §8 — Financial calendar', 'No open period for this write-off.', {});
    }
    const dimensions = this.dimensions({ companyId: params.companyId, branchId: writeOff.branchId }, context);
    const rule = await this.postingControl.resolve({ companyId: params.companyId, ruleId: 'PCR-014', on: new Date() });

    return this.prisma.$transaction(async (tx) => {
      const issued = await this.stockMovements.issueOut({
        tx,
        companyId: params.companyId,
        branchId: writeOff.branchId,
        itemId: writeOff.itemId,
        warehouseId: writeOff.warehouseId,
        quantity: new Decimal(writeOff.quantity.toString()),
        sourceModule: 'inventory',
        sourceDocumentType: 'InventoryWriteOff',
        sourceDocumentId: writeOff.id,
        documentReference: writeOff.reason,
        movementDate: new Date(),
        perStore: true,
      });

      const result = await this.posting.post(
        {
          sourceModule: 'inventory',
          sourceDocumentType: 'InventoryWriteOff',
          sourceDocumentId: writeOff.id,
          journalNumber: `WO-${writeOff.id.slice(0, 8).toUpperCase()}`,
          journalDate: new Date(),
          narration: `Inventory write-off: ${writeOff.reason}`,
          ...dimensions,
          idempotencyKey: `inventory-write-off:${issued.stockMovementId}`,
          actor: params.actor,
          lines: [
            {
              glAccountId: this.requireSide(rule.debit, 'PCR-014', 'debit').glAccountId,
              description: `PCR-014 — inventory write-off (${writeOff.reason})`,
              debit: kobo(issued.valueKobo),
              dimensions,
            },
            {
              glAccountId: this.requireSide(rule.credit, 'PCR-014', 'credit').glAccountId,
              description: `PCR-014 — inventory write-off (${writeOff.reason})`,
              credit: kobo(issued.valueKobo),
              dimensions,
            },
          ],
        },
        tx,
      );

      await tx.inventoryWriteOff.update({
        where: { id: writeOff.id },
        data: { status: 'POSTED', valueKobo: issued.valueKobo, journalEntryId: result.journalEntryId, approvedById: params.actor.userId, approvedAt: new Date() },
      });
      await this.audit.write(
        {
          transactionId: writeOff.id,
          module: 'inventory',
          entityType: 'InventoryWriteOff',
          entityId: writeOff.id,
          status: 'POSTED',
          action: AuditAction.APPROVE,
          userId: params.actor.userId,
          comments: `Approved write-off of ${writeOff.quantity.toString()} ${writeOff.item.code} — ${issued.valueKobo} kobo — ${writeOff.reason}`,
        },
        tx,
      );
      return { id: writeOff.id, status: 'POSTED', journalEntryId: result.journalEntryId };
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
