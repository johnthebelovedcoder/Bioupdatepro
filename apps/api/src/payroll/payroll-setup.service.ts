import { Injectable } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Turning payroll on for a company.
 *
 * §7.2's statutory engine correctly refuses to run without a
 * `StatutoryConfiguration` rather than assume one — but nothing ever created
 * that row for a company signed up through the real onboarding flow, only
 * for the ones `seed.ts` builds by hand. A farm that signs up, adds staff and
 * tries to run payroll hits "No statutory payroll configuration is effective"
 * with no way to fix it from a screen.
 *
 * This is deliberately NOT a form. PAYE bands, pension/NHF/NSITF/ITF rates and
 * reliefs are not business preferences — they are the law, already verified
 * against the client's workbook — and a free-text field for a statutory rate
 * is exactly the shape of mistake Rule 10 exists to prevent. The one real
 * decision a company makes here is `nhfCompanyParticipation` (Company_Setup
 * B9): NHF is opt-in for the private sector, and that IS a company's call.
 *
 * The figures below are the SAME ones `packages/database/src/payroll-defaults
 * .ts` gives `seed.ts` — copied rather than imported, because
 * `@bioassetpro/database`'s package.json points `main`/`types` straight at
 * the generated Prisma client, not at that file, so nothing under
 * `packages/database/src` is actually reachable from `apps/api` at the
 * package boundary (confirmed the hard way: a clean `tsc --noEmit` run
 * passed against a version of this file that could not compile, because it
 * shares `dist/tsconfig.tsbuildinfo` with the running `nest --watch` process
 * and was reading its cache). If the rates in `payroll-defaults.ts` ever
 * change, this block has to change with it — there is no compiler check
 * tying the two together.
 */
const PAYROLL_EFFECTIVE_FROM = new Date('2026-01-01');
const NIGERIA_PAYE_2026_SOURCE =
  'Nigeria_PAYE_2026 workbook, Tax_Bands sheet (Nigeria Tax Act 2025)';
const NIGERIA_PAYE_2026_BANDS = [
  { order: 1, lower: 0n, upper: 800_000_00n, width: 800_000_00n, rate: '0.00000000' },
  { order: 2, lower: 800_000_00n, upper: 3_000_000_00n, width: 2_200_000_00n, rate: '0.15000000' },
  { order: 3, lower: 3_000_000_00n, upper: 12_000_000_00n, width: 9_000_000_00n, rate: '0.18000000' },
  { order: 4, lower: 12_000_000_00n, upper: 25_000_000_00n, width: 13_000_000_00n, rate: '0.21000000' },
  { order: 5, lower: 25_000_000_00n, upper: 50_000_000_00n, width: 25_000_000_00n, rate: '0.23000000' },
  { order: 6, lower: 50_000_000_00n, upper: null, width: null, rate: '0.25000000' },
] as const;
const NIGERIA_PAYE_2026_CONFIG = {
  minimumWageMonthlyKobo: 70_000_00n,
  rentReliefRate: '0.20000000',
  rentReliefCapKobo: 500_000_00n,
  pensionReliefRate: '0.08000000',
  rounding: 'HALF_UP' as const,
  ruleVersion: 'NTA-2025-2026.01',
  sourceReference:
    'Nigeria_PAYE_2026 workbook, PAYE_Rules sheet. NOTE: the Consolidated ' +
    'Relief Allowance is deliberately absent — it was removed under this ' +
    'framework and rent relief replaces it.',
};
const NIGERIA_STATUTORY_2026_CONFIG = {
  pensionFunding: 'SPLIT_8_10' as const,
  pensionEmployeeRate: '0.08000000',
  pensionEmployerRate: '0.10000000',
  pensionCombinedRate: '0.18000000',
  pensionMinEmployees: 3,
  nhfRate: '0.02500000',
  nsitfRate: '0.01000000',
  itfRate: '0.01000000',
  itfMinEmployees: 5,
  minimumWageMonthlyKobo: 70_000_00n,
  sourceReference: 'Nigeria_Statutory_Payroll workbook, Statutory_Rules and Company_Setup sheets',
};
@Injectable()
export class PayrollSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async status(companyId: string, on: Date = new Date()) {
    const [bands, paye, statutory] = await Promise.all([
      this.prisma.payeBand.count({ where: { companyId } }),
      this.prisma.payeConfiguration.findFirst({
        where: { companyId, effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] },
      }),
      this.prisma.statutoryConfiguration.findFirst({
        where: { companyId, effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] },
      }),
    ]);

    return {
      active: bands > 0 && paye !== null && statutory !== null,
      payeBandCount: bands,
      ruleVersion: paye?.ruleVersion ?? null,
      nhfCompanyParticipation: statutory?.nhfCompanyParticipation ?? null,
      effectiveFrom: (paye ?? statutory)?.effectiveFrom?.toISOString() ?? null,
    };
  }

  /**
   * Idempotent, matching `seedPayroll`'s own shape: a company that already
   * has an open-ended configuration is left alone rather than superseded,
   * since superseding is a rate CHANGE (a new effective-dated row) and this
   * is only ever the first-time activation.
   */
  async activate(params: {
    companyId: string;
    nhfCompanyParticipation: boolean;
    actorId: string;
  }) {
    const { companyId, nhfCompanyParticipation, actorId } = params;
    const from = PAYROLL_EFFECTIVE_FROM;

    const existingBands = await this.prisma.payeBand.count({ where: { companyId } });
    if (existingBands === 0) {
      for (const band of NIGERIA_PAYE_2026_BANDS) {
        await this.prisma.payeBand.create({
          data: {
            companyId,
            bandOrder: band.order,
            lowerLimitKobo: band.lower,
            upperLimitKobo: band.upper,
            bandWidthKobo: band.width,
            rate: band.rate,
            effectiveFrom: from,
            sourceReference: NIGERIA_PAYE_2026_SOURCE,
          },
        });
      }
    }

    const existingPaye = await this.prisma.payeConfiguration.findFirst({
      where: { companyId, effectiveTo: null },
    });
    if (!existingPaye) {
      await this.prisma.payeConfiguration.create({
        data: { companyId, effectiveFrom: from, ...NIGERIA_PAYE_2026_CONFIG },
      });
    }

    const existingStatutory = await this.prisma.statutoryConfiguration.findFirst({
      where: { companyId, effectiveTo: null },
    });
    if (!existingStatutory) {
      await this.prisma.statutoryConfiguration.create({
        data: {
          companyId,
          effectiveFrom: from,
          ...NIGERIA_STATUTORY_2026_CONFIG,
          nhfCompanyParticipation,
        },
      });
    }

    await this.audit.write({
      transactionId: companyId,
      module: 'payroll',
      entityType: 'StatutoryConfiguration',
      entityId: companyId,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: actorId,
      comments:
        `Payroll activated — NTA-2025-2026.01 rates, effective ${from.toISOString().slice(0, 10)}. ` +
        `NHF participation: ${nhfCompanyParticipation ? 'on' : 'off'}.`,
    });

    return this.status(companyId);
  }
}
