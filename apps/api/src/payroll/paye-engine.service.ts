import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma, RoundingRule } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';

export interface PayeBandResult {
  bandOrder: number;
  lowerLimitKobo: string;
  upperLimitKobo: string | null;
  rate: string;
  /** How much of the chargeable income fell in this band. */
  sliceKobo: string;
  taxKobo: string;
}

export interface PayeCalculationInput {
  companyId: string;
  /** MONEY. Monthly taxable earnings, from the employee's salary components. */
  monthlyTaxableGrossKobo: bigint;
  /** MONEY. Monthly pensionable emoluments — basic + housing + transport. */
  pensionableEmolumentsKobo: bigint;
  /** Whether the employee is enrolled in an approved pension scheme. */
  pensionEnrolled: boolean;
  /** MONEY, all ANNUAL. */
  annualBonusKobo?: bigint;
  annualRentKobo?: bigint;
  nhfAnnualKobo?: bigint;
  nhisAnnualKobo?: bigint;
  lifeAssuranceAnnualKobo?: bigint;
  mortgageInterestAnnualKobo?: bigint;
  /** §7.1: reliefs require evidence. Without it, none are granted. */
  documentsComplete?: boolean;
  on: Date;
}

export interface PayeCalculation {
  ruleVersion: string;
  annualGrossKobo: string;
  annualPensionReliefKobo: string;
  annualNhfReliefKobo: string;
  annualNhisReliefKobo: string;
  annualLifeAssuranceKobo: string;
  annualMortgageInterestKobo: string;
  rentReliefKobo: string;
  rentReliefCapApplied: boolean;
  totalReliefsKobo: string;
  chargeableIncomeKobo: string;
  bands: PayeBandResult[];
  annualPayeKobo: string;
  monthlyPayeKobo: string;
  effectiveRate: string;
  minimumWageExempt: boolean;
  reliefsWithheldForEvidence: boolean;
  explanation: string;
}

/**
 * The PAYE engine — Nigeria Tax Act 2025, effective 1 January 2026 (§7.1).
 *
 * Replicates the Nigeria_PAYE_2026 workbook's PAYE_Calculation sheet formula for
 * formula. The integration suite asserts against that workbook's own figures,
 * so if this and the workbook ever diverge, the test says so.
 *
 * TWO RULES THE SOURCE STATES EXPLICITLY, BOTH LOAD-BEARING HERE:
 *
 *   "Never apply the highest rate to the entire income." Tax is computed
 *   band by band and each band's slice is returned, not just the total — an
 *   employee who queries their payslip can be shown the working.
 *
 *   "Do not restore the former Consolidated Relief Allowance." There is no CRA
 *   here. Rent relief replaced it, and adding both would under-tax every
 *   employee who pays rent.
 *
 * ARITHMETIC: annual figures stay exact in integer kobo; only the two genuinely
 * fractional steps — the band rate and the divide-by-twelve — go through
 * decimal.js, and each rounds once (Rule 1).
 */
@Injectable()
export class PayeEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(input: PayeCalculationInput): Promise<PayeCalculation> {
    const config = await this.configuration(input.companyId, input.on);
    const bands = await this.bands(input.companyId, input.on);

    // --- Annual gross ----------------------------------------------------
    // Recurring monthly pay annualised, plus irregular annual income.
    const annualRecurring = input.monthlyTaxableGrossKobo * 12n;
    const annualGross = annualRecurring + (input.annualBonusKobo ?? 0n);

    // --- Reliefs ---------------------------------------------------------
    // §7.1: every relief must rest on an actual supported amount. Where the
    // documentation is incomplete we grant NONE of the evidence-based reliefs
    // rather than guessing which are supported — under-claiming is a
    // correctable overpayment, over-claiming is an under-remittance to the
    // revenue authority.
    const evidenceOk = input.documentsComplete !== false;

    const pensionRelief =
      input.pensionEnrolled
        ? this.round(
            new Decimal((input.pensionableEmolumentsKobo * 12n).toString()).mul(
              new Decimal(config.pensionReliefRate.toString()),
            ),
            config.rounding,
          )
        : 0n;

