import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  GrnStatus,
  ItemType,
  Prisma,
  SupplierInvoiceStatus,
  SupplierReturnStatus,
  VatDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { StockMovementService } from '../inventory/stock-movement.service';
import { TaxEngineService } from '../tax/tax-engine.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { allowsSelfApproval } from '../workflow/self-approval';
import { nextReference, siteOf } from '../numbering/numbering';
import { ProcurementConfigService } from './procurement-config.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

/** Who approves a return to a supplier. */
export const RETURN_APPROVERS = ['FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO'];

const RULE = 'Handbook §35 — Return to supplier';
const round = (d: Decimal) => BigInt(d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));

/**
 * Goods sent back to a supplier from a posted receipt (handbook §35: "Reverse
 * supplier quantity and accounting with source link").
 *
 * Raised by one person, approved by another. On approval, in one transaction:
 * the stock leaves its store; the part not yet invoiced is taken off GRNI at
 * the receipt price (Dr GRNI / Cr Inventory) and can no longer be billed; the
 * part already invoiced becomes a debit note against that invoice at the
 * invoice price, VAT included (Dr Trade payables / Cr Inventory / Cr Input
 * VAT), reducing what is owed. A debit note larger than what is still open on
 * the invoice is refused — money already paid comes back as a refund receipt,
 * not by driving the payable negative.
 */
