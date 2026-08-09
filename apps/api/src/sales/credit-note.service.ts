import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  CreditNoteReason,
  CreditNoteStatus,
  Prisma,
  ReturnCondition,
  SalesInvoiceStatus,
  StockDirection,
  VatDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { TaxEngineService } from '../tax/tax-engine.service';
import { TaxRegisterService } from '../tax/tax-register.service';
import { RecipeService } from '../masters/recipe.service';
import { SalesPricingService, PricedLineInput } from './sales-pricing.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface ReturnLineInput {
  itemId: string;
  quantity: Decimal.Value;
  condition?: ReturnCondition;
  reason?: string | null;
  batchReference?: string | null;
}

/**
 * Credit Note and Sales Return (§6).
 *
 * §6 lists both, and they are separate documents here for a reason: a pricing
 * error credits the customer with no goods coming back, while a return brings
 * goods back AND credits them. Keeping the money side and the goods side
 * distinct lets each happen without the other.
 *
 * Postings, per §6:
 *   Credit note   Dr Revenue, Dr Output VAT, Cr Trade Receivable
 *   Return goods  Dr Inventory, Cr Cost of Sales
 *
 * Only a return whose goods are RESALEABLE goes back into stock at cost.
 * Damaged or expired returns are written off rather than restored — putting
 * unsaleable goods back into inventory at full cost overstates the asset.
 */
@Injectable()
export class CreditNoteService {
  private readonly logger = new Logger(CreditNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly pricing: SalesPricingService,
    private readonly tax: TaxEngineService,
    private readonly registers: TaxRegisterService,
    private readonly recipes: RecipeService,
  ) {}