    const nhf = evidenceOk ? (input.nhfAnnualKobo ?? 0n) : 0n;
    const nhis = evidenceOk ? (input.nhisAnnualKobo ?? 0n) : 0n;
    const lifeAssurance = evidenceOk ? (input.lifeAssuranceAnnualKobo ?? 0n) : 0n;
    const mortgageInterest = evidenceOk ? (input.mortgageInterestAnnualKobo ?? 0n) : 0n;

    // Rent relief: the LOWER of (rent x rate) and the cap.
    const annualRent = evidenceOk ? (input.annualRentKobo ?? 0n) : 0n;
    let rentRelief = 0n;
    let capApplied = false;
    if (annualRent > 0n) {
      const proportional = this.round(
        new Decimal(annualRent.toString()).mul(
          new Decimal(config.rentReliefRate.toString()),
        ),
        config.rounding,
      );
      capApplied = proportional > config.rentReliefCapKobo;
      rentRelief = capApplied ? config.rentReliefCapKobo : proportional;
    }

    const totalReliefs =
      pensionRelief + nhf + nhis + lifeAssurance + mortgageInterest + rentRelief;

    // --- Chargeable income ------------------------------------------------
    const chargeable =
      annualGross > totalReliefs ? annualGross - totalReliefs : 0n;

    // --- Band-by-band tax -------------------------------------------------
    const bandResults: PayeBandResult[] = [];
    let annualTax = 0n;

    for (const band of bands) {
      // The slice of income falling inside this band: everything above its
      // lower limit, capped at its width.
      const above = chargeable > band.lowerLimitKobo
        ? chargeable - band.lowerLimitKobo
        : 0n;
      const width =
        band.upperLimitKobo !== null
          ? band.upperLimitKobo - band.lowerLimitKobo
          : null;
      const slice = width !== null && above > width ? width : above;

      const tax =
        slice > 0n
          ? this.round(
              new Decimal(slice.toString()).mul(new Decimal(band.rate.toString())),
              config.rounding,
            )
          : 0n;

      annualTax += tax;
      bandResults.push({
        bandOrder: band.bandOrder,
        lowerLimitKobo: band.lowerLimitKobo.toString(),
        upperLimitKobo: band.upperLimitKobo?.toString() ?? null,
        rate: new Decimal(band.rate.toString()).toFixed(8),
        sliceKobo: slice.toString(),
        taxKobo: tax.toString(),
      });
    }

    // --- Minimum wage exemption -------------------------------------------
    // Applied AFTER the band computation, not instead of it, so the payslip can
    // still show what would otherwise have been due.
    const exempt = input.monthlyTaxableGrossKobo <= config.minimumWageMonthlyKobo;
    if (exempt) annualTax = 0n;

    const monthlyPaye = this.round(
      new Decimal(annualTax.toString()).div(12),
      config.rounding,
    );

    const effectiveRate =
      annualGross > 0n
        ? new Decimal(annualTax.toString()).div(new Decimal(annualGross.toString()))
        : new Decimal(0);

