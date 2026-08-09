import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  ItemType,
  MatchStatus,
  Prisma,
  SupplierInvoiceStatus,
  VatDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { TaxEngineService } from '../tax/tax-engine.service';
import { TaxRegisterService } from '../tax/tax-register.service';
import { ProcurementConfigService } from './procurement-config.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface SupplierInvoiceLineInput {
  /** Where the line comes from. A GRN reference is what lets it clear GRNI. */
  goodsReceiptNoteLineId?: string | null;
  purchaseOrderLineId?: string | null;
  itemId?: string | null;
  description?: string;
  quantity: Decimal.Value;
  unitPriceKobo: bigint;
  taxCode?: string | null;
  /** For a standalone line with no PO: which account bears the cost. */
  costGlAccountId?: string | null;
}

export interface MatchFinding {
  lineNumber: number;
  field: 'QUANTITY' | 'PRICE' | 'SUPPLIER' | 'CURRENCY' | 'ITEM';
  expected: string;
  actual: string;
  variancePercent: string;
  withinTolerance: boolean;
  message: string;
}

export interface ThreeWayMatchResult {
  status: MatchStatus;
  findings: MatchFinding[];
  comparedOn: string;
}

/**
 * Supplier Invoice and Three-Way Match (§5).
 *
 * THE POSTING, AND WHY IT IS NOT WHAT §5 LITERALLY SAYS:
 *
 *   §5 gives this as "Dr Inventory/Expense / Dr Input VAT Recoverable / Cr Trade
 *   Payables". For a line that already came through a GRN, debiting inventory
 *   here would recognise it a SECOND time — the receipt already did.
 *
 *   GRNI, which §5 itself names, is the resolution: a GRN-matched line debits
 *   GRNI to clear the holding balance, while an unmatched line debits inventory
 *   or expense directly. §5's "Inventory/Expense" is shorthand for "the cost
 *   side"; which account that is depends on whether the goods have already been
 *   recognised. Every line records which it did.
 */
@Injectable()
export class SupplierInvoiceService {
  private readonly logger = new Logger(SupplierInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly tax: TaxEngineService,
    private readonly registers: TaxRegisterService,
    private readonly config: ProcurementConfigService,
  ) {}

