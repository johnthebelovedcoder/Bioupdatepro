import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  Prisma,
  RoundingRule,
  TaxTreatment,
  TaxType,
  WhtBasis,
  PriceBasis,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';
import { Kobo } from '../common/money';
import {
  DocumentTaxRequest,
  DocumentTaxResult,
  VatCalculation,
  VatCalculationRequest,
  WhtCalculation,
  WhtCalculationRequest,
} from './tax.types';

/**
 * The one Tax Engine (Rule 5, Consolidated Reference §4).
 *
 * Procurement, Sales and Banking call this. None of them computes VAT or WHT
 * itself, and none of them holds a rate.
 *
 * ARITHMETIC (Rule 1): the rate is the only fractional value in the system, and
 * it never touches a native float. Every multiplication runs through decimal.js
 * at full precision and is rounded to integer kobo exactly once, at the end,
 * using the company's configured rounding rule. Rounding mid-calculation is how
 * a VAT return ends up a few kobo out from the ledger.
 *
 * WHAT THIS ENGINE WILL NOT DO: invent a rate. If a code has no rate effective
 * on the document date, the calculation is refused. It does NOT fall back to
 * zero — a missing configuration and a genuine zero-rating are different
 * things, and silently treating the first as the second under-declares tax.
 */
@Injectable()
export class TaxEngineService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // VAT
  // -------------------------------------------------------------------------

  async calculateVat(
    request: VatCalculationRequest,
    tx?: Prisma.TransactionClient,
  ): Promise<VatCalculation> {
    const client = tx ?? this.prisma;
    const code = await this.loadCode(request.companyId, request.taxCode, TaxType.VAT, client);
    const config = await this.configuration(request.companyId, request.on, client);

    const amount = request.amount as bigint;
    if (amount < 0n) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `Refusing to compute VAT on a negative amount (${amount} kobo). A reduction ` +
          `is a credit note or a tax adjustment, not a negative line.`,
        { taxCode: request.taxCode, amount: amount.toString() },
      );
    }

    // Exempt, zero-rated and out-of-scope all yield no tax, but they are
    // reported differently, so the treatment travels with the result.
    if (code.treatment !== TaxTreatment.STANDARD) {
      return {
        taxCodeId: code.id,
        taxCode: code.code,
        treatment: code.treatment,
        recoverable: code.recoverable,
        appliedRate: '0.00000000',
        taxableBaseKobo: amount,
        taxKobo: 0n,
        grossKobo: amount,
        explanation:
          `${code.code} is ${code.treatment.toLowerCase().replace('_', '-')}: no VAT ` +
          `arises. Input VAT under this code is ` +
          `${code.recoverable ? 'recoverable' : 'NOT recoverable'}.`,
      };
    }

    const rate = await this.rateOn(code.id, request.on, client, code.code);
    const rateDecimal = new Decimal(rate.rate.toString());

    let baseKobo: bigint;
    let taxKobo: bigint;

    if (code.priceBasis === PriceBasis.INCLUSIVE) {
      // The amount already contains its VAT: tax = gross × r / (1 + r).
      const grossDecimal = new Decimal(amount.toString());
      const taxDecimal = grossDecimal.mul(rateDecimal).div(rateDecimal.plus(1));
      taxKobo = this.round(taxDecimal, config.rounding);
      // Deriving the base by subtraction, rather than rounding it separately,
      // guarantees base + tax === the amount the customer actually pays.
      baseKobo = amount - taxKobo;
    } else {
      const baseDecimal = new Decimal(amount.toString());
      taxKobo = this.round(baseDecimal.mul(rateDecimal), config.rounding);
      baseKobo = amount;
    }

    return {
      taxCodeId: code.id,
      taxCode: code.code,
      treatment: code.treatment,
      recoverable: code.recoverable,
      appliedRate: rateDecimal.toFixed(8),
      taxableBaseKobo: baseKobo,
      taxKobo,
      grossKobo: baseKobo + taxKobo,
      explanation:
        `${code.code} at ${rateDecimal.mul(100).toFixed(2)}% on a ` +
        `${code.priceBasis.toLowerCase()} amount of ${amount} kobo, rounded ` +
        `${config.rounding.toLowerCase().replace('_', ' ')} to the kobo.`,
    };
  }

  /**
   * Calculate a whole document.
   *
   * Tax is computed and rounded PER LINE, and the document total is the sum of
   * the rounded lines. The alternative — rounding the total once — produces a
   * figure that does not equal its own line breakdown, which an invoice cannot
   * show and a register cannot reconcile.
   */
  async calculateDocument(
    request: DocumentTaxRequest,
    tx?: Prisma.TransactionClient,
  ): Promise<DocumentTaxResult> {
    const lines: DocumentTaxResult['lines'] = [];

    for (const line of request.lines) {
      const calculation = await this.calculateVat(
        {
          companyId: request.companyId,
          taxCode: line.taxCode,
          amount: line.amount,
          on: request.on,
        },
        tx,
      );
      lines.push({ ...calculation, lineNumber: line.lineNumber });
    }

    return {
      lines,
      totalTaxableBaseKobo: lines.reduce((s, l) => s + l.taxableBaseKobo, 0n),
      totalTaxKobo: lines.reduce((s, l) => s + l.taxKobo, 0n),
      totalGrossKobo: lines.reduce((s, l) => s + l.grossKobo, 0n),
    };
  }

  // -------------------------------------------------------------------------
  // WHT
  // -------------------------------------------------------------------------

  /**
   * Withholding tax on a payment.
   *
   * The base depends on company policy: NET_OF_VAT withholds on the amount
   * before VAT, GROSS_INCLUDING_VAT on the VAT-inclusive amount. The source
   * documents never say which applies, so TaxConfiguration has no default for
   * it and a company must state it explicitly — see the migration note in
   * TaxConfiguration.
   */
  async calculateWht(
    request: WhtCalculationRequest,
    tx?: Prisma.TransactionClient,
  ): Promise<WhtCalculation> {
    const client = tx ?? this.prisma;
    const code = await this.loadCode(request.companyId, request.taxCode, TaxType.WHT, client);
    const config = await this.configuration(request.companyId, request.on, client);

    const amount = request.amount as bigint;
    const vat = (request.vatAmount as bigint | undefined) ?? 0n;

    if (amount < 0n || vat < 0n) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `Refusing to compute withholding tax on a negative amount.`,
        { taxCode: request.taxCode, amount: amount.toString() },
      );
    }

    const rate = await this.rateOn(code.id, request.on, client, code.code);
    const rateDecimal = new Decimal(rate.rate.toString());

    const baseKobo =
      config.whtBasis === WhtBasis.GROSS_INCLUDING_VAT ? amount + vat : amount;

    const taxKobo = this.round(
      new Decimal(baseKobo.toString()).mul(rateDecimal),
      config.rounding,
    );

    return {
      taxCodeId: code.id,
      taxCode: code.code,
      whtCategory: code.whtCategory ?? code.code,
      appliedRate: rateDecimal.toFixed(8),
      taxableBaseKobo: baseKobo,
      taxKobo,
      // What actually leaves the bank: the full invoice less the amount withheld.
      netPayableKobo: amount + vat - taxKobo,
      explanation:
        `${code.code} (${code.whtCategory ?? 'uncategorised'}) at ` +
        `${rateDecimal.mul(100).toFixed(2)}% on a base of ${baseKobo} kobo ` +
        `(${config.whtBasis === WhtBasis.GROSS_INCLUDING_VAT ? 'including' : 'excluding'} VAT), ` +
        `per company tax configuration.`,
    };
  }

  // -------------------------------------------------------------------------
  // Configuration lookups
  // -------------------------------------------------------------------------

  async loadCode(
    companyId: string,
    code: string,
    expectedType: TaxType,
    client: Prisma.TransactionClient | PrismaService,
  ) {
    const found = await client.taxCode.findUnique({
      where: { companyId_code: { companyId, code } },
    });

    if (!found) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `Tax code "${code}" is not configured for this company. A document cannot ` +
          `be taxed under a code that does not exist.`,
        { taxCode: code, companyId },
      );
    }
    if (!found.active) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `Tax code "${code}" is inactive and cannot be applied to a new document.`,
        { taxCode: code },
      );
    }
    if (found.taxType !== expectedType) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `Tax code "${code}" is a ${found.taxType} code and cannot be used for a ` +
          `${expectedType} calculation.`,
        { taxCode: code, actualType: found.taxType, expectedType },
      );
    }
    return found;
  }

  /**
   * The rate effective on a date.
   *
   * Refuses rather than defaulting. A code with no rate on the document date is
   * a configuration gap, and the only safe response is to stop — quietly
   * applying zero would file a return that understates the liability, and
   * quietly applying the newest rate would apply tomorrow's law to yesterday's
   * invoice.
   */
  private async rateOn(
    taxCodeId: string,
    on: Date,
    client: Prisma.TransactionClient | PrismaService,
    codeLabel: string,
  ) {
    const day = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()));

    const rate = await client.taxRate.findFirst({
      where: {
        taxCodeId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!rate) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `Tax code "${codeLabel}" has no rate effective on ` +
          `${day.toISOString().slice(0, 10)}. The engine will not assume a rate: ` +
          `configure one with its statutory source before taxing this document.`,
        { taxCode: codeLabel, date: day.toISOString().slice(0, 10) },
      );
    }
    return rate;
  }

  /**
   * The company's tax policy on a date. Also refuses rather than defaulting —
   * the WHT basis in particular is legally significant and must be a stated
   * decision, not an accident of what the code happened to assume.
   */
  async configuration(
    companyId: string,
    on: Date,
    client: Prisma.TransactionClient | PrismaService,
  ) {
    const day = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()));

    const config = await client.taxConfiguration.findFirst({
      where: {
        companyId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!config) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `No tax configuration is effective for this company on ` +
          `${day.toISOString().slice(0, 10)}. Rounding and the withholding basis are ` +
          `policy decisions the engine will not make on the company's behalf.`,
        { companyId, date: day.toISOString().slice(0, 10) },
      );
    }
    return config;
  }

  /** The GL account a tax code posts to, in one direction, on a date. */
  async glAccountFor(
    companyId: string,
    taxCodeId: string,
    direction: string,
    on: Date,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    const day = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()));

    const mapping = await client.taxGLMapping.findFirst({
      where: {
        companyId,
        taxCodeId,
        direction,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!mapping) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `No GL account is mapped for this tax code in the ${direction} direction on ` +
          `${day.toISOString().slice(0, 10)}. Tax cannot post to an account nobody chose.`,
        { taxCodeId, direction },
      );
    }
    return mapping.glAccountId;
  }

  // -------------------------------------------------------------------------

  /**
   * The single rounding point (Rule 1). Everything upstream stays at full
   * decimal precision; this is where a value becomes money.
   */
  private round(value: Decimal, rule: RoundingRule): bigint {
    const mode: Record<RoundingRule, Decimal.Rounding> = {
      HALF_UP: Decimal.ROUND_HALF_UP,
      HALF_EVEN: Decimal.ROUND_HALF_EVEN,
      DOWN: Decimal.ROUND_DOWN,
      UP: Decimal.ROUND_UP,
    };
    return BigInt(value.toDecimalPlaces(0, mode[rule]).toFixed(0));
  }
}