    return {
      ruleVersion: config.ruleVersion,
      annualGrossKobo: annualGross.toString(),
      annualPensionReliefKobo: pensionRelief.toString(),
      annualNhfReliefKobo: nhf.toString(),
      annualNhisReliefKobo: nhis.toString(),
      annualLifeAssuranceKobo: lifeAssurance.toString(),
      annualMortgageInterestKobo: mortgageInterest.toString(),
      rentReliefKobo: rentRelief.toString(),
      rentReliefCapApplied: capApplied,
      totalReliefsKobo: totalReliefs.toString(),
      chargeableIncomeKobo: chargeable.toString(),
      bands: bandResults,
      annualPayeKobo: annualTax.toString(),
      monthlyPayeKobo: monthlyPaye.toString(),
      effectiveRate: effectiveRate.toFixed(6),
      minimumWageExempt: exempt,
      reliefsWithheldForEvidence: !evidenceOk,
      explanation: exempt
        ? `Monthly gross of ${input.monthlyTaxableGrossKobo} kobo is at or below the ` +
          `minimum wage threshold of ${config.minimumWageMonthlyKobo} kobo; no PAYE arises.`
        : `Chargeable income ${chargeable} kobo taxed across ${bandResults.length} bands ` +
          `under rule set ${config.ruleVersion}.` +
          (evidenceOk
            ? ''
            : ' Evidence-based reliefs were withheld: supporting documents are incomplete.'),
    };
  }

  /**
   * §7.1 YTD true-up.
   *
   * `expected_ytd_tax - prior_ytd_deductions`. Used for new hires, mid-year
   * salary changes and corrections, where twelve equal monthly instalments
   * would not arrive at the right annual figure.
   *
   * A NEGATIVE true-up means the employee has over-paid. It is returned rather
   * than clamped to zero, because §7.1 says a refund "requires authorised
   * workflow" — which it cannot get if the engine silently hides it.
   */
  trueUp(params: {
    annualPayeKobo: bigint;
    monthsWorked: number;
    priorYtdDeductedKobo: bigint;
  }): {
    expectedYtdKobo: string;
    currentMonthKobo: string;
    isRefund: boolean;
  } {
    if (params.monthsWorked < 1 || params.monthsWorked > 12) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7.1 — YTD reconciliation',
        `Months worked must be between 1 and 12; got ${params.monthsWorked}.`,
        { monthsWorked: params.monthsWorked },
      );
    }

    const expected =
      (params.annualPayeKobo * BigInt(params.monthsWorked)) / 12n;
    const current = expected - params.priorYtdDeductedKobo;

    return {
      expectedYtdKobo: expected.toString(),
      currentMonthKobo: current.toString(),
      isRefund: current < 0n,
    };
  }

  // -------------------------------------------------------------------------

  async configuration(companyId: string, on: Date) {
    const day = startOfDay(on);
    const config = await this.prisma.payeConfiguration.findFirst({
      where: {
        companyId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!config) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7.1 — PAYE configuration',
        `No PAYE configuration is effective on ${day.toISOString().slice(0, 10)}. ` +
          `The engine will not assume a minimum wage, a rent relief cap or a ` +
          `rounding rule — those are statutory figures, not defaults.`,
        { companyId, date: day.toISOString().slice(0, 10) },
      );
    }
    return config;
  }

  /**
   * The band set in force on a date.
   *
   * Refuses an empty set rather than returning zero tax. The database enforces
   * that the bands tile without gaps; this enforces that they exist at all.
   */
  async bands(companyId: string, on: Date) {
    const day = startOfDay(on);
    const bands = await this.prisma.payeBand.findMany({
      where: {
        companyId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { bandOrder: 'asc' }],
    });

    if (bands.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7.1 — Tax bands',
        `No PAYE bands are effective on ${day.toISOString().slice(0, 10)}. ` +
          `Refusing to compute PAYE against an empty band table, which would ` +
          `silently return zero tax for every employee.`,
        { companyId, date: day.toISOString().slice(0, 10) },
      );
    }

    // Only the most recent effective set, in band order.
    const latest = bands[0]!.effectiveFrom.getTime();
    const inForce = bands
      .filter((b) => b.effectiveFrom.getTime() === latest)
      .sort((a, b) => a.bandOrder - b.bandOrder);

    if (inForce[0]!.lowerLimitKobo !== 0n) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7.1 — Tax bands',
        `The lowest PAYE band starts at ${inForce[0]!.lowerLimitKobo} kobo rather than zero, ` +
          `so income below that would be untaxed by omission.`,
        { companyId },
      );
    }
    if (inForce[inForce.length - 1]!.upperLimitKobo !== null) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7.1 — Tax bands',
        `The highest PAYE band is bounded, so income above it would be untaxed.`,
        { companyId },
      );
    }

    return inForce;
  }

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

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