@Injectable()
export class SupplierReturnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly stockMovements: StockMovementService,
    private readonly tax: TaxEngineService,
    private readonly config: ProcurementConfigService,
  ) {}

  async list(companyId: string) {
    const rows = await this.prisma.supplierReturn.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { lines: { include: { grnLine: { select: { item: { select: { code: true } } } } } } },
    });
    const suppliers = await this.prisma.supplier.findMany({
      where: { companyId, id: { in: [...new Set(rows.map((r) => r.supplierId))] } },
      select: { id: true, name: true },
    });
    const grns = await this.prisma.goodsReceiptNote.findMany({
      where: { companyId, id: { in: [...new Set(rows.map((r) => r.grnId))] } },
      select: { id: true, grnNumber: true },
    });
    return rows.map((r) => ({
      id: r.id,
      returnNumber: r.returnNumber,
      supplier: suppliers.find((s) => s.id === r.supplierId)?.name ?? '',
      grnNumber: grns.find((g) => g.id === r.grnId)?.grnNumber ?? '',
      returnDate: r.returnDate.toISOString().slice(0, 10),
      reason: r.reason,
      status: r.status,
      items: r.lines.map((l) => `${l.grnLine.item.code} × ${new Decimal(l.quantity.toString()).toString()}`),
      stockValueKobo: r.stockValueKobo.toString(),
      debitNoteKobo: r.debitNoteKobo.toString(),
      requestedById: r.requestedById,
      decisionNote: r.decisionNote,
    }));
  }

  /** What can still go back on a posted receipt, line by line. */
  async returnable(companyId: string, grnId: string) {
    const grn = await this.prisma.goodsReceiptNote.findFirst({
      where: { id: grnId, companyId },
      include: { supplier: { select: { name: true } }, lines: { orderBy: { lineNumber: 'asc' }, include: { item: { select: { code: true, description: true, itemType: true } } } } },
    });
    if (!grn) throw new NotFoundException('No such goods receipt.');
    const pending = await this.pendingByLine(grn.lines.map((l) => l.id));
    return {
      grnId: grn.id,
      grnNumber: grn.grnNumber,
      supplier: grn.supplier.name,
      status: grn.status,
      lines: grn.lines
        .filter((l) => l.item.itemType === ItemType.INVENTORY)
        .map((l) => {
          const accepted = new Decimal(l.acceptedQuantity.toString());
          const returned = new Decimal(l.returnedQuantity.toString());
          const open = Decimal.max(0, accepted.minus(returned).minus(pending.get(l.id) ?? 0));
          return {
            grnLineId: l.id,
            itemCode: l.item.code,
            description: l.item.description,
            acceptedQuantity: accepted.toString(),
            returnedQuantity: returned.toString(),
            pendingQuantity: (pending.get(l.id) ?? new Decimal(0)).toString(),
            returnableQuantity: open.toString(),
            invoicedQuantity: l.invoicedQuantity.toString(),
            unitPriceKobo: l.unitPriceKobo.toString(),
          };
        }),
    };
  }

  async request(params: {
    companyId: string;
    grnId: string;
    returnDate: Date;
    reason: string;
    lines: Array<{ grnLineId: string; quantity: Decimal.Value }>;
    actor: WorkflowActor;
  }) {
    if (!params.reason?.trim()) throw new BadRequestException('Say why the goods are going back.');
    const grn = await this.prisma.goodsReceiptNote.findFirst({
      where: { id: params.grnId, companyId: params.companyId },
      include: { lines: { include: { item: true } }, purchaseOrder: { select: { farmId: true } } },
    });
    if (!grn) throw new NotFoundException('No such goods receipt.');
    if (grn.status !== GrnStatus.POSTED) {
      throw new AccountingRuleViolation(RULE, `${grn.grnNumber} is ${grn.status}; only a posted receipt can be returned against.`, { grnNumber: grn.grnNumber });
    }
    const wanted = params.lines.filter((l) => l.quantity !== '' && l.quantity !== null && new Decimal(l.quantity).gt(0));
    if (wanted.length === 0) throw new BadRequestException('Return at least one item.');
    if (new Set(wanted.map((l) => l.grnLineId)).size !== wanted.length) throw new BadRequestException('Each receipt line once per return.');
    const pending = await this.pendingByLine(grn.lines.map((l) => l.id));
    for (const want of wanted) {
      const line = grn.lines.find((l) => l.id === want.grnLineId);
      if (!line) throw new BadRequestException('A line is not on this receipt.');
      if (line.item.itemType !== ItemType.INVENTORY) {
        throw new AccountingRuleViolation(RULE, `${line.item.code} is not a stock item; a service or expense is corrected by credit from the supplier, not a return.`, { itemCode: line.item.code });
      }
      const open = new Decimal(line.acceptedQuantity.toString()).minus(line.returnedQuantity.toString()).minus(pending.get(line.id) ?? 0);
      if (new Decimal(want.quantity).gt(open)) {
        throw new AccountingRuleViolation(RULE, `${line.item.code}: ${open.toString()} can still be returned on ${grn.grnNumber}; ${new Decimal(want.quantity).toString()} asked.`, { itemCode: line.item.code, returnable: open.toString() });
      }
    }

    const returnNumber = await nextReference(this.prisma, {
      companyId: params.companyId,
      type: 'SRN',
      site: await siteOf(this.prisma, { farmId: grn.purchaseOrder.farmId, branchId: grn.branchId }),
      date: params.returnDate,
    });
    const created = await this.prisma.supplierReturn.create({
      data: {
        companyId: params.companyId,
        returnNumber,
        supplierId: grn.supplierId,
        grnId: grn.id,
        returnDate: params.returnDate,
        reason: params.reason.trim(),
        requestedById: params.actor.userId,
        lines: { create: wanted.map((l) => ({ grnLineId: l.grnLineId, quantity: new Prisma.Decimal(new Decimal(l.quantity).toFixed(6)) })) },
      },
    });
    await this.audit.write({
      transactionId: created.id,
      module: 'procurement',
      entityType: 'SupplierReturn',
      entityId: created.id,
      status: created.status,
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      comments: `${returnNumber} raised against ${grn.grnNumber}: ${params.reason.trim()}`,
    });
    return { id: created.id, returnNumber };
  }

  async decide(params: { companyId: string; returnId: string; decision: 'APPROVE' | 'REJECT'; note?: string | null; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => RETURN_APPROVERS.includes(r))) {
      throw new ForbiddenException('A return to a supplier is approved by the finance manager, controller or CFO.');
    }
    const ret = await this.prisma.supplierReturn.findFirst({ where: { id: params.returnId, companyId: params.companyId } });
    if (!ret) throw new NotFoundException('No such return.');
    if (ret.status !== SupplierReturnStatus.PENDING) throw new BadRequestException(`${ret.returnNumber} was already ${ret.status.toLowerCase()}.`);
    if (ret.requestedById === params.actor.userId && !(await allowsSelfApproval(this.prisma, params.companyId))) {
      throw new ForbiddenException(`You raised ${ret.returnNumber}, so someone else approves it.`);
    }
    if (params.decision === 'REJECT') {
      if (!params.note?.trim()) throw new BadRequestException('Say why the return is rejected.');
      await this.prisma.supplierReturn.update({
        where: { id: ret.id },
        data: { status: SupplierReturnStatus.REJECTED, decidedById: params.actor.userId, decidedAt: new Date(), decisionNote: params.note.trim() },
      });
      await this.audit.write({
        transactionId: ret.id,
        module: 'procurement',
        entityType: 'SupplierReturn',
        entityId: ret.id,
        status: SupplierReturnStatus.REJECTED,
        action: AuditAction.REJECT,
        userId: params.actor.userId,
        comments: params.note.trim(),
      });
      return { id: ret.id, status: SupplierReturnStatus.REJECTED };
    }
    return this.post(ret.id, params.note ?? null, params.actor);
  }

  private async post(returnId: string, note: string | null, actor: WorkflowActor) {
    return this.prisma.$transaction(
      async (tx) => {
        const ret = await tx.supplierReturn.findUniqueOrThrow({
          where: { id: returnId },
          include: { lines: { include: { grnLine: { include: { item: true } } } } },
        });
        if (ret.status !== SupplierReturnStatus.PENDING) throw new BadRequestException(`${ret.returnNumber} was already ${ret.status.toLowerCase()}.`);
        const grn = await tx.goodsReceiptNote.findUniqueOrThrow({
          where: { id: ret.grnId },
          include: { purchaseOrder: { select: { costCentreId: true, farmId: true, departmentId: true } }, supplier: { select: { name: true } } },
        });
        const period = await tx.financialPeriod.findFirst({
          where: { financialYear: { companyId: ret.companyId }, startDate: { lte: ret.returnDate }, endDate: { gte: ret.returnDate } },
          select: { id: true, financialYearId: true, status: true, name: true },
        });
        if (!period || period.status !== 'OPEN') {
          throw new AccountingRuleViolation(RULE, `No open period covers ${ret.returnDate.toISOString().slice(0, 10)}.`, {});
        }
        const settings = await this.config.resolve(ret.companyId, ret.returnDate, tx);
        const dimensions = {
          companyId: ret.companyId,
          branchId: grn.branchId,
          financialYearId: period.financialYearId,
          financialPeriodId: period.id,
          currencyId: grn.currencyId,
          exchangeRate: '1.00000000',
        };
        const lineDimensions = {
          ...dimensions,
          costCentreId: grn.purchaseOrder.costCentreId,
          farmId: grn.purchaseOrder.farmId,
          departmentId: grn.purchaseOrder.departmentId,
          supplierId: grn.supplierId,
        };

        const journal: Array<{ glAccountId: string; description: string; debit?: bigint; credit?: bigint; itemId?: string | null }> = [];
        const settle = new Map<string, bigint>();
        let stockValue = 0n;
        let debitNote = 0n;

        for (const line of ret.lines) {
          const grnLine = line.grnLine;
          const item = grnLine.item;
          if (!item.inventoryGlAccountId) {
            throw new AccountingRuleViolation(RULE, `${item.code} has no stock account to credit.`, { itemCode: item.code });
          }
          const qty = new Decimal(line.quantity.toString());
          const accepted = new Decimal(grnLine.acceptedQuantity.toString());
          const returned = new Decimal(grnLine.returnedQuantity.toString());
          if (qty.gt(accepted.minus(returned))) {
            throw new AccountingRuleViolation(RULE, `${item.code}: only ${accepted.minus(returned).toString()} is left to return.`, { itemCode: item.code });
          }
          // Returned before invoicing so far = returned − debit-noted.
          const returnedUninvoiced = returned.minus(grnLine.debitNotedQuantity.toString());
          const uninvoicedOpen = Decimal.max(0, accepted.minus(grnLine.invoicedQuantity.toString()).minus(returnedUninvoiced));
          const fromUninvoiced = Decimal.min(qty, uninvoicedOpen);
          const fromInvoiced = qty.minus(fromUninvoiced);

          let lineValue = 0n;
          if (fromUninvoiced.gt(0)) {
            const value = round(fromUninvoiced.mul(grnLine.unitPriceKobo.toString()));
            lineValue += value;
            journal.push({ glAccountId: settings.grniGlAccountId, description: `Returned before invoicing — ${item.code} (${ret.returnNumber})`, debit: value });
          }
          if (fromInvoiced.gt(0)) {
            const invoiceLine = await tx.supplierInvoiceLine.findFirst({
              where: {
                goodsReceiptNoteLineId: grnLine.id,
                invoice: { status: { in: [SupplierInvoiceStatus.POSTED, SupplierInvoiceStatus.PART_PAID, SupplierInvoiceStatus.PAID] } },
              },
              orderBy: { createdAt: 'desc' },
              include: { invoice: true },
            });
            if (!invoiceLine) {
              throw new AccountingRuleViolation(RULE, `${item.code} was invoiced, but not on an invoice line tied to ${grn.grnNumber}; raise the debit note with the supplier's credit note instead.`, { itemCode: item.code });
            }
            const net = round(fromInvoiced.mul(invoiceLine.unitPriceKobo.toString()));
            const vat = invoiceLine.vatAmountKobo > 0n
              ? round(new Decimal(invoiceLine.vatAmountKobo.toString()).mul(fromInvoiced).div(invoiceLine.quantity.toString()))
              : 0n;
            const gross = net + vat;
            const already = settle.get(invoiceLine.invoiceId) ?? 0n;
            const open = invoiceLine.invoice.grossAmountKobo - invoiceLine.invoice.settledAmountKobo - already;
            if (gross > open) {
              throw new AccountingRuleViolation(
                RULE,
                `${invoiceLine.invoice.invoiceNumber} has ${open} kobo still open; a debit note of ${gross} kobo would take it below nothing. Record the supplier's refund as a receipt instead.`,
                { invoiceNumber: invoiceLine.invoice.invoiceNumber },
              );
            }
            settle.set(invoiceLine.invoiceId, already + gross);
            lineValue += net;
            debitNote += gross;
            journal.push({ glAccountId: settings.payablesGlAccountId, description: `Debit note — ${item.code}, ${invoiceLine.invoice.invoiceNumber} (${ret.returnNumber})`, debit: gross });
            if (vat > 0n) {
              const inputVat = await this.tax.glAccountFor(ret.companyId, invoiceLine.taxCodeId!, VatDirection.INPUT, ret.returnDate, tx);
              journal.push({ glAccountId: inputVat, description: `Input VAT reversed — ${invoiceLine.invoice.invoiceNumber} (${ret.returnNumber})`, credit: vat });
            }
          }
          journal.push({ glAccountId: item.inventoryGlAccountId, description: `Returned to ${grn.supplier.name} — ${item.code}`, credit: lineValue, itemId: item.id });
          stockValue += lineValue;

          await this.stockMovements.issueOutAtValue({
            tx,
            companyId: ret.companyId,
            branchId: grn.branchId,
            itemId: item.id,
            warehouseId: grnLine.warehouseId ?? grn.warehouseId,
            quantity: qty,
            valueKobo: lineValue,
            batchReference: grnLine.batchReference,
            sourceModule: 'procurement',
            sourceDocumentType: 'SupplierReturn',
            sourceDocumentId: ret.id,
            documentReference: ret.returnNumber,
            movementDate: ret.returnDate,
            perStore: true,
          });
          await tx.goodsReceiptNoteLine.update({
            where: { id: grnLine.id },
            data: {
              returnedQuantity: new Prisma.Decimal(returned.plus(qty).toFixed(6)),
              debitNotedQuantity: new Prisma.Decimal(new Decimal(grnLine.debitNotedQuantity.toString()).plus(fromInvoiced).toFixed(6)),
            },
          });
        }

        const result = await this.posting.post(
          {
            sourceModule: 'procurement',
            sourceDocumentType: 'SupplierReturn',
            sourceDocumentId: ret.id,
            journalNumber: ret.returnNumber,
            journalDate: ret.returnDate,
            narration: `Return to ${grn.supplier.name} — ${ret.returnNumber} against ${grn.grnNumber}`,
            ...dimensions,
            idempotencyKey: `supplier-return:${ret.id}`,
            actor,
            lines: journal
              .filter((l) => (l.debit ?? 0n) > 0n || (l.credit ?? 0n) > 0n)
              .map((l) => ({
                glAccountId: l.glAccountId,
                description: l.description,
                debit: l.debit !== undefined ? kobo(l.debit) : undefined,
                credit: l.credit !== undefined ? kobo(l.credit) : undefined,
                dimensions: { ...lineDimensions, itemId: l.itemId ?? null },
              })),
          },
          tx,
        );

        for (const [invoiceId, amount] of settle) {
          const invoice = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
          const settled = invoice.settledAmountKobo + amount;
          await tx.supplierInvoice.update({
            where: { id: invoiceId },
            data: { settledAmountKobo: settled, status: settled >= invoice.grossAmountKobo ? SupplierInvoiceStatus.PAID : SupplierInvoiceStatus.PART_PAID },
          });
        }

        await tx.supplierReturn.update({
          where: { id: ret.id },
          data: {
            status: SupplierReturnStatus.POSTED,
            stockValueKobo: stockValue,
            debitNoteKobo: debitNote,
            debitNoteInvoiceId: [...settle.keys()][0] ?? null,
            journalEntryId: result.journalEntryId,
            decidedById: actor.userId,
            decidedAt: new Date(),
            decisionNote: note?.trim() || null,
          },
        });
        await this.audit.write(
          {
            transactionId: ret.id,
            module: 'procurement',
            entityType: 'SupplierReturn',
            entityId: ret.id,
            status: SupplierReturnStatus.POSTED,
            action: AuditAction.APPROVE,
            userId: actor.userId,
            comments: `${ret.returnNumber} posted: stock ${stockValue} kobo out, debit note ${debitNote} kobo.`,
          },
          tx,
        );
        return { id: ret.id, status: SupplierReturnStatus.POSTED, journalEntryId: result.journalEntryId, stockValueKobo: stockValue.toString(), debitNoteKobo: debitNote.toString() };
      },
      { timeout: 20000 },
    );
  }

  /** Quantities on returns still awaiting approval, per receipt line. */
  private async pendingByLine(grnLineIds: string[]) {
    const rows = await this.prisma.supplierReturnLine.findMany({
      where: { grnLineId: { in: grnLineIds }, supplierReturn: { status: SupplierReturnStatus.PENDING } },
      select: { grnLineId: true, quantity: true },
    });
    const map = new Map<string, Decimal>();
    for (const r of rows) map.set(r.grnLineId, (map.get(r.grnLineId) ?? new Decimal(0)).plus(r.quantity.toString()));
    return map;
  }
}
