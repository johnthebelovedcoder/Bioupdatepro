import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PensionFundingModel, RoundingRule } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';

export interface StatutoryCalculationInput {
  companyId: string;
  /** MONEY. Total monthly emoluments — the NHF and NSITF base. */
  grossPayKobo: bigint;
  /** MONEY. Basic + housing + transport — the PENSION base, not gross. */
  pensionableEmolumentsKobo: bigint;
  pensionEnrolled: boolean;
  nhfEnrolled: boolean;
  /** Headcount as at the run, which drives the applicability tests. */
  employeeCount: number;
  on: Date;
}

export interface StatutoryCalculation {
  employeePensionKobo: string;
  employerPensionKobo: string;
  nhfKobo: string;
  nsitfKobo: string;
  itfKobo: string;
  /** What the employer bears beyond gross pay. */
  totalEmployerCostKobo: string;
  applicability: {
    pensionApplicable: boolean;
    pensionReason: string;
    nhfEligible: boolean;
    nhfReason: string;
    itfApplicable: boolean;
    itfReason: string;
  };
}

/**
 * The statutory payroll engine — NHF, ITF, NSITF and pension (§7.2).
 *
 * Replicates the Nigeria_Statutory_Payroll workbook's Payroll_Calculation
 * sheet. Every rate and threshold comes from effective-dated configuration.
 *
 * THE ONE THING MOST EASILY GOT WRONG, STATED BY THE SOURCE ITSELF: the pension
 * base is Basic + Housing + Transport, NOT gross pay. The workbook's
 * Developer_Logic sheet says "Do not calculate pension on gross pay by default",
 * and the two bases are separate parameters here so they cannot be confused —
 * NHF and NSITF genuinely do use gross, and passing one where the other belongs
 * would be silently wrong rather than a type error.
 *
 * NSITF is employer-only. The workbook is explicit that deducting it from an
 * employee is prohibited, so there is no employee-side NSITF field to populate
 * by accident.
 */
@Injectable()
export class StatutoryEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(input: StatutoryCalculationInput): Promise<StatutoryCalculation> {
    const config = await this.configuration(input.companyId, input.on);

    // --- Pension ----------------------------------------------------------
    // Applies where the company meets the headcount test AND the employee is
    // enrolled. Both must hold; neither alone is enough.
    const headcountOk = input.employeeCount >= config.pensionMinEmployees;
    const pensionApplicable = headcountOk && input.pensionEnrolled;

    let employeePension = 0n;
    let employerPension = 0n;

    if (pensionApplicable) {
      const base = new Decimal(input.pensionableEmolumentsKobo.toString());

      if (config.pensionFunding === PensionFundingModel.EMPLOYER_PAYS_ALL_18) {
        // The employer funds the whole combined contribution; the employee
        // deduction becomes zero rather than being netted off elsewhere.
        employeePension = 0n;
        employerPension = this.round(
          base.mul(new Decimal(config.pensionCombinedRate.toString())),
          RoundingRule.HALF_UP,
        );
      } else {
        employeePension = this.round(
          base.mul(new Decimal(config.pensionEmployeeRate.toString())),
          RoundingRule.HALF_UP,
        );
        employerPension = this.round(
          base.mul(new Decimal(config.pensionEmployerRate.toString())),
          RoundingRule.HALF_UP,
        );
      }
    }

    // --- NHF --------------------------------------------------------------
    // Private-sector participation is voluntary at BOTH levels: the company
    // must have enabled the scheme and the employee must have enrolled. An
    // absent flag means do not deduct — never deduct by default.
    const aboveMinimumWage = input.grossPayKobo >= config.minimumWageMonthlyKobo;
    const nhfEligible =
      config.nhfCompanyParticipation && input.nhfEnrolled && aboveMinimumWage;

    const nhf = nhfEligible
      ? this.round(
          new Decimal(input.grossPayKobo.toString()).mul(
            new Decimal(config.nhfRate.toString()),
          ),
          RoundingRule.HALF_UP,
        )
      : 0n;

    // --- NSITF (employer only, no applicability test) ----------------------
    const nsitf = this.round(
      new Decimal(input.grossPayKobo.toString()).mul(
        new Decimal(config.nsitfRate.toString()),
      ),
      RoundingRule.HALF_UP,
    );

    // --- ITF --------------------------------------------------------------
    // Headcount threshold AND not in a free trade zone. The FTZ flag lives on
    // the company master, which is where a company-level fact belongs.
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: input.companyId },
      select: { freeTradeZone: true },
    });
    const itfApplicable =
      input.employeeCount >= config.itfMinEmployees && !company.freeTradeZone;

    const itf = itfApplicable
      ? this.round(
          new Decimal(input.grossPayKobo.toString()).mul(
            new Decimal(config.itfRate.toString()),
          ),
          RoundingRule.HALF_UP,
        )
      : 0n;

    return {
      employeePensionKobo: employeePension.toString(),
      employerPensionKobo: employerPension.toString(),
      nhfKobo: nhf.toString(),
      nsitfKobo: nsitf.toString(),
      itfKobo: itf.toString(),
      totalEmployerCostKobo: (employerPension + nsitf + itf).toString(),
      applicability: {
        pensionApplicable,
        pensionReason: pensionApplicable
          ? `Company has ${input.employeeCount} employees (threshold ${config.pensionMinEmployees}) and the employee is enrolled.`
          : !headcountOk
            ? `Company has ${input.employeeCount} employees, below the threshold of ${config.pensionMinEmployees}.`
            : 'Employee is not enrolled in an approved pension scheme.',
        nhfEligible,
        nhfReason: nhfEligible
          ? 'Company participation enabled, employee enrolled, gross at or above the minimum wage.'
          : !config.nhfCompanyParticipation
            ? 'Company has not enabled NHF participation.'
            : !input.nhfEnrolled
              ? 'Employee has not opted in to NHF.'
              : `Gross pay is below the minimum wage of ${config.minimumWageMonthlyKobo} kobo.`,
        itfApplicable,
        itfReason: itfApplicable
          ? `Company has ${input.employeeCount} employees (threshold ${config.itfMinEmployees}) and is not in a free trade zone.`
          : company.freeTradeZone
            ? 'Company operates in a free trade zone.'
            : `Company has ${input.employeeCount} employees, below the threshold of ${config.itfMinEmployees}.`,
      },
    };
  }

  async configuration(companyId: string, on: Date) {
    const day = new Date(
      Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()),
    );

    const config = await this.prisma.statutoryConfiguration.findFirst({
      where: {
        companyId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!config) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7.2 — Statutory configuration',
        `No statutory payroll configuration is effective on ` +
          `${day.toISOString().slice(0, 10)}. Pension, NHF, NSITF and ITF rates are ` +
          `statutory figures; the engine will not assume them.`,
        { companyId, date: day.toISOString().slice(0, 10) },
      );
    }
    return config;
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
