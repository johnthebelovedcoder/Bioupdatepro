import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  ReceiptMethod,
  ReceiptStatus,
  SalesInvoiceStatus,
  WhtDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { TaxRegisterService } from '../tax/tax-register.service';
import { SalesPricingService } from './sales-pricing.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface ReceiptAllocationInput {
  invoiceId: string;
  /** MONEY. How much of this receipt settles this invoice. */
  amountKobo: bigint;
}

/**
 * Customer Receipt (§6).
 *
 * Posts `Dr Bank / Dr WHT Receivable / Cr Trade Receivable`.
 *
 * ON WITHHOLDING TAX: the amount withheld is RECORDED, not computed. In
 * practice the customer withholds, tells you what they took, and hands you a
 * credit note as evidence — and it is that evidence, not our calculation, that
 * lets the amount be claimed. Recording what actually happened is both more
 * accurate and the only thing possible while WHT rates remain unconfigured
 * (see the Phase 3 note). Where a rate IS configured the engine can verify the
 * figure, but the customer's certificate remains the source of truth.
 */
@Injectable()
export class CustomerReceiptService {
  private readonly logger = new Logger(CustomerReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly pricing: SalesPricingService,
    private readonly registers: TaxRegisterService,
  ) {}

  async create(input: {
    companyId: string;
    receiptNumber: string;
    customerId: string;
    receiptDate: Date;
    method: ReceiptMethod;
    bankGlAccountId: string;
    reference?: string | null;
    branchId: string;
    currencyId: string;
    financialYearId: string;
    financialPeriodId: string;
    /** MONEY. Cash actually banked. */
    amountKobo: bigint;
    /** MONEY. What the customer withheld, per their certificate. */
    whtAmountKobo?: bigint;
    whtCreditNoteReference?: string | null;
    whtCreditNoteDate?: Date | null;
    whtTaxCode?: string | null;
    allocations: ReceiptAllocationInput[];
    actor: WorkflowActor;
  }) {
    const wht = input.whtAmountKobo ?? 0n;

    if (wht > 0n && !input.whtCreditNoteReference) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Customer receipt',
        `A withheld amount of ${wht} kobo has been recorded with no WHT credit note ` +
          `reference. Without the customer's certificate the withholding cannot be ` +
          `claimed, so recording it as receivable would overstate the asset.`,
        { receiptNumber: input.receiptNumber },
      );
    }

    const settled = input.amountKobo + wht;
    const allocatedTotal = input.allocations.reduce((s, a) => s + a.amountKobo, 0n);

    if (allocatedTotal !== settled) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Customer receipt',
        `Allocations total ${allocatedTotal} kobo but the receipt settles ${settled} kobo ` +
          `(${input.amountKobo} banked plus ${wht} withheld). Every kobo of a receipt must ` +
          `be allocated to an invoice, or the receivable will not clear.`,
        { receiptNumber: input.receiptNumber },
      );
    }

    // Validate each allocation against the invoice's open balance.
    let whtTaxCodeId: string | null = null;
    if (input.whtTaxCode) {
      const taxCode = await this.prisma.taxCode.findUnique({
        where: {
          companyId_code: { companyId: input.companyId, code: input.whtTaxCode },
        },
      });
      if (!taxCode || taxCode.taxType !== 'WHT') {
        throw new AccountingRuleViolation(
          'Consolidated Reference §4 — Tax Engine',
          `"${input.whtTaxCode}" is not a configured WHT code.`,
          { taxCode: input.whtTaxCode },
        );
      }
      whtTaxCodeId = taxCode.id;
    }

    for (const allocation of input.allocations) {
      const invoice = await this.prisma.salesInvoice.findUniqueOrThrow({
        where: { id: allocation.invoiceId },
      });

      if (invoice.customerId !== input.customerId) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Customer receipt',
          `Invoice ${invoice.invoiceNumber} belongs to a different customer.`,
          { invoiceNumber: invoice.invoiceNumber },
        );
      }
      const postedStatuses: SalesInvoiceStatus[] = [
        SalesInvoiceStatus.POSTED,
        SalesInvoiceStatus.PART_PAID,
      ];
      if (!postedStatuses.includes(invoice.status)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Customer receipt',
          `Invoice ${invoice.invoiceNumber} is ${invoice.status}; only a posted, ` +
            `unsettled invoice can receive a payment.`,
          { invoiceNumber: invoice.invoiceNumber, status: invoice.status },
        );
      }

      const open = invoice.grossAmountKobo - invoice.settledAmountKobo;
      if (allocation.amountKobo > open) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Customer receipt',
          `Cannot allocate ${allocation.amountKobo} kobo to invoice ` +
            `${invoice.invoiceNumber}: only ${open} kobo is outstanding. Over-allocation ` +
            `would create a credit balance disguised as a settled invoice.`,
          { invoiceNumber: invoice.invoiceNumber, openKobo: open.toString() },
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.customerReceipt.create({
        data: {
          companyId: input.companyId,
          receiptNumber: input.receiptNumber,
          customerId: input.customerId,
          receiptDate: input.receiptDate,
          method: input.method,
          bankGlAccountId: input.bankGlAccountId,
          reference: input.reference ?? null,
          branchId: input.branchId,
          currencyId: input.currencyId,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          amountKobo: input.amountKobo,
          whtAmountKobo: wht,
          whtCreditNoteReference: input.whtCreditNoteReference ?? null,
          whtCreditNoteDate: input.whtCreditNoteDate ?? null,
          whtTaxCodeId,
          createdById: input.actor.userId,
          allocations: {
            create: input.allocations.map((allocation) => ({
              invoiceId: allocation.invoiceId,
              amountKobo: allocation.amountKobo,
            })),
          },
        },
        include: { allocations: true },
      });

      await this.audit.write(
        {
          transactionId: receipt.id,
          module: 'sales',
          entityType: 'CustomerReceipt',
          entityId: receipt.id,
          status: receipt.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments: `Recorded receipt ${receipt.receiptNumber}.`,
        },
        tx,
      );

      return receipt;
    });
  }

  async submit(params: { receiptId: string; actor: WorkflowActor }) {
    const receipt = await this.prisma.customerReceipt.findUniqueOrThrow({
      where: { id: params.receiptId },
    });

    if (receipt.status !== ReceiptStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Customer receipt',
        `${receipt.receiptNumber} is ${receipt.status} and cannot be submitted.`,
        { receiptNumber: receipt.receiptNumber },
      );
    }

    const result = await this.workflow.submit({
      companyId: receipt.companyId,
      transactionType: 'CUSTOMER_RECEIPT',
      module: 'sales',
      documentType: 'CustomerReceipt',
      documentId: receipt.id,
      documentReference: receipt.receiptNumber,
      amount: kobo(receipt.amountKobo + receipt.whtAmountKobo),
      currencyId: receipt.currencyId,
      branchId: receipt.branchId,
      actor: params.actor,
    });

    await this.prisma.customerReceipt.update({
      where: { id: receipt.id },
      data: {
        status: ReceiptStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  async postApproved(params: {
    receiptId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const receipt = await params.tx.customerReceipt.findUniqueOrThrow({
      where: { id: params.receiptId },
      include: {
        allocations: { include: { invoice: true } },
        customer: true,
        whtTaxCode: true,
      },
    });

    if (receipt.status === ReceiptStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${receipt.receiptNumber} is already posted.`,
        { receiptNumber: receipt.receiptNumber },
      );
    }

    const config = await this.pricing.configuration(
      receipt.companyId,
      receipt.receiptDate,
      params.tx,
    );

    if (receipt.whtAmountKobo > 0n && !config.whtReceivableGlAccountId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Customer receipt',
        `Receipt ${receipt.receiptNumber} records withholding tax but no WHT receivable ` +
          `account is configured. The withheld amount would otherwise vanish from the ` +
          `books entirely.`,
        { receiptNumber: receipt.receiptNumber },
      );
    }

    const dimensions = {
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      financialYearId: receipt.financialYearId,
      financialPeriodId: receipt.financialPeriodId,
      currencyId: receipt.currencyId,
      exchangeRate: '1.00000000',
    };
    const lineDimensions = { ...dimensions, customerId: receipt.customerId };

    const settled = receipt.amountKobo + receipt.whtAmountKobo;

    const lines = [
      {
        glAccountId: receipt.bankGlAccountId,
        description: `Receipt ${receipt.receiptNumber} — ${receipt.customer.name}`,
        debit: receipt.amountKobo,
      },
      ...(receipt.whtAmountKobo > 0n
        ? [
            {
              glAccountId: config.whtReceivableGlAccountId!,
              description: `WHT withheld — ${receipt.whtCreditNoteReference}`,
              debit: receipt.whtAmountKobo,
            },
          ]
        : []),
      {
        glAccountId: config.receivableGlAccountId,
        description: `Receivable settled — ${receipt.receiptNumber}`,
        credit: settled,
      },
    ];

    const result = await this.posting.post(
      {
        sourceModule: 'sales',
        sourceDocumentType: 'CustomerReceipt',
        sourceDocumentId: receipt.id,
        journalNumber: receipt.receiptNumber,
        journalDate: receipt.receiptDate,
        narration: `Customer receipt ${receipt.receiptNumber} — ${receipt.customer.name}`,
        ...dimensions,
        idempotencyKey: `customer-receipt:${receipt.id}`,
        actor: params.actor,
        lines: lines.map((line) => ({
          glAccountId: line.glAccountId,
          description: line.description,
          debit: line.debit !== undefined ? kobo(line.debit) : undefined,
          credit: line.credit !== undefined ? kobo(line.credit) : undefined,
          dimensions: lineDimensions,
        })),
      },
      params.tx,
    );

    // --- WHT register (§4) --------------------------------------------------
    if (receipt.whtAmountKobo > 0n && receipt.whtTaxCode) {
      await this.registers.recordWht(
        {
          companyId: receipt.companyId,
          branchId: receipt.branchId,
          direction: WhtDirection.RECEIVABLE,
          calculation: {
            taxCodeId: receipt.whtTaxCodeId!,
            taxCode: receipt.whtTaxCode.code,
            whtCategory: receipt.whtTaxCode.whtCategory ?? receipt.whtTaxCode.code,
            // The rate the customer actually applied, derived from what they
            // withheld rather than from our configuration.
            appliedRate: settled > 0n
              ? (Number(receipt.whtAmountKobo) / Number(settled)).toFixed(8)
              : '0.00000000',
            taxableBaseKobo: settled,
            taxKobo: receipt.whtAmountKobo,
            netPayableKobo: receipt.amountKobo,
            explanation:
              `Recorded from the customer's WHT credit note ` +
              `${receipt.whtCreditNoteReference}.`,
          },
          grossAmountKobo: settled,
          sourceModule: 'sales',
          sourceDocumentType: 'CustomerReceipt',
          sourceDocumentId: receipt.id,
          documentReference: receipt.receiptNumber,
          documentDate: receipt.receiptDate,
          counterpartyName: receipt.customer.name,
          counterpartyTin: receipt.customer.tin,
          creditNoteReference: receipt.whtCreditNoteReference,
          creditNoteDate: receipt.whtCreditNoteDate,
          journalEntryId: result.journalEntryId,
        },
        params.tx,
      );
    }

    // --- Settle the invoices ------------------------------------------------
    for (const allocation of receipt.allocations) {
      const invoice = allocation.invoice;
      const newSettled = invoice.settledAmountKobo + allocation.amountKobo;
      const fullySettled = newSettled >= invoice.grossAmountKobo;

      await params.tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          settledAmountKobo: newSettled,
          status: fullySettled
            ? SalesInvoiceStatus.PAID
            : SalesInvoiceStatus.PART_PAID,
        },
      });
    }

    await params.tx.customerReceipt.update({
      where: { id: receipt.id },
      data: {
        status: ReceiptStatus.POSTED,
        journalEntryId: result.journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(`Posted receipt ${receipt.receiptNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  /**
   * §6 Customer Ageing, as a true open-item report.
   *
   * Ages each invoice's OUTSTANDING balance by its own date. This is the report
   * Phase 10 could not produce — a net-movement ageing puts a receipt in the
   * bucket it falls in rather than the bucket of the invoice it settled.
   */
  async ageing(params: {
    companyId: string;
    asAt: Date;
    buckets?: number[];
  }) {
    const edges = params.buckets ?? [0, 30, 60, 90];

    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        companyId: params.companyId,
        status: { in: [SalesInvoiceStatus.POSTED, SalesInvoiceStatus.PART_PAID] },
        invoiceDate: { lte: params.asAt },
      },
      include: { customer: { select: { code: true, name: true } } },
      orderBy: [{ customerId: 'asc' }, { invoiceDate: 'asc' }],
    });

    const byCustomer = new Map<
      string,
      {
        customerCode: string;
        customerName: string;
        totalKobo: bigint;
        buckets: bigint[];
        invoices: Array<{
          invoiceNumber: string;
          invoiceDate: Date;
          dueDate: Date | null;
          openKobo: string;
          ageDays: number;
        }>;
      }
    >();

    for (const invoice of invoices) {
      const open = invoice.grossAmountKobo - invoice.settledAmountKobo;
      if (open <= 0n) continue;

      // Aged from the DUE date where there is one: an invoice on 60-day terms
      // is not overdue on day 31, and ageing from the invoice date would say
      // it was.
      const from = invoice.dueDate ?? invoice.invoiceDate;
      const ageDays = Math.max(
        0,
        Math.floor((params.asAt.getTime() - from.getTime()) / 86_400_000),
      );

      let index = 0;
      for (let i = edges.length - 1; i >= 0; i -= 1) {
        if (ageDays >= edges[i]!) {
          index = i;
          break;
        }
      }

      const entry = byCustomer.get(invoice.customerId) ?? {
        customerCode: invoice.customer.code,
        customerName: invoice.customer.name,
        totalKobo: 0n,
        buckets: edges.map(() => 0n),
        invoices: [],
      };

      entry.totalKobo += open;
      entry.buckets[index] = (entry.buckets[index] ?? 0n) + open;
      entry.invoices.push({
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        openKobo: open.toString(),
        ageDays,
      });

      byCustomer.set(invoice.customerId, entry);
    }

    return [...byCustomer.values()].map((entry) => ({
      customerCode: entry.customerCode,
      customerName: entry.customerName,
      totalKobo: entry.totalKobo.toString(),
      buckets: edges.map((edge, index) => ({
        label:
          index === edges.length - 1
            ? `${edge}+ days`
            : `${edge}-${edges[index + 1]! - 1} days`,
        amountKobo: (entry.buckets[index] ?? 0n).toString(),
      })),
      invoices: entry.invoices,
    }));
  }
}