  async create(input: {
    companyId: string;
    invoiceNumber: string;
    supplierInvoiceNumber: string;
    supplierId: string;
    purchaseOrderId?: string | null;
    invoiceDate: Date;
    currencyId: string;
    exchangeRate?: string;
    branchId: string;
    farmId?: string | null;
    departmentId?: string | null;
    costCentreId?: string | null;
    financialYearId: string;
    financialPeriodId: string;
    whtTaxCode?: string | null;
    lines: SupplierInvoiceLineInput[];
    actor: WorkflowActor;
  }) {
    const supplier = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: input.supplierId },
      include: { paymentTerm: true, whtTaxCode: true },
    });

    if (supplier.status !== 'ACTIVE') {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier status',
        `Supplier ${supplier.code} is ${supplier.status} and cannot be invoiced.`,
        { supplierCode: supplier.code },
      );
    }

    // The supplier's own invoice number, unique per supplier: the single most
    // effective guard against paying the same bill twice. The database enforces
    // it too; this turns the constraint violation into a legible message.
    const duplicate = await this.prisma.supplierInvoice.findFirst({
      where: {
        companyId: input.companyId,
        supplierId: input.supplierId,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
      },
    });
    if (duplicate) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier invoice',
        `Supplier invoice "${input.supplierInvoiceNumber}" has already been entered for ` +
          `${supplier.code} as ${duplicate.invoiceNumber}. Entering it twice is how a ` +
          `supplier gets paid twice.`,
        { supplierInvoiceNumber: input.supplierInvoiceNumber },
      );
    }

    const settings = await this.config.resolve(input.companyId, input.invoiceDate);

    const prepared: Prisma.SupplierInvoiceLineCreateManyInvoiceInput[] = [];
    let net = 0n;
    let vat = 0n;
    let lineNumber = 1;

    for (const line of input.lines) {
      const resolved = await this.resolveLineSource(line, settings.grniGlAccountId);

      const quantity = new Decimal(line.quantity.toString());
      if (quantity.lessThanOrEqualTo(0)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Supplier invoice',
          `Line ${lineNumber} has a quantity of ${quantity.toString()}.`,
          { lineNumber },
        );
      }

      // A GRN-referenced line clears GRNI, and GRNI only holds what was
      // actually accepted. Billing for more would drive it negative and break
      // the identity this whole mechanism exists to keep.
      //
      // This is NOT the same as a three-way match exception. A price variance
      // can be approved and paid; a quantity that exceeds what arrived cannot
      // be cleared against goods that are not here. If the business genuinely
      // wants to pay ahead of delivery, that is a prepayment — a different
      // document against a different account, not a GRNI clearing.
      if (resolved.availableQuantity !== null) {
        const available = resolved.availableQuantity;
        if (quantity.greaterThan(available)) {
          throw new AccountingRuleViolation(
            'Consolidated Reference §5 — Supplier invoice',
            `Line ${lineNumber} invoices ${quantity.toFixed(6)} against a goods receipt with ` +
              `only ${available.toFixed(6)} accepted and uninvoiced. Goods that have not ` +
              `arrived cannot be cleared from Goods Received Not Invoiced; raise the ` +
              `difference as a prepayment, or invoice it when the goods land.`,
            {
              lineNumber,
              invoicedQuantity: quantity.toFixed(6),
              availableQuantity: available.toFixed(6),
            },
          );
        }
      }

      const lineNet = BigInt(
        new Decimal(line.unitPriceKobo.toString())
          .mul(quantity)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toFixed(0),
      );

      const taxCode = line.taxCode ?? resolved.defaultTaxCode;
      let lineVat = 0n;
      let taxCodeId: string | null = null;
      if (taxCode) {
        const calculation = await this.tax.calculateVat({
          companyId: input.companyId,
          taxCode,
          amount: lineNet as never,
          on: input.invoiceDate,
        });
        lineVat = calculation.taxKobo;
        taxCodeId = calculation.taxCodeId;
      }

      net += lineNet;
      vat += lineVat;

      prepared.push({
        lineNumber: lineNumber++,
        itemId: resolved.itemId,
        description: line.description ?? resolved.description,
        purchaseOrderLineId: resolved.purchaseOrderLineId,
        goodsReceiptNoteLineId: line.goodsReceiptNoteLineId ?? null,
        quantity: new Prisma.Decimal(quantity.toFixed(6)),
        unitPriceKobo: line.unitPriceKobo,
        taxCodeId,
        netAmountKobo: lineNet,
        vatAmountKobo: lineVat,
        costGlAccountId: line.costGlAccountId ?? resolved.costGlAccountId,
        clearsGrni: resolved.clearsGrni,
      });
    }

    const dueDate = new Date(input.invoiceDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + (supplier.paymentTerm?.netDays ?? 0));

    const whtTaxCodeId = input.whtTaxCode
      ? (
          await this.prisma.taxCode.findUniqueOrThrow({
            where: {
              companyId_code: { companyId: input.companyId, code: input.whtTaxCode },
            },
          })
        ).id
      : supplier.whtTaxCodeId;

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.supplierInvoice.create({
        data: {
          companyId: input.companyId,
          invoiceNumber: input.invoiceNumber,
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId ?? null,
          invoiceDate: input.invoiceDate,
          dueDate,
          currencyId: input.currencyId,
          exchangeRate: new Prisma.Decimal(input.exchangeRate ?? '1.00000000'),
          branchId: input.branchId,
          farmId: input.farmId ?? null,
          departmentId: input.departmentId ?? null,
          costCentreId: input.costCentreId ?? null,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          whtTaxCodeId,
          netAmountKobo: net,
          vatAmountKobo: vat,
          grossAmountKobo: net + vat,
          createdById: input.actor.userId,
          lines: { createMany: { data: prepared } },
        },
        include: { lines: true },
      });

      await this.audit.write(
        {
          transactionId: invoice.id,
          module: 'procurement',
          entityType: 'SupplierInvoice',
          entityId: invoice.id,
          status: invoice.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments:
            `Entered supplier invoice ${invoice.supplierInvoiceNumber} from ` +
            `${supplier.name} as ${invoice.invoiceNumber}.`,
        },
        tx,
      );

      return invoice;
    });
  }

  /**
   * §5 Three-Way Matching: compares PO / GRN / Invoice on supplier, item,
   * quantity, price, tax and currency.
   *
   * Reports EVERY discrepancy rather than stopping at the first, and returns a
   * status rather than throwing. §5 says exceptions require approval, not that
   * they are refused — a supplier who invoices 2% over is a conversation, not
   * an error.
   */
  async threeWayMatch(invoiceId: string): Promise<ThreeWayMatchResult> {
    const invoice = await this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            purchaseOrderLine: { include: { item: true } },
            goodsReceiptLine: true,
          },
        },
        purchaseOrder: true,
      },
    });

    if (!invoice.purchaseOrderId || !invoice.purchaseOrder) {
      return {
        status: MatchStatus.NOT_APPLICABLE,
        findings: [],
        comparedOn: new Date().toISOString(),
      };
    }

    const settings = await this.config.resolve(invoice.companyId, invoice.invoiceDate);
    const quantityTolerance = new Decimal(settings.quantityTolerancePercent.toString());
    const priceTolerance = new Decimal(settings.priceTolerancePercent.toString());

    const findings: MatchFinding[] = [];

    if (invoice.supplierId !== invoice.purchaseOrder.supplierId) {
      findings.push({
        lineNumber: 0,
        field: 'SUPPLIER',
        expected: invoice.purchaseOrder.supplierId,
        actual: invoice.supplierId,
        variancePercent: '0',
        withinTolerance: false,
        message: 'The invoice is from a different supplier than the purchase order.',
      });
    }

    if (invoice.currencyId !== invoice.purchaseOrder.currencyId) {
      findings.push({
        lineNumber: 0,
        field: 'CURRENCY',
        expected: invoice.purchaseOrder.currencyId,
        actual: invoice.currencyId,
        variancePercent: '0',
        withinTolerance: false,
        message: 'The invoice currency differs from the purchase order currency.',
      });
    }

    for (const line of invoice.lines) {
      const orderLine = line.purchaseOrderLine;
      if (!orderLine) continue;

      // --- Price -----------------------------------------------------------
      const orderedPrice = new Decimal(orderLine.unitPriceKobo.toString());
      const invoicedPrice = new Decimal(line.unitPriceKobo.toString());
      if (!invoicedPrice.equals(orderedPrice)) {
        const variance = orderedPrice.isZero()
          ? new Decimal(100)
          : invoicedPrice.minus(orderedPrice).div(orderedPrice).mul(100).abs();
        const within = variance.lessThanOrEqualTo(priceTolerance);
        findings.push({
          lineNumber: line.lineNumber,
          field: 'PRICE',
          expected: orderLine.unitPriceKobo.toString(),
          actual: line.unitPriceKobo.toString(),
          variancePercent: variance.toFixed(4),
          withinTolerance: within,
          message:
            `Line ${line.lineNumber}: invoiced at ${line.unitPriceKobo} kobo against an ` +
            `ordered price of ${orderLine.unitPriceKobo} kobo (${variance.toFixed(2)}% variance).`,
        });
      }

      // --- Quantity: invoice against what was RECEIVED, not ordered --------
      // Billing for goods that never arrived is the failure this catches, and
      // the ordered quantity cannot catch it.
      const receivedQuantity = line.goodsReceiptLine
        ? new Decimal(line.goodsReceiptLine.acceptedQuantity.toString())
        : new Decimal(orderLine.receivedQuantity.toString());
      const invoicedQuantity = new Decimal(line.quantity.toString());

      if (!invoicedQuantity.equals(receivedQuantity)) {
        const variance = receivedQuantity.isZero()
          ? new Decimal(100)
          : invoicedQuantity.minus(receivedQuantity).div(receivedQuantity).mul(100).abs();
        const within = variance.lessThanOrEqualTo(quantityTolerance);
        findings.push({
          lineNumber: line.lineNumber,
          field: 'QUANTITY',
          expected: receivedQuantity.toFixed(6),
          actual: invoicedQuantity.toFixed(6),
          variancePercent: variance.toFixed(4),
          withinTolerance: within,
          message:
            `Line ${line.lineNumber}: invoiced ${invoicedQuantity.toFixed(6)} against ` +
            `${receivedQuantity.toFixed(6)} received (${variance.toFixed(2)}% variance).`,
        });
      }

      // --- Item ------------------------------------------------------------
      if (line.itemId !== orderLine.itemId) {
        findings.push({
          lineNumber: line.lineNumber,
          field: 'ITEM',
          expected: orderLine.item.code,
          actual: line.itemId,
          variancePercent: '0',
          withinTolerance: false,
          message: `Line ${line.lineNumber} invoices a different item than was ordered.`,
        });
      }
    }

    const status = findings.every((f) => f.withinTolerance)
      ? MatchStatus.MATCHED
      : MatchStatus.EXCEPTION;

    return { status, findings, comparedOn: new Date().toISOString() };
  }

  /**
   * Submit for approval, running the three-way match first.
   *
   * A clean match takes the standard route; an exception takes the tighter one,
   * exactly as the failing credit check does in §6. The match result is stored
   * so an approver — and later an auditor — sees what was compared.
   */
  async submit(params: { invoiceId: string; actor: WorkflowActor }) {
    const invoice = await this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: params.invoiceId },
    });

    if (invoice.status !== SupplierInvoiceStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier invoice',
        `${invoice.invoiceNumber} is ${invoice.status} and cannot be submitted.`,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    const match = await this.threeWayMatch(invoice.id);
    const settings = await this.config.resolve(invoice.companyId, invoice.invoiceDate);

    const transactionType =
      match.status === MatchStatus.EXCEPTION
        ? settings.matchExceptionTransactionType
        : settings.invoiceTransactionType;

    const result = await this.workflow.submit({
      companyId: invoice.companyId,
      transactionType,
      module: 'procurement',
      documentType: 'SupplierInvoice',
      documentId: invoice.id,
      documentReference: invoice.invoiceNumber,
      amount: kobo(invoice.grossAmountKobo),
      currencyId: invoice.currencyId,
      branchId: invoice.branchId,
      farmId: invoice.farmId,
      departmentId: invoice.departmentId,
      costCentreId: invoice.costCentreId,
      actor: params.actor,
      comments:
        match.status === MatchStatus.EXCEPTION
          ? `Three-way match exceptions: ${match.findings
              .filter((f) => !f.withinTolerance)
              .map((f) => f.message)
              .join(' ')}`
          : null,
    });

    await this.prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        status: SupplierInvoiceStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
        matchStatus: match.status,
        matchResult: match as unknown as Prisma.InputJsonValue,
      },
    });

    return { ...result, match, routedAs: transactionType };
  }

  async postApproved(params: {
    invoiceId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const invoice = await params.tx.supplierInvoice.findUniqueOrThrow({
      where: { id: params.invoiceId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' }, include: { taxCode: true } },
        supplier: true,
      },
    });

    if (invoice.status === SupplierInvoiceStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${invoice.invoiceNumber} is already posted.`,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    const settings = await this.config.resolve(
      invoice.companyId,
      invoice.invoiceDate,
      params.tx,
    );

    const dimensions = {
      companyId: invoice.companyId,
      branchId: invoice.branchId,
      financialYearId: invoice.financialYearId,
      financialPeriodId: invoice.financialPeriodId,
      currencyId: invoice.currencyId,
      exchangeRate: invoice.exchangeRate.toString(),
    };
    const lineDimensions = {
      ...dimensions,
      farmId: invoice.farmId,
      departmentId: invoice.departmentId,
      costCentreId: invoice.costCentreId,
      supplierId: invoice.supplierId,
    };

    const lines: Array<{
      glAccountId: string;
      description: string;
      debit?: bigint;
      credit?: bigint;
      itemId?: string | null;
    }> = [];

    // The cost side: GRNI for matched lines, inventory or expense otherwise.
    for (const line of invoice.lines) {
      lines.push({
        glAccountId: line.costGlAccountId,
        description: line.clearsGrni
          ? `Clear GRNI — ${line.description}`
          : line.description,
        debit: line.netAmountKobo,
        itemId: line.itemId,
      });
    }

    if (invoice.vatAmountKobo > 0n) {
      const inputAccount = await this.tax.glAccountFor(
        invoice.companyId,
        invoice.lines.find((l) => l.vatAmountKobo > 0n)!.taxCodeId!,
        VatDirection.INPUT,
        invoice.invoiceDate,
        params.tx,
      );
      lines.push({
        glAccountId: inputAccount,
        description: `Input VAT recoverable — ${invoice.invoiceNumber}`,
        debit: invoice.vatAmountKobo,
      });
    }

    lines.push({
      glAccountId: settings.payablesGlAccountId,
      description: `Trade payable — ${invoice.supplier.name}`,
      credit: invoice.grossAmountKobo,
    });

    const result = await this.posting.post(
      {
        sourceModule: 'procurement',
        sourceDocumentType: 'SupplierInvoice',
        sourceDocumentId: invoice.id,
        journalNumber: invoice.invoiceNumber,
        journalDate: invoice.invoiceDate,
        narration:
          `Supplier invoice ${invoice.supplierInvoiceNumber} — ${invoice.supplier.name}`,
        ...dimensions,
        idempotencyKey: `supplier-invoice:${invoice.id}`,
        actor: params.actor,
        lines: lines.map((line) => ({
          glAccountId: line.glAccountId,
          description: line.description,
          debit: line.debit !== undefined ? kobo(line.debit) : undefined,
          credit: line.credit !== undefined ? kobo(line.credit) : undefined,
          dimensions: { ...lineDimensions, itemId: line.itemId ?? null },
        })),
      },
      params.tx,
    );

    // --- VAT register, same transaction as the posting (§4) ----------------
    for (const line of invoice.lines) {
      if (!line.taxCodeId) continue;
      const calculation = await this.tax.calculateVat(
        {
          companyId: invoice.companyId,
          taxCode: line.taxCode!.code,
          amount: line.netAmountKobo as never,
          on: invoice.invoiceDate,
        },
        params.tx,
      );
      await this.registers.recordVat(
        {
          companyId: invoice.companyId,
          branchId: invoice.branchId,
          direction: VatDirection.INPUT,
          calculation,
          sourceModule: 'procurement',
          sourceDocumentType: 'SupplierInvoice',
          sourceDocumentId: invoice.id,
          documentReference: invoice.invoiceNumber,
          documentDate: invoice.invoiceDate,
          counterpartyName: invoice.supplier.name,
          counterpartyTin: invoice.supplier.tin,
          journalEntryId: result.journalEntryId,
        },
        params.tx,
      );
    }

    // --- Draw down the GRNI and the order ---------------------------------
    for (const line of invoice.lines) {
      if (line.goodsReceiptNoteLineId) {
        const grnLine = await params.tx.goodsReceiptNoteLine.findUniqueOrThrow({
          where: { id: line.goodsReceiptNoteLineId },
        });
        await params.tx.goodsReceiptNoteLine.update({
          where: { id: line.goodsReceiptNoteLineId },
          data: {
            invoicedQuantity: new Prisma.Decimal(
              new Decimal(grnLine.invoicedQuantity.toString())
                .plus(new Decimal(line.quantity.toString()))
                .toFixed(6),
            ),
          },
        });
      }

      if (line.purchaseOrderLineId) {
        const orderLine = await params.tx.purchaseOrderLine.findUniqueOrThrow({
          where: { id: line.purchaseOrderLineId },
        });
        await params.tx.purchaseOrderLine.update({
          where: { id: line.purchaseOrderLineId },
          data: {
            invoicedQuantity: new Prisma.Decimal(
              new Decimal(orderLine.invoicedQuantity.toString())
                .plus(new Decimal(line.quantity.toString()))
                .toFixed(6),
            ),
          },
        });
      }
    }

    await params.tx.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        status: SupplierInvoiceStatus.POSTED,
        journalEntryId: result.journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(`Posted supplier invoice ${invoice.invoiceNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  /** Open invoices for a supplier, for payment allocation. */
  async openInvoices(supplierId: string) {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        supplierId,
        status: {
          in: [SupplierInvoiceStatus.POSTED, SupplierInvoiceStatus.PART_PAID],
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    return invoices
      .map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        supplierInvoiceNumber: invoice.supplierInvoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        grossAmountKobo: invoice.grossAmountKobo.toString(),
        settledAmountKobo: invoice.settledAmountKobo.toString(),
        openAmountKobo: (invoice.grossAmountKobo - invoice.settledAmountKobo).toString(),
        whtTaxCodeId: invoice.whtTaxCodeId,
      }))
      .filter((invoice) => BigInt(invoice.openAmountKobo) > 0n);
  }

  /**
   * Work out where a line comes from and therefore which account bears its
   * cost. A GRN-referenced line clears GRNI; anything else debits inventory or
   * expense directly.
   */
  private async resolveLineSource(
    line: SupplierInvoiceLineInput,
    grniGlAccountId: string,
  ): Promise<{
    itemId: string;
    description: string;
    purchaseOrderLineId: string | null;
    costGlAccountId: string;
    clearsGrni: boolean;
    defaultTaxCode: string | null;
    /** Accepted less already-invoiced, for a GRN line. Null when not applicable. */
    availableQuantity: Decimal | null;
  }> {
    if (line.goodsReceiptNoteLineId) {
      const grnLine = await this.prisma.goodsReceiptNoteLine.findUniqueOrThrow({
        where: { id: line.goodsReceiptNoteLineId },
        include: {
          item: { include: { vatTaxCode: { select: { code: true } } } },
          purchaseOrderLine: true,
        },
      });

      // An expense item never entered GRNI at receipt (§5: expense items await
      // the invoice), so its cost lands on the expense account here.
      const clearsGrni = grnLine.item.itemType === ItemType.INVENTORY;

      return {
        itemId: grnLine.itemId,
        description: grnLine.item.description,
        purchaseOrderLineId: grnLine.purchaseOrderLineId,
        costGlAccountId: clearsGrni
          ? grniGlAccountId
          : (grnLine.item.expenseGlAccountId ?? grniGlAccountId),
        clearsGrni,
        defaultTaxCode: grnLine.item.vatTaxCode?.code ?? null,
        availableQuantity: new Decimal(grnLine.acceptedQuantity.toString()).minus(
          new Decimal(grnLine.invoicedQuantity.toString()),
        ),
      };
    }

    if (line.purchaseOrderLineId) {
      const orderLine = await this.prisma.purchaseOrderLine.findUniqueOrThrow({
        where: { id: line.purchaseOrderLineId },
        include: { item: { include: { vatTaxCode: { select: { code: true } } } } },
      });

      const account =
        orderLine.item.itemType === ItemType.INVENTORY
          ? orderLine.item.inventoryGlAccountId
          : orderLine.item.expenseGlAccountId;

      if (!account) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Item master',
          `Item "${orderLine.item.code}" has no default account for its type, so the ` +
            `invoice line has nowhere to post.`,
          { itemCode: orderLine.item.code },
        );
      }

      return {
        itemId: orderLine.itemId,
        description: orderLine.description,
        purchaseOrderLineId: orderLine.id,
        costGlAccountId: account,
        // Nothing was received, so there is no GRNI to clear.
        clearsGrni: false,
        defaultTaxCode: orderLine.item.vatTaxCode?.code ?? null,
        availableQuantity: null,
      };
    }

    // §5 permits a standalone invoice from an authorised user.
    if (!line.itemId || !line.costGlAccountId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier invoice',
        `A standalone invoice line must name both an item and the account bearing its ` +
          `cost. Without a purchase order there is nothing to infer them from.`,
        {},
      );
    }

    const item = await this.prisma.item.findUniqueOrThrow({
      where: { id: line.itemId },
      include: { vatTaxCode: { select: { code: true } } },
    });

    return {
      itemId: item.id,
      description: item.description,
      purchaseOrderLineId: null,
      costGlAccountId: line.costGlAccountId,
      clearsGrni: false,
      defaultTaxCode: item.vatTaxCode?.code ?? null,
      availableQuantity: null,
    };
  }
}
