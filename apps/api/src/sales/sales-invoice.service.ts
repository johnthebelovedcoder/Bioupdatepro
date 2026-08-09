import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  CogsRecognitionPoint,
  Prisma,
  SalesInvoiceStatus,
  VatDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { TaxEngineService } from '../tax/tax-engine.service';
import { TaxRegisterService } from '../tax/tax-register.service';
import { SalesPricingService } from './sales-pricing.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

/**
 * Sales Invoice (§6).
 *
 * Posts `Dr Trade Receivable / Cr Revenue / Cr Output VAT`, and — where the
 * company recognises cost of sales at invoice rather than delivery — also
 * `Dr Cost of Sales / Cr Inventory`, but only for delivery lines that have not
 * already had it recognised.
 *
 * The VAT register entry is written in the SAME transaction as the posting, so
 * the Phase 3 reconciliation between register and ledger continues to hold for
 * everything O2C produces.
 */
@Injectable()
export class SalesInvoiceService {
  private readonly logger = new Logger(SalesInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly pricing: SalesPricingService,
    private readonly tax: TaxEngineService,
    private readonly registers: TaxRegisterService,
  ) {}

  /**
   * Raise an invoice from what has actually been delivered on an order.
   *
   * Invoicing what was delivered rather than what was ordered is the point:
   * billing an undelivered line creates a receivable for goods the customer
   * does not have.
   */
  async createFromOrder(input: {
    salesOrderId: string;
    invoiceNumber: string;
    invoiceDate: Date;
    financialYearId: string;
    financialPeriodId: string;
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.salesOrder.findUniqueOrThrow({
      where: { id: input.salesOrderId },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, customer: true },
    });

    const invoiceable = order.lines
      .map((line) => ({
        line,
        quantity: new Decimal(line.deliveredQuantity.toString()).minus(
          new Decimal(line.invoicedQuantity.toString()),
        ),
      }))
      .filter((entry) => entry.quantity.greaterThan(0));

    if (invoiceable.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales invoice',
        `Order ${order.orderNumber} has nothing delivered and uninvoiced. An invoice for ` +
          `undelivered goods would create a receivable the customer does not owe yet.`,
        { orderNumber: order.orderNumber },
      );
    }

    const priced = await this.pricing.priceDocument({
      companyId: order.companyId,
      on: input.invoiceDate,
      lines: invoiceable.map((entry, index) => ({
        lineNumber: index + 1,
        itemId: entry.line.itemId,
        description: entry.line.description,
        quantity: entry.quantity,
        unitPriceKobo: entry.line.unitPriceKobo,
        taxCode: undefined,
      })),
    });

    const dueDate = await this.resolveDueDate(order.customerId, input.invoiceDate);

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.create({
        data: {
          companyId: order.companyId,
          invoiceNumber: input.invoiceNumber,
          customerId: order.customerId,
          salesOrderId: order.id,
          invoiceDate: input.invoiceDate,
          dueDate,
          currencyId: order.currencyId,
          exchangeRate: order.exchangeRate,
          branchId: order.branchId,
          farmId: order.farmId,
          departmentId: order.departmentId,
          costCentreId: order.costCentreId,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          netAmountKobo: priced.netAmountKobo,
          vatAmountKobo: priced.vatAmountKobo,
          grossAmountKobo: priced.grossAmountKobo,
          createdById: input.actor.userId,
          lines: {
            create: priced.lines.map((line, index) => ({
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              description: line.description,
              salesOrderLineId: invoiceable[index]!.line.id,
              quantity: new Prisma.Decimal(line.quantity),
              unitPriceKobo: line.unitPriceKobo,
              discountKobo: line.discountKobo,
              taxCodeId: line.taxCodeId,
              netAmountKobo: line.netAmountKobo,
              vatAmountKobo: line.vatAmountKobo,
              batchReference: invoiceable[index]!.line.batchReference,
            })),
          },
        },
        include: { lines: true },
      });

