import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SupplierInvoiceStatus,
  WhtDirection,
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

export interface PaymentAllocationInput {
  invoiceId: string;
  /** MONEY. How much of the payables balance this settles. */
  amountKobo: bigint;
}

/**
 * Supplier Payment (§5).
 *
 * Posts `Dr Trade Payables / Cr Bank / Cr WHT Payable`.
 *
 * ON WITHHOLDING TAX — the mirror of the §6 receipt, and the same reasoning
 * inverted. Here WE are the one withholding, so we must know the rate: it is a
 * deduction we make and remit, not one a counterparty reports to us. The tax
 * engine is therefore asked to compute it whenever a WHT code is supplied, and
 * it REFUSES when no rate is configured (see the Phase 3 note).
 *
 * That refusal is correct rather than inconvenient. Under-withholding is a
 * liability to the revenue authority that surfaces at audit, so a payment that
 * should carry withholding will not post until somebody supplies the statutory
 * rate. Payments with no WHT category are unaffected.
 */
@Injectable()
export class SupplierPaymentService {
  private readonly logger = new Logger(SupplierPaymentService.name);

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
    paymentNumber: string;
    supplierId: string;
    paymentDate: Date;
    method: PaymentMethod;
    bankGlAccountId: string;
    reference?: string | null;
    narration?: string | null;
    branchId: string;
    currencyId: string;
    financialYearId: string;
    financialPeriodId: string;
    /** MONEY. An early-settlement discount taken, if any. */
    discountKobo?: bigint;
    /** The WHT category to withhold under. Omit for no withholding. */
    whtTaxCode?: string | null;
    allocations: PaymentAllocationInput[];
    actor: WorkflowActor;
  }) {
    const supplier = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: input.supplierId },
      include: { whtTaxCode: true },
    });

    if (supplier.status === 'BLOCKED') {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier status',
        `Supplier ${supplier.code} is BLOCKED` +
          `${supplier.statusReason ? `: ${supplier.statusReason}` : ''} and cannot be paid.`,
        { supplierCode: supplier.code },
      );
    }

    if (input.allocations.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier payment',
        `A payment must be allocated to at least one invoice. An unallocated payment ` +
          `leaves the payables balance unexplained.`,
        { paymentNumber: input.paymentNumber },
      );
    }

    // Validate each allocation against the invoice's open balance.
    let settledTotal = 0n;
    let taxableBase = 0n;
    let vatOnPaid = 0n;

    for (const allocation of input.allocations) {
      const invoice = await this.prisma.supplierInvoice.findUniqueOrThrow({
        where: { id: allocation.invoiceId },
      });

      if (invoice.supplierId !== input.supplierId) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Supplier payment',
          `Invoice ${invoice.invoiceNumber} belongs to a different supplier.`,
          { invoiceNumber: invoice.invoiceNumber },
        );
      }
      const payable: SupplierInvoiceStatus[] = [
        SupplierInvoiceStatus.POSTED,
        SupplierInvoiceStatus.PART_PAID,
      ];
      if (!payable.includes(invoice.status)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Supplier payment',
          `Invoice ${invoice.invoiceNumber} is ${invoice.status}; only a posted, ` +
            `unsettled invoice can be paid.`,
          { invoiceNumber: invoice.invoiceNumber, status: invoice.status },
        );
      }

      const open = invoice.grossAmountKobo - invoice.settledAmountKobo;
      if (allocation.amountKobo > open) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Supplier payment',
          `Cannot allocate ${allocation.amountKobo} kobo to ${invoice.invoiceNumber}: only ` +
            `${open} kobo is outstanding. Over-allocation would overpay the supplier.`,
          { invoiceNumber: invoice.invoiceNumber, openKobo: open.toString() },
        );
      }

      settledTotal += allocation.amountKobo;

      // Apportion the invoice's net and VAT to the amount being settled, so a
      // part payment withholds on a proportionate base rather than the whole.
      if (invoice.grossAmountKobo > 0n) {
        taxableBase +=
          (invoice.netAmountKobo * allocation.amountKobo) / invoice.grossAmountKobo;
        vatOnPaid +=
          (invoice.vatAmountKobo * allocation.amountKobo) / invoice.grossAmountKobo;
      }
    }

    // --- Withholding -------------------------------------------------------
    const whtCode = input.whtTaxCode ?? supplier.whtTaxCode?.code ?? null;
    let whtAmount = 0n;
    let whtTaxCodeId: string | null = null;

    if (whtCode) {
      // Refuses when no rate is configured — see the class comment.
      const calculation = await this.tax.calculateWht({
        companyId: input.companyId,
        taxCode: whtCode,
        amount: kobo(taxableBase),
        vatAmount: kobo(vatOnPaid),
        on: input.paymentDate,
      });
      whtAmount = calculation.taxKobo;
      whtTaxCodeId = calculation.taxCodeId;
    }

    const discount = input.discountKobo ?? 0n;
    const cash = settledTotal - whtAmount - discount;

    if (cash < 0n) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier payment',
        `Withholding of ${whtAmount} kobo plus a discount of ${discount} kobo exceeds the ` +
          `${settledTotal} kobo being settled. The bank cannot pay a negative amount.`,
        { paymentNumber: input.paymentNumber },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.supplierPayment.create({
        data: {
          companyId: input.companyId,
          paymentNumber: input.paymentNumber,
          supplierId: input.supplierId,
          paymentDate: input.paymentDate,
          method: input.method,
          bankGlAccountId: input.bankGlAccountId,
          reference: input.reference ?? null,
          narration: input.narration ?? null,
          branchId: input.branchId,
          currencyId: input.currencyId,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          amountKobo: cash,
          whtAmountKobo: whtAmount,
          discountKobo: discount,
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
          transactionId: payment.id,
          module: 'procurement',
          entityType: 'SupplierPayment',
          entityId: payment.id,
          status: payment.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments:
            `Raised payment ${payment.paymentNumber} to ${supplier.name}` +
            (whtAmount > 0n ? ` with ${whtAmount} kobo withheld.` : '.'),
          metadata: {
            settledKobo: settledTotal.toString(),
            cashKobo: cash.toString(),
            whtKobo: whtAmount.toString(),
          },
        },
        tx,
      );

      return payment;
    });
  }

  async submit(params: { paymentId: string; actor: WorkflowActor }) {
    const payment = await this.prisma.supplierPayment.findUniqueOrThrow({
      where: { id: params.paymentId },
      include: { allocations: true },
    });

    if (payment.status !== PaymentStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier payment',
        `${payment.paymentNumber} is ${payment.status} and cannot be submitted.`,
        { paymentNumber: payment.paymentNumber },
      );
    }

    const settled = payment.allocations.reduce((s, a) => s + a.amountKobo, 0n);

    const result = await this.workflow.submit({
      companyId: payment.companyId,
      transactionType: 'SUPPLIER_PAYMENT',
      module: 'procurement',
      documentType: 'SupplierPayment',
      documentId: payment.id,
      documentReference: payment.paymentNumber,
      // Routed on the payables relieved, not the cash — the withheld portion is
      // still value leaving the company's control.
      amount: kobo(settled),
      currencyId: payment.currencyId,
      branchId: payment.branchId,
      actor: params.actor,
    });

    await this.prisma.supplierPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  async postApproved(params: {
    paymentId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const payment = await params.tx.supplierPayment.findUniqueOrThrow({
      where: { id: params.paymentId },
      include: {
        allocations: { include: { invoice: true } },
        supplier: true,
        whtTaxCode: true,
      },
    });

    if (payment.status === PaymentStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${payment.paymentNumber} is already posted.`,
        { paymentNumber: payment.paymentNumber },
      );
    }

    const settings = await this.config.resolve(
      payment.companyId,
      payment.paymentDate,
      params.tx,
    );

    if (payment.whtAmountKobo > 0n && !settings.whtPayableGlAccountId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier payment',
        `Payment ${payment.paymentNumber} withholds tax but no WHT payable account is ` +
          `configured. The withheld amount would otherwise vanish rather than becoming a ` +
          `liability to the revenue authority.`,
        { paymentNumber: payment.paymentNumber },
      );
    }

    const dimensions = {
      companyId: payment.companyId,
      branchId: payment.branchId,
      financialYearId: payment.financialYearId,
      financialPeriodId: payment.financialPeriodId,
      currencyId: payment.currencyId,
      exchangeRate: '1.00000000',
    };
    const lineDimensions = { ...dimensions, supplierId: payment.supplierId };

    const settled = payment.allocations.reduce((s, a) => s + a.amountKobo, 0n);

    const lines = [
      {
        glAccountId: settings.payablesGlAccountId,
        description: `Payables settled — ${payment.paymentNumber}`,
        debit: settled,
      },
      {
        glAccountId: payment.bankGlAccountId,
        description: `Payment to ${payment.supplier.name}`,
        credit: payment.amountKobo,
      },
      ...(payment.whtAmountKobo > 0n
        ? [
            {
              glAccountId: settings.whtPayableGlAccountId!,
              description: `WHT withheld — ${payment.paymentNumber}`,
              credit: payment.whtAmountKobo,
            },
          ]
        : []),
      ...(payment.discountKobo > 0n
        ? [
            {
              // A settlement discount reduces the cost of what was bought.
              glAccountId: settings.grniGlAccountId,
              description: `Settlement discount — ${payment.paymentNumber}`,
              credit: payment.discountKobo,
            },
          ]
        : []),
    ];

    const result = await this.posting.post(
      {
        sourceModule: 'procurement',
        sourceDocumentType: 'SupplierPayment',
        sourceDocumentId: payment.id,
        journalNumber: payment.paymentNumber,
        journalDate: payment.paymentDate,
        narration:
          payment.narration ?? `Supplier payment ${payment.paymentNumber}`,
        ...dimensions,
        idempotencyKey: `supplier-payment:${payment.id}`,
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
    if (payment.whtAmountKobo > 0n && payment.whtTaxCode) {
      await this.registers.recordWht(
        {
          companyId: payment.companyId,
          branchId: payment.branchId,
          direction: WhtDirection.PAYABLE,
          calculation: {
            taxCodeId: payment.whtTaxCodeId!,
            taxCode: payment.whtTaxCode.code,
            whtCategory: payment.whtTaxCode.whtCategory ?? payment.whtTaxCode.code,
            appliedRate:
              settled > 0n
                ? (Number(payment.whtAmountKobo) / Number(settled)).toFixed(8)
                : '0.00000000',
            taxableBaseKobo: settled,
            taxKobo: payment.whtAmountKobo,
            netPayableKobo: payment.amountKobo,
            explanation: `Withheld on payment ${payment.paymentNumber}.`,
          },
          grossAmountKobo: settled,
          sourceModule: 'procurement',
          sourceDocumentType: 'SupplierPayment',
          sourceDocumentId: payment.id,
          documentReference: payment.paymentNumber,
          documentDate: payment.paymentDate,
          counterpartyName: payment.supplier.name,
          counterpartyTin: payment.supplier.tin,
          journalEntryId: result.journalEntryId,
        },
        params.tx,
      );
    }

    // --- Settle the invoices ------------------------------------------------
    for (const allocation of payment.allocations) {
      const invoice = allocation.invoice;
      const newSettled = invoice.settledAmountKobo + allocation.amountKobo;

      await params.tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          settledAmountKobo: newSettled,
          status:
            newSettled >= invoice.grossAmountKobo
              ? SupplierInvoiceStatus.PAID
              : SupplierInvoiceStatus.PART_PAID,
        },
      });
    }

    await params.tx.supplierPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.POSTED,
        journalEntryId: result.journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(`Posted supplier payment ${payment.paymentNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  /** §5 Supplier statement: open items and their ages. */
  async ageing(params: { companyId: string; asAt: Date; buckets?: number[] }) {
    const edges = params.buckets ?? [0, 30, 60, 90];

    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        companyId: params.companyId,
        status: {
          in: [SupplierInvoiceStatus.POSTED, SupplierInvoiceStatus.PART_PAID],
        },
        invoiceDate: { lte: params.asAt },
      },
      include: { supplier: { select: { code: true, name: true } } },
      orderBy: [{ supplierId: 'asc' }, { dueDate: 'asc' }],
    });

    const bySupplier = new Map<
      string,
      {
        supplierCode: string;
        supplierName: string;
        totalKobo: bigint;
        buckets: bigint[];
        invoices: Array<{
          invoiceNumber: string;
          supplierInvoiceNumber: string;
          dueDate: Date | null;
          openKobo: string;
          ageDays: number;
        }>;
      }
    >();

    for (const invoice of invoices) {
      const open = invoice.grossAmountKobo - invoice.settledAmountKobo;
      if (open <= 0n) continue;

      // Aged from the due date: an invoice on 60-day terms is not overdue on
      // day 31, and ageing from the invoice date would say otherwise.
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

      const entry = bySupplier.get(invoice.supplierId) ?? {
        supplierCode: invoice.supplier.code,
        supplierName: invoice.supplier.name,
        totalKobo: 0n,
        buckets: edges.map(() => 0n),
        invoices: [],
      };

      entry.totalKobo += open;
      entry.buckets[index] = (entry.buckets[index] ?? 0n) + open;
      entry.invoices.push({
        invoiceNumber: invoice.invoiceNumber,
        supplierInvoiceNumber: invoice.supplierInvoiceNumber,
        dueDate: invoice.dueDate,
        openKobo: open.toString(),
        ageDays,
      });

      bySupplier.set(invoice.supplierId, entry);
    }

    return [...bySupplier.values()].map((entry) => ({
      supplierCode: entry.supplierCode,
      supplierName: entry.supplierName,
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