  async create(input: {
    companyId: string;
    creditNoteNumber: string;
    customerId: string;
    invoiceId?: string | null;
    creditNoteDate: Date;
    reason: CreditNoteReason;
    narration?: string | null;
    branchId: string;
    currencyId: string;
    financialYearId: string;
    financialPeriodId: string;
    lines: PricedLineInput[];
    /** Supplied when goods physically come back (§6 Sales Return). */
    salesReturn?: {
      returnNumber: string;
      warehouseId: string;
      returnDate: Date;
      lines: ReturnLineInput[];
    } | null;
    actor: WorkflowActor;
  }) {
    if (input.reason === CreditNoteReason.RETURNED_GOODS && !input.salesReturn) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Credit note',
        `A credit note for returned goods must record the return itself. Crediting the ` +
          `customer without bringing the goods back would lose them from the books.`,
        { creditNoteNumber: input.creditNoteNumber },
      );
    }

    if (input.invoiceId) {
      const invoice = await this.prisma.salesInvoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
      });
      if (invoice.customerId !== input.customerId) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Credit note',
          `Invoice ${invoice.invoiceNumber} belongs to a different customer.`,
          { invoiceNumber: invoice.invoiceNumber },
        );
      }
      const creditable: SalesInvoiceStatus[] = [
        SalesInvoiceStatus.POSTED,
        SalesInvoiceStatus.PART_PAID,
        SalesInvoiceStatus.PAID,
      ];
      if (!creditable.includes(invoice.status)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Credit note',
          `Invoice ${invoice.invoiceNumber} is ${invoice.status}; only a posted invoice ` +
            `can be credited. Cancel the draft instead.`,
          { invoiceNumber: invoice.invoiceNumber, status: invoice.status },
        );
      }
    }

    const priced = await this.pricing.priceDocument({
      companyId: input.companyId,
      on: input.creditNoteDate,
      lines: input.lines,
    });

    return this.prisma.$transaction(async (tx) => {
      const creditNote = await tx.creditNote.create({
        data: {
          companyId: input.companyId,
          creditNoteNumber: input.creditNoteNumber,
          customerId: input.customerId,
          invoiceId: input.invoiceId ?? null,
          creditNoteDate: input.creditNoteDate,
          reason: input.reason,
          narration: input.narration ?? null,
          branchId: input.branchId,
          currencyId: input.currencyId,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          netAmountKobo: priced.netAmountKobo,
          vatAmountKobo: priced.vatAmountKobo,
          grossAmountKobo: priced.grossAmountKobo,
          createdById: input.actor.userId,
          lines: {
            create: priced.lines.map((line) => ({
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              description: line.description,
              quantity: new Prisma.Decimal(line.quantity),
              unitPriceKobo: line.unitPriceKobo,
              taxCodeId: line.taxCodeId,
              netAmountKobo: line.netAmountKobo,
              vatAmountKobo: line.vatAmountKobo,
            })),
          },
        },
        include: { lines: true },
      });

      if (input.salesReturn) {
        if (!input.invoiceId) {
          throw new AccountingRuleViolation(
            'Consolidated Reference §6 — Sales return',
            `A goods return must reference the invoice the goods were sold on.`,
            { returnNumber: input.salesReturn.returnNumber },
          );
        }

        const returnLines: Prisma.SalesReturnLineCreateManySalesReturnInput[] = [];
        let lineNumber = 1;
        let totalCost = 0n;

        for (const line of input.salesReturn.lines) {
          const quantity = new Decimal(line.quantity.toString());
          const unitCost = await this.recipes.standardCostOn(
            line.itemId,
            input.salesReturn.returnDate,
          );
          const cost = BigInt(
            new Decimal(unitCost.toString())
              .mul(quantity)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toFixed(0),
          );

          returnLines.push({
            lineNumber: lineNumber++,
            itemId: line.itemId,
            quantity: new Prisma.Decimal(quantity.toFixed(6)),
            condition: line.condition ?? ReturnCondition.RESALEABLE,
            reason: line.reason ?? null,
            unitCostKobo: unitCost,
            costKobo: cost,
            batchReference: line.batchReference ?? null,
          });

          // Only resaleable goods carry value back into stock.
          if ((line.condition ?? ReturnCondition.RESALEABLE) === ReturnCondition.RESALEABLE) {
            totalCost += cost;
          }
        }

        await tx.salesReturn.create({
          data: {
            companyId: input.companyId,
            returnNumber: input.salesReturn.returnNumber,
            customerId: input.customerId,
            invoiceId: input.invoiceId,
            creditNoteId: creditNote.id,
            returnDate: input.salesReturn.returnDate,
            warehouseId: input.salesReturn.warehouseId,
            branchId: input.branchId,
            totalCostKobo: totalCost,
            lines: { createMany: { data: returnLines } },
          },
        });
      }

      await this.audit.write(
        {
          transactionId: creditNote.id,
          module: 'sales',
          entityType: 'CreditNote',
          entityId: creditNote.id,
          status: creditNote.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments: `Raised credit note ${creditNote.creditNoteNumber} (${input.reason}).`,
        },
        tx,
      );

      return creditNote;
    });
  }

  /** §6: "Approval mandatory" for a credit note. No exceptions. */
  async submit(params: { creditNoteId: string; actor: WorkflowActor }) {
    const creditNote = await this.prisma.creditNote.findUniqueOrThrow({
      where: { id: params.creditNoteId },
    });

    if (creditNote.status !== CreditNoteStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Credit note',
        `${creditNote.creditNoteNumber} is ${creditNote.status} and cannot be submitted.`,
        { creditNoteNumber: creditNote.creditNoteNumber },
      );
    }

    const result = await this.workflow.submit({
      companyId: creditNote.companyId,
      transactionType: 'CREDIT_NOTE',
      module: 'sales',
      documentType: 'CreditNote',
      documentId: creditNote.id,
      documentReference: creditNote.creditNoteNumber,
      amount: kobo(creditNote.grossAmountKobo),
      currencyId: creditNote.currencyId,
      branchId: creditNote.branchId,
      actor: params.actor,
    });

    await this.prisma.creditNote.update({
      where: { id: creditNote.id },
      data: {
        status: CreditNoteStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  async postApproved(params: {
    creditNoteId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const creditNote = await params.tx.creditNote.findUniqueOrThrow({
      where: { id: params.creditNoteId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' }, include: { taxCode: true } },
        customer: true,
        salesReturn: { include: { lines: true } },
        invoice: true,
      },
    });

    if (creditNote.status === CreditNoteStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${creditNote.creditNoteNumber} is already posted.`,
        { creditNoteNumber: creditNote.creditNoteNumber },
      );
    }

    const config = await this.pricing.configuration(
      creditNote.companyId,
      creditNote.creditNoteDate,
      params.tx,
    );

    const dimensions = {
      companyId: creditNote.companyId,
      branchId: creditNote.branchId,
      financialYearId: creditNote.financialYearId,
      financialPeriodId: creditNote.financialPeriodId,
      currencyId: creditNote.currencyId,
      exchangeRate: '1.00000000',
    };
    const lineDimensions = { ...dimensions, customerId: creditNote.customerId };

    // §6: Dr Revenue, Dr Output VAT, Cr Trade Receivable — the mirror of the
    // invoice that created the receivable.
    const lines: Array<{
      glAccountId: string;
      description: string;
      debit?: bigint;
      credit?: bigint;
      itemId?: string | null;
    }> = [];

    for (const line of creditNote.lines) {
      lines.push({
        glAccountId: config.revenueGlAccountId,
        description: `Credit — ${line.description}`,
        debit: line.netAmountKobo,
        itemId: line.itemId,
      });
    }

    if (creditNote.vatAmountKobo > 0n) {
      const outputAccount = await this.tax.glAccountFor(
        creditNote.companyId,
        creditNote.lines.find((l) => l.vatAmountKobo > 0n)!.taxCodeId!,
        VatDirection.OUTPUT,
        creditNote.creditNoteDate,
        params.tx,
      );
      lines.push({
        glAccountId: outputAccount,
        description: `Output VAT credited — ${creditNote.creditNoteNumber}`,
        debit: creditNote.vatAmountKobo,
      });
    }

    lines.push({
      glAccountId: config.receivableGlAccountId,
      description: `Receivable credited — ${creditNote.creditNoteNumber}`,
      credit: creditNote.grossAmountKobo,
    });

    // §6 Sales Return: Dr Inventory, Cr Cost of Sales — only for goods that
    // are actually resaleable.
    const resaleableCost = creditNote.salesReturn?.totalCostKobo ?? 0n;
    if (resaleableCost > 0n) {
      lines.push({
        glAccountId: config.inventoryGlAccountId,
        description: `Goods returned to stock — ${creditNote.salesReturn!.returnNumber}`,
        debit: resaleableCost,
      });
      lines.push({
        glAccountId: config.costOfSalesGlAccountId,
        description: `Cost of sales reversed — ${creditNote.salesReturn!.returnNumber}`,
        credit: resaleableCost,
      });
    }

    const result = await this.posting.post(
      {
        sourceModule: 'sales',
        sourceDocumentType: 'CreditNote',
        sourceDocumentId: creditNote.id,
        journalNumber: creditNote.creditNoteNumber,
        journalDate: creditNote.creditNoteDate,
        narration: `Credit note ${creditNote.creditNoteNumber} — ${creditNote.customer.name}`,
        ...dimensions,
        idempotencyKey: `credit-note:${creditNote.id}`,
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

    // Negative VAT register entries are not permitted (the register is
    // append-only and non-negative), so a credit note's VAT reduction is
    // recorded as a tax adjustment against the period — which is exactly what
    // §4's TaxAdjustment exists for.
    if (creditNote.vatAmountKobo > 0n) {
      const period = await params.tx.taxPeriod.findFirst({
        where: {
          companyId: creditNote.companyId,
          taxType: 'VAT',
          startDate: { lte: creditNote.creditNoteDate },
          endDate: { gte: creditNote.creditNoteDate },
        },
      });
      if (period) {
        await params.tx.taxAdjustment.create({
          data: {
            companyId: creditNote.companyId,
            taxType: 'VAT',
            taxPeriodId: period.id,
            taxCodeId: creditNote.lines.find((l) => l.vatAmountKobo > 0n)!.taxCodeId!,
            reference: creditNote.creditNoteNumber,
            reason: `Credit note — ${creditNote.reason}`,
            taxableBaseKobo: -creditNote.netAmountKobo,
            taxKobo: -creditNote.vatAmountKobo,
            journalEntryId: result.journalEntryId,
            createdById: params.actor.userId,
          },
        });
      }
    }

    // Return the goods to stock.
    if (creditNote.salesReturn) {
      for (const line of creditNote.salesReturn.lines) {
        if (line.condition !== ReturnCondition.RESALEABLE) continue;
        await params.tx.stockMovement.create({
          data: {
            companyId: creditNote.companyId,
            branchId: creditNote.branchId,
            itemId: line.itemId,
            warehouseId: creditNote.salesReturn.warehouseId,
            direction: StockDirection.IN,
            quantity: line.quantity,
            unitCostKobo: line.unitCostKobo,
            valueKobo: line.costKobo,
            batchReference: line.batchReference,
            sourceModule: 'sales',
            sourceDocumentType: 'SalesReturn',
            sourceDocumentId: creditNote.salesReturn.id,
            documentReference: creditNote.salesReturn.returnNumber,
            movementDate: creditNote.salesReturn.returnDate,
            journalEntryId: result.journalEntryId,
          },
        });
      }
    }

    // Reduce the invoice's outstanding balance, so ageing reflects the credit.
    if (creditNote.invoiceId && creditNote.invoice) {
      const newSettled =
        creditNote.invoice.settledAmountKobo + creditNote.grossAmountKobo;
      const capped =
        newSettled > creditNote.invoice.grossAmountKobo
          ? creditNote.invoice.grossAmountKobo
          : newSettled;

      await params.tx.salesInvoice.update({
        where: { id: creditNote.invoiceId },
        data: {
          settledAmountKobo: capped,
          status:
            capped >= creditNote.invoice.grossAmountKobo
              ? SalesInvoiceStatus.PAID
              : SalesInvoiceStatus.PART_PAID,
        },
      });
    }

    await params.tx.creditNote.update({
      where: { id: creditNote.id },
      data: {
        status: CreditNoteStatus.POSTED,
        journalEntryId: result.journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(`Posted credit note ${creditNote.creditNoteNumber}`);
    return { journalEntryId: result.journalEntryId };
  }
}