      await this.audit.write(
        {
          transactionId: invoice.id,
          module: 'sales',
          entityType: 'SalesInvoice',
          entityId: invoice.id,
          status: invoice.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments: `Raised invoice ${invoice.invoiceNumber} against ${order.orderNumber}.`,
        },
        tx,
      );

      return invoice;
    });
  }

  async submit(params: { invoiceId: string; actor: WorkflowActor }) {
    const invoice = await this.prisma.salesInvoice.findUniqueOrThrow({
      where: { id: params.invoiceId },
    });

    if (invoice.status !== SalesInvoiceStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales invoice',
        `${invoice.invoiceNumber} is ${invoice.status} and cannot be submitted.`,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    const result = await this.workflow.submit({
      companyId: invoice.companyId,
      transactionType: 'SALES_INVOICE',
      module: 'sales',
      documentType: 'SalesInvoice',
      documentId: invoice.id,
      documentReference: invoice.invoiceNumber,
      amount: kobo(invoice.grossAmountKobo),
      currencyId: invoice.currencyId,
      branchId: invoice.branchId,
      farmId: invoice.farmId,
      departmentId: invoice.departmentId,
      costCentreId: invoice.costCentreId,
      actor: params.actor,
    });

    await this.prisma.salesInvoice.update({
      where: { id: invoice.id },
      data: {
        status: SalesInvoiceStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  async postApproved(params: {
    invoiceId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const invoice = await params.tx.salesInvoice.findUniqueOrThrow({
      where: { id: params.invoiceId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' }, include: { taxCode: true } },
        customer: true,
      },
    });

    if (invoice.status === SalesInvoiceStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${invoice.invoiceNumber} is already posted.`,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    const config = await this.pricing.configuration(
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
      customerId: invoice.customerId,
    };

    const lines: Array<{
      glAccountId: string;
      description: string;
      debit?: bigint;
      credit?: bigint;
      itemId?: string | null;
    }> = [
      {
        glAccountId: config.receivableGlAccountId,
        description: `Receivable — ${invoice.invoiceNumber}`,
        debit: invoice.grossAmountKobo,
      },
    ];

    // Revenue per line so item-level analysis remains possible afterwards.
    for (const line of invoice.lines) {
      lines.push({
        glAccountId: config.revenueGlAccountId,
        description: line.description,
        credit: line.netAmountKobo,
        itemId: line.itemId,
      });
    }

    if (invoice.vatAmountKobo > 0n) {
      const outputAccount = await this.tax.glAccountFor(
        invoice.companyId,
        invoice.lines.find((l) => l.vatAmountKobo > 0n)!.taxCodeId!,
        VatDirection.OUTPUT,
        invoice.invoiceDate,
        params.tx,
      );
      lines.push({
        glAccountId: outputAccount,
        description: `Output VAT — ${invoice.invoiceNumber}`,
        credit: invoice.vatAmountKobo,
      });
    }

    // --- Cost of sales, only if not already recognised at delivery ---------
    const costLines = await this.resolveUnrecognisedCost(invoice.id, params.tx);
    if (
      config.cogsRecognitionPoint === CogsRecognitionPoint.INVOICE &&
      costLines.totalKobo > 0n
    ) {
      lines.push({
        glAccountId: config.costOfSalesGlAccountId,
        description: `Cost of sales — ${invoice.invoiceNumber}`,
        debit: costLines.totalKobo,
      });
      lines.push({
        glAccountId: config.inventoryGlAccountId,
        description: `Inventory relieved — ${invoice.invoiceNumber}`,
        credit: costLines.totalKobo,
      });
    }

    const result = await this.posting.post(
      {
        sourceModule: 'sales',
        sourceDocumentType: 'SalesInvoice',
        sourceDocumentId: invoice.id,
        journalNumber: invoice.invoiceNumber,
        journalDate: invoice.invoiceDate,
        narration: `Sales invoice ${invoice.invoiceNumber} — ${invoice.customer.name}`,
        ...dimensions,
        idempotencyKey: `sales-invoice:${invoice.id}`,
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

    // Stamp the delivery lines whose cost was recognised here, so nothing can
    // recognise it a second time.
    if (config.cogsRecognitionPoint === CogsRecognitionPoint.INVOICE) {
      for (const deliveryLineId of costLines.deliveryLineIds) {
        await params.tx.deliveryNoteLine.update({
          where: { id: deliveryLineId },
          data: { cogsPostedAt: CogsRecognitionPoint.INVOICE },
        });
      }
    }

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
          direction: VatDirection.OUTPUT,
          calculation,
          sourceModule: 'sales',
          sourceDocumentType: 'SalesInvoice',
          sourceDocumentId: invoice.id,
          documentReference: invoice.invoiceNumber,
          documentDate: invoice.invoiceDate,
          counterpartyName: invoice.customer.name,
          counterpartyTin: invoice.customer.tin,
          journalEntryId: result.journalEntryId,
        },
        params.tx,
      );
    }

    // Advance invoiced quantities on the order lines.
    for (const line of invoice.lines) {
      if (!line.salesOrderLineId) continue;
      const orderLine = await params.tx.salesOrderLine.findUniqueOrThrow({
        where: { id: line.salesOrderLineId },
      });
      await params.tx.salesOrderLine.update({
        where: { id: line.salesOrderLineId },
        data: {
          invoicedQuantity: new Prisma.Decimal(
            new Decimal(orderLine.invoicedQuantity.toString())
              .plus(new Decimal(line.quantity.toString()))
              .toFixed(6),
          ),
        },
      });
    }

    await params.tx.salesInvoice.update({
      where: { id: invoice.id },
      data: {
        status: SalesInvoiceStatus.POSTED,
        journalEntryId: result.journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(`Posted invoice ${invoice.invoiceNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  /**
   * Cost attached to this invoice's deliveries that nobody has recognised yet.
   *
   * The `cogsPostedAt IS NULL` filter is the whole safeguard: a line whose cost
   * went to the ledger at delivery is simply not in this set, so §6's duplicate
   * instruction cannot produce a duplicate entry.
   */
  private async resolveUnrecognisedCost(
    invoiceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ totalKobo: bigint; deliveryLineIds: string[] }> {
    const invoiceLines = await tx.salesInvoiceLine.findMany({
      where: { invoiceId },
      select: { salesOrderLineId: true },
    });
    const orderLineIds = invoiceLines
      .map((l) => l.salesOrderLineId)
      .filter((id): id is string => id !== null);

    if (orderLineIds.length === 0) return { totalKobo: 0n, deliveryLineIds: [] };

    const deliveryLines = await tx.deliveryNoteLine.findMany({
      where: {
        salesOrderLineId: { in: orderLineIds },
        cogsPostedAt: null,
        deliveryNote: { status: 'POSTED' },
      },
      select: { id: true, costKobo: true },
    });

    return {
      totalKobo: deliveryLines.reduce((s, l) => s + l.costKobo, 0n),
      deliveryLineIds: deliveryLines.map((l) => l.id),
    };
  }

  private async resolveDueDate(customerId: string, invoiceDate: Date): Promise<Date> {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { paymentTerm: true },
    });

    const days = customer.paymentTerm?.netDays ?? 0;
    const due = new Date(invoiceDate);
    due.setUTCDate(due.getUTCDate() + days);
    return due;
  }

  /** Open invoices for a customer, for allocation and ageing. */
  async openInvoices(customerId: string) {
    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        customerId,
        status: {
          in: [SalesInvoiceStatus.POSTED, SalesInvoiceStatus.PART_PAID],
        },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    return invoices
      .map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        grossAmountKobo: invoice.grossAmountKobo.toString(),
        settledAmountKobo: invoice.settledAmountKobo.toString(),
        openAmountKobo: (invoice.grossAmountKobo - invoice.settledAmountKobo).toString(),
      }))
      .filter((invoice) => BigInt(invoice.openAmountKobo) > 0n);
  }
}
