import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { TaxEngineService } from '../tax/tax-engine.service';
import { AccountingRuleViolation } from '../common/errors';

export interface PricedLineInput {
  lineNumber: number;
  itemId: string;
  description?: string;
  /** QUANTITY. Decimal, not money. */
  quantity: Decimal.Value;
  /** MONEY per unit, integer kobo. */
  unitPriceKobo: bigint;
  /** MONEY. A flat discount on the line, not a percentage. */
  discountKobo?: bigint;
  /** Overrides the item master's VAT code where supplied. */
  taxCode?: string | null;
}

export interface PricedLine {
  lineNumber: number;
  itemId: string;
  description: string;
  quantity: string;
  unitPriceKobo: bigint;
  discountKobo: bigint;
  taxCodeId: string | null;
  netAmountKobo: bigint;
  vatAmountKobo: bigint;
  grossAmountKobo: bigint;
}

export interface PricedDocument {
  lines: PricedLine[];
  netAmountKobo: bigint;
  vatAmountKobo: bigint;
  grossAmountKobo: bigint;
}

/**
 * Prices a sales document and applies tax through the shared engine (Rule 5).
 *
 * One service does this for quotations, orders, invoices and credit notes, so
 * the four documents cannot disagree about what the same line is worth. That is
 * the whole reason a quotation converts cleanly into an order and an order into
 * an invoice: the arithmetic is not repeated per document.
 *
 * The extended amount is quantity x unit price, computed at full decimal
 * precision and rounded to kobo exactly once (Rule 1). VAT then comes from the
 * tax engine on that rounded net, so the line's own figures are internally
 * consistent and the document total is the sum of its lines.
 */
@Injectable()
export class SalesPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxEngineService,
  ) {}

  async priceDocument(params: {
    companyId: string;
    on: Date;
    lines: PricedLineInput[];
    tx?: Prisma.TransactionClient;
  }): Promise<PricedDocument> {
    if (params.lines.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales documents',
        'A sales document must have at least one line.',
        {},
      );
    }

    const client = params.tx ?? this.prisma;
    const itemIds = [...new Set(params.lines.map((l) => l.itemId))];
    const items = await client.item.findMany({
      where: { id: { in: itemIds } },
      include: { vatTaxCode: { select: { code: true } } },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    const priced: PricedLine[] = [];

    for (const line of params.lines) {
      const item = itemById.get(line.itemId);
      if (!item) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Item master',
          `Item ${line.itemId} on line ${line.lineNumber} does not exist.`,
          { lineNumber: line.lineNumber },
        );
      }
      if (!item.active) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Item master',
          `Item "${item.code}" is inactive and cannot be sold.`,
          { lineNumber: line.lineNumber, itemCode: item.code },
        );
      }

      const quantity = new Decimal(line.quantity.toString());
      if (quantity.lessThanOrEqualTo(0)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Sales documents',
          `Line ${line.lineNumber} has a quantity of ${quantity.toString()}. ` +
            `A negative or zero sale is a credit note, not a line.`,
          { lineNumber: line.lineNumber },
        );
      }

      // Full precision through the multiplication; rounded once, here.
      const extended = BigInt(
        new Decimal(line.unitPriceKobo.toString())
          .mul(quantity)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toFixed(0),
      );

      const discount = line.discountKobo ?? 0n;
      if (discount > extended) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Sales documents',
          `Line ${line.lineNumber} has a discount of ${discount} kobo on an extended ` +
            `amount of ${extended} kobo. A discount cannot exceed the line it discounts.`,
          { lineNumber: line.lineNumber },
        );
      }

      const net = extended - discount;

      // The item's own VAT code unless the caller overrode it. An item with no
      // code is out of scope rather than an error — payroll recharges and
      // similar non-supply lines legitimately carry none.
      const taxCode = line.taxCode ?? item.vatTaxCode?.code ?? null;
      let vat = 0n;
      let taxCodeId: string | null = null;

      if (taxCode) {
        const calculation = await this.tax.calculateVat(
          {
            companyId: params.companyId,
            taxCode,
            amount: net as never,
            on: params.on,
          },
          params.tx,
        );
        vat = calculation.taxKobo;
        taxCodeId = calculation.taxCodeId;
      }

      priced.push({
        lineNumber: line.lineNumber,
        itemId: item.id,
        description: line.description ?? item.description,
        quantity: quantity.toFixed(6),
        unitPriceKobo: line.unitPriceKobo,
        discountKobo: discount,
        taxCodeId,
        netAmountKobo: net,
        vatAmountKobo: vat,
        grossAmountKobo: net + vat,
      });
    }

    return {
      lines: priced,
      netAmountKobo: priced.reduce((s, l) => s + l.netAmountKobo, 0n),
      vatAmountKobo: priced.reduce((s, l) => s + l.vatAmountKobo, 0n),
      grossAmountKobo: priced.reduce((s, l) => s + l.grossAmountKobo, 0n),
    };
  }

  /** The company's sales policy on a date. */
  async configuration(companyId: string, on: Date, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const day = new Date(
      Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()),
    );

    const config = await client.salesConfiguration.findFirst({
      where: {
        companyId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!config) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales configuration',
        `No sales configuration is effective on ${day.toISOString().slice(0, 10)}. ` +
          `The receivable, revenue, cost-of-sales and inventory accounts are choices ` +
          `this system will not make on the company's behalf.`,
        { companyId, date: day.toISOString().slice(0, 10) },
      );
    }
    return config;
  }
}
