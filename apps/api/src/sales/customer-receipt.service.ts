import { Injectable, Logger } from '@nestjs/common';
import { nextReference, siteOf } from '../numbering/numbering';
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
import { assertBankGlAccount } from '../chart/bank-account';
import { kobo } from '../common/money';
import { chartVersionOf } from '../chart/chart';
import { resolveApprovedMappedAccount } from '../posting-control/approved-account-map';

export interface ReceiptAllocationInput {
  invoiceId?: string;
  journalLineId?: string;
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
    /** Given by NumberingService when not supplied (Numbering_Parameters). */
    receiptNumber?: string;
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
    const receiptNumber =
      input.receiptNumber?.trim() ||
      (await nextReference(this.prisma, {
        companyId: input.companyId,
        type: 'RCT',
        site: await siteOf(this.prisma, { farmId: null, branchId: input.branchId }),
        date: input.receiptDate,
      }));

    const wht = input.whtAmountKobo ?? 0n;

    if (wht > 0n && !input.whtCreditNoteReference) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Customer receipt',
        `A withheld amount of ${wht} kobo has been recorded with no WHT credit note ` +
          `reference. Without the customer's certificate the withholding cannot be ` +
          `claimed, so recording it as receivable would overstate the asset.`,
        { receiptNumber: receiptNumber },
      );
    }

    const settled = input.amountKobo + wht;
    const allocatedTotal = input.allocations.reduce((s, a) => s + a.amountKobo, 0n);
    const targets = input.allocations.map((allocation) => allocation.invoiceId ? `invoice:${allocation.invoiceId}` : allocation.journalLineId ? `journal:${allocation.journalLineId}` : 'missing');
    if (new Set(targets).size !== targets.length || targets.includes('missing')) {
      throw new AccountingRuleViolation('Consolidated Reference §6 — Customer receipt', 'Each receipt may allocate to a target only once, and every allocation must identify an invoice or receivable journal line.');
    }

    if (allocatedTotal !== settled) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Customer receipt',
        `Allocations total ${allocatedTotal} kobo but the receipt settles ${settled} kobo ` +
          `(${input.amountKobo} banked plus ${wht} withheld). Every kobo of a receipt must ` +
          `be allocated to an invoice, or the receivable will not clear.`,
        { receiptNumber: receiptNumber },
      );
    }

    // Validate each allocation against its open-item balance. Invoice rows
    // retain their native settled amount; journal-line targets are used for
    // customer-tagged AR events such as fixed-asset credit disposals.
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
      if (Boolean(allocation.invoiceId) === Boolean(allocation.journalLineId)) {
        throw new AccountingRuleViolation('Consolidated Reference §6 — Customer receipt', 'Each receipt allocation must target exactly one invoice or journal receivable.');
      }
      if (allocation.journalLineId) {
        const line = await this.prisma.journalLine.findFirst({
          where: {
            id: allocation.journalLineId,
            companyId: input.companyId,
            customerId: input.customerId,
            debitKobo: { gt: 0n },
            journalEntry: { status: 'POSTED', sourceModule: 'fixed-assets', sourceDocumentType: 'FixedAssetDisposal' },
          },
          include: { journalEntry: true },
        });
        if (!line) throw new AccountingRuleViolation('Consolidated Reference §6 — Customer receipt', 'That receivable does not belong to this customer or is not an eligible posted asset-sale receivable.');
        const mappedReceivable = await resolveApprovedMappedAccount(this.prisma, {
          companyId: input.companyId,
          application: 'YifrehCore',
          masterType: 'Customer',
          masterId: input.customerId,
          postingKey: 'AR_CONTROL',
          on: line.journalEntry.journalDate,
        });
        if (line.glAccountId !== mappedReceivable.glAccountId) {
          throw new AccountingRuleViolation('Consolidated Reference §6 — Customer receipt', 'That journal line is not on the approved customer receivables control account.');
        }
        const allocations = await this.prisma.receiptAllocation.findMany({
          where: { journalLineId: line.id, receipt: { status: { in: [ReceiptStatus.DRAFT, ReceiptStatus.SUBMITTED, ReceiptStatus.APPROVED, ReceiptStatus.POSTED] } } },
          select: { amountKobo: true },
        });
        const open = line.debitKobo - allocations.reduce((sum, row) => sum + row.amountKobo, 0n);
        if (allocation.amountKobo <= 0n || allocation.amountKobo > open) {
          throw new AccountingRuleViolation('Consolidated Reference §6 — Customer receipt', `Cannot allocate ${allocation.amountKobo} kobo to this receivable: only ${open} kobo is outstanding.`);
        }
        continue;
      }
      const invoice = await this.prisma.salesInvoice.findUniqueOrThrow({
        where: { id: allocation.invoiceId! },
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
      const reservations = await this.prisma.receiptAllocation.findMany({
        where: { invoiceId: invoice.id, receipt: { status: { in: [ReceiptStatus.DRAFT, ReceiptStatus.SUBMITTED, ReceiptStatus.APPROVED] } } },
        select: { amountKobo: true },
      });
      const available = open - reservations.reduce((sum, row) => sum + row.amountKobo, 0n);
      if (allocation.amountKobo <= 0n || allocation.amountKobo > available) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Customer receipt',
          `Cannot allocate ${allocation.amountKobo} kobo to invoice ` +
            `${invoice.invoiceNumber}: only ${available} kobo is available after pending receipts. Over-allocation ` +
            `would create a credit balance disguised as a settled invoice.`,
          { invoiceNumber: invoice.invoiceNumber, openKobo: open.toString() },
        );
      }
    }

    await assertBankGlAccount(this.prisma, input.companyId, input.bankGlAccountId, 'A receipt');

    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.customerReceipt.create({
        data: {
          companyId: input.companyId,
          receiptNumber,
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
              ...(allocation.invoiceId ? { invoiceId: allocation.invoiceId } : {}),
              ...(allocation.journalLineId ? { journalLineId: allocation.journalLineId } : {}),
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
        allocations: { include: { invoice: true, journalLine: true } },
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
      receipt.customerId,
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

    const approvedChart = await chartVersionOf(params.tx, receipt.companyId) === 'APPROVED';
    if (approvedChart) {
      const bankAccounts = await params.tx.bankAccount.findMany({ where: { companyId: receipt.companyId, glAccountId: receipt.bankGlAccountId }, select: { id: true } });
      if (bankAccounts.length !== 1) throw new AccountingRuleViolation('Approved Posting Group — bank assignment', 'Select a GL account linked to exactly one registered bank account before posting this receipt.', { bankGlAccountId: receipt.bankGlAccountId, matches: bankAccounts.length });
      const mappedBank = await resolveApprovedMappedAccount(params.tx, { companyId: receipt.companyId, application: 'YifrehCore', masterType: 'Bank', masterId: bankAccounts[0]!.id, postingKey: 'BANK', on: receipt.receiptDate });
      if (mappedBank.glAccountId !== receipt.bankGlAccountId) throw new AccountingRuleViolation('Approved Posting Group — bank account mismatch', 'The selected cash account does not match the account mapped by the bank’s assigned posting group.', { selectedGlAccountId: receipt.bankGlAccountId, mappedGlAccountId: mappedBank.glAccountId });
    }
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
        ...(approvedChart ? { approvedControl: receipt.whtAmountKobo > 0n
          ? { application: 'YifrehCore', applicationRuleId: 'COR-YFR-026A', additionalApplicationRuleIds: ['COR-YFR-026B'], dynamicAccountIds: { 'COR-YFR-026A:BANK': [receipt.bankGlAccountId], 'COR-YFR-026A:AR_CONTROL': [config.receivableGlAccountId], 'COR-YFR-026B:AR_CONTROL': [config.receivableGlAccountId] }, expectedLineAmountsKobo: {
              'COR-YFR-026A:1': receipt.amountKobo.toString(), 'COR-YFR-026A:2': receipt.amountKobo.toString(),
              'COR-YFR-026B:1': receipt.whtAmountKobo.toString(), 'COR-YFR-026B:2': receipt.whtAmountKobo.toString(),
            } }
          : { application: 'YifrehCore', applicationRuleId: 'COR-YFR-024A', dynamicAccountIds: { 'COR-YFR-024A:BANK': [receipt.bankGlAccountId], 'COR-YFR-024A:AR_CONTROL': [config.receivableGlAccountId] }, expectedLineAmountsKobo: {
              'COR-YFR-024A:1': receipt.amountKobo.toString(), 'COR-YFR-024A:2': receipt.amountKobo.toString(),
            } } } : {}),
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
      if (invoice) {
        // Serialize approvals against the receivable row. Re-read after the
        // lock so simultaneous approvals cannot both consume the same balance.
        await params.tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_invoices" WHERE "id" = ${invoice.id}::uuid FOR UPDATE`);
        const currentInvoice = await params.tx.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
        const otherReservations = await params.tx.receiptAllocation.findMany({
          where: { invoiceId: invoice.id, receiptId: { not: receipt.id }, receipt: { status: { in: [ReceiptStatus.DRAFT, ReceiptStatus.SUBMITTED, ReceiptStatus.APPROVED] } } },
          select: { amountKobo: true },
        });
        const available = currentInvoice.grossAmountKobo - currentInvoice.settledAmountKobo - otherReservations.reduce((sum, row) => sum + row.amountKobo, 0n);
        if (allocation.amountKobo > available) {
          throw new AccountingRuleViolation('Consolidated Reference §6 — Customer receipt', `Receipt ${receipt.receiptNumber} would over-settle invoice ${invoice.invoiceNumber}. Reconcile concurrent receipts before posting.`);
        }
        const newSettled = currentInvoice.settledAmountKobo + allocation.amountKobo;
        const fullySettled = newSettled >= currentInvoice.grossAmountKobo;

        await params.tx.salesInvoice.update({
          where: { id: invoice.id },
          data: {
            settledAmountKobo: newSettled,
            status: fullySettled ? SalesInvoiceStatus.PAID : SalesInvoiceStatus.PART_PAID,
          },
        });
        continue;
      }
      const journalLine = allocation.journalLine;
      if (!journalLine) throw new AccountingRuleViolation('Consolidated Reference §6 — Customer receipt', 'The receivable allocation target no longer exists.');
      await params.tx.$queryRaw(Prisma.sql`SELECT "id" FROM "journal_lines" WHERE "id" = ${journalLine.id}::uuid FOR UPDATE`);
      const currentLine = await params.tx.journalLine.findUniqueOrThrow({ where: { id: journalLine.id } });
      const reservations = await params.tx.receiptAllocation.findMany({
        where: { journalLineId: journalLine.id, receiptId: { not: receipt.id }, receipt: { status: { in: [ReceiptStatus.DRAFT, ReceiptStatus.SUBMITTED, ReceiptStatus.APPROVED, ReceiptStatus.POSTED] } } },
        select: { amountKobo: true },
      });
      const available = currentLine.debitKobo - reservations.reduce((sum, row) => sum + row.amountKobo, 0n);
      if (allocation.amountKobo > available) {
        throw new AccountingRuleViolation('Consolidated Reference §6 — Customer receipt', `Receipt ${receipt.receiptNumber} would over-settle its asset-disposal receivable. Only ${available} kobo remains after other receipts.`);
      }
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

    // Approved-chart fixed-asset credit disposals create a customer-tagged AR
    // journal without a SalesInvoice row. Include those open receivables in
    // ageing so the workbook's 068B event remains visible in the customer
    // subledger report.
    const disposalTransactions = await this.prisma.workflowTransaction.findMany({
      where: {
        companyId: params.companyId,
        module: 'fixed-assets',
        documentType: 'FixedAssetDisposal',
        transactionType: 'FIXED_ASSET_DISPOSAL',
        status: 'POSTED',
        journalEntry: { journalDate: { lte: params.asAt } },
      },
      select: {
        documentReference: true,
        postingPayload: true,
        journalEntry: {
          select: {
            journalDate: true,
            lines: {
              where: { customerId: { not: null }, debitKobo: { gt: 0n } },
              select: { id: true, debitKobo: true, customerId: true },
            },
          },
        },
      },
    });
    const disposalRows = disposalTransactions.flatMap((transaction) => {
      const payload = transaction.postingPayload && typeof transaction.postingPayload === 'object' && !Array.isArray(transaction.postingPayload)
        ? transaction.postingPayload as Record<string, unknown>
        : null;
      const amount = BigInt(String(payload?.proceedsKobo ?? '0'));
      const customerId = typeof payload?.customerId === 'string' ? payload.customerId : null;
      const line = transaction.journalEntry?.lines.find((candidate) => candidate.customerId === customerId);
      return amount > 0n && payload?.proceedsMode === 'CREDIT' && customerId && transaction.journalEntry && line
        ? [{ transaction, amount, customerId, date: transaction.journalEntry.journalDate, line }]
        : [];
    });
    const disposalAllocations = disposalRows.length ? await this.prisma.receiptAllocation.findMany({
      where: {
        journalLineId: { in: disposalRows.map((row) => row.line.id) },
        receipt: { status: 'POSTED', receiptDate: { lte: params.asAt } },
      },
      select: { journalLineId: true, amountKobo: true },
    }) : [];
    const allocatedByLine = new Map<string, bigint>();
    for (const allocation of disposalAllocations) {
      if (allocation.journalLineId) allocatedByLine.set(allocation.journalLineId, (allocatedByLine.get(allocation.journalLineId) ?? 0n) + allocation.amountKobo);
    }
    const customers = disposalRows.length ? await this.prisma.customer.findMany({ where: { companyId: params.companyId, id: { in: [...new Set(disposalRows.map((row) => row.customerId))] } }, select: { id: true, code: true, name: true } }) : [];
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    for (const row of disposalRows) {
      const customer = customerById.get(row.customerId);
      if (!customer) continue;
      const ageDays = Math.max(0, Math.floor((params.asAt.getTime() - row.date.getTime()) / 86_400_000));
      let index = 0;
      for (let i = edges.length - 1; i >= 0; i -= 1) if (ageDays >= edges[i]!) { index = i; break; }
      const entry = byCustomer.get(row.customerId) ?? { customerCode: customer.code, customerName: customer.name, totalKobo: 0n, buckets: edges.map(() => 0n), invoices: [] };
      const open = row.line.debitKobo - (allocatedByLine.get(row.line.id) ?? 0n);
      if (open <= 0n) continue;
      entry.totalKobo += open;
      entry.buckets[index] = (entry.buckets[index] ?? 0n) + open;
      entry.invoices.push({ invoiceNumber: `FA-DISPOSAL-${row.transaction.documentReference}`, invoiceDate: row.date, dueDate: row.date, openKobo: open.toString(), ageDays });
      byCustomer.set(row.customerId, entry);
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
