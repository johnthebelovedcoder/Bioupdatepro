import { Injectable } from '@nestjs/common';
import { AuditAction, WhtBasis } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';

/**
 * Turning tax on for a company.
 *
 * The tax engine correctly refuses to calculate anything without an effective
 * `TaxConfiguration`, and refuses a document dated outside any tax period —
 * but nothing ever created either for a company signed up through the real
 * onboarding flow, only for the one `seed.ts` builds by hand. A farm that
 * signed up could not raise a VAT invoice, and "Set up a year" on the Tax
 * screen failed with "No tax configuration is effective".
 *
 * Same shape as `PayrollSetupService`, for the same reason: VAT rates and WHT
 * rates are the law, not preferences, so they are not form fields. The one
 * genuine policy choice is `whtBasis` — whether withholding is computed on the
 * amount before or after VAT, which no source document states — and it is
 * taken from the person setting this up and recorded with their name as the
 * authority, never defaulted.
 *
 * The codes, rates and account mappings below are the SAME ones
 * `packages/database/src/seed.ts` (`seedTax`, `seedStatutoryRates`) gives the
 * demo company — copied rather than imported, for the package-boundary reason
 * `payroll-setup.service.ts` explains. If either changes, change both.
 */
const TAX_EFFECTIVE_FROM = new Date('2026-01-01');

/** The four control accounts every signed-up company is provisioned with. */
const ACCOUNTS = {
  inputVat: '1601',
  whtReceivable: '1602',
  outputVat: '2120',
  whtPayable: '2130',
} as const;

const VAT_CODES = [
  {
    code: 'VAT-STD',
    name: 'VAT standard rated',
    treatment: 'STANDARD' as const,
    recoverable: true,
    rate: '0.07500000',
    source: 'Value Added Tax Act as amended by Finance Act 2019 — 7.5%',
  },
  {
    code: 'VAT-ZERO',
    name: 'VAT zero rated',
    treatment: 'ZERO_RATED' as const,
    recoverable: true,
    rate: '0.00000000',
    source: 'Zero-rated supplies: no output tax, input tax recoverable',
  },
  {
    code: 'VAT-EXEMPT',
    name: 'VAT exempt',
    treatment: 'EXEMPT' as const,
    // Many basic agricultural products are exempt in Nigeria — which of a
    // farm's own products qualify is its tax adviser's call, not ours.
    recoverable: false,
    rate: '0.00000000',
    source: 'Exempt supplies: no output tax, input tax NOT recoverable',
  },
  {
    code: 'VAT-OOS',
    name: 'Outside the scope of VAT',
    treatment: 'OUT_OF_SCOPE' as const,
    recoverable: false,
    rate: '0.00000000',
    source: 'Non-supply transactions (e.g. payroll, internal transfers)',
  },
];

const WHT_SOURCE =
  'Deduction of Tax at Source (Withholding) Regulations 2024 (effective 2025-01-01), ' +
  'resident recipients. Confirm with the company tax adviser.';

/** Resident rates. Non-resident rates are treaty-dependent and not assumed. */
const WHT_CODES = [
  { code: 'WHT-CONTRACT', name: 'WHT — contracts and supplies', category: 'Contracts/Supplies', rate: '0.02000000' },
  { code: 'WHT-SERVICES', name: 'WHT — professional services', category: 'Professional Services', rate: '0.05000000' },
  { code: 'WHT-RENT', name: 'WHT — rent', category: 'Rent', rate: '0.10000000' },
  { code: 'WHT-COMMISSION', name: 'WHT — commission', category: 'Commission', rate: '0.05000000' },
  { code: 'WHT-DIVIDEND', name: 'WHT — dividends', category: 'Dividends', rate: '0.10000000' },
  { code: 'WHT-INTEREST', name: 'WHT — interest', category: 'Interest', rate: '0.10000000' },
  { code: 'WHT-ROYALTY', name: 'WHT — royalties', category: 'Royalties', rate: '0.05000000' },
];

@Injectable()
export class TaxSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async status(companyId: string, on: Date = new Date()) {
    const [config, vatCodes, whtCodes, unratedWht] = await Promise.all([
      this.prisma.taxConfiguration.findFirst({
        where: {
          companyId,
          effectiveFrom: { lte: on },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
        },
      }),
      this.prisma.taxCode.count({ where: { companyId, taxType: 'VAT', active: true } }),
      this.prisma.taxCode.count({ where: { companyId, taxType: 'WHT', active: true } }),
      this.prisma.taxCode.count({
        where: { companyId, taxType: 'WHT', active: true, rates: { none: {} } },
      }),
    ]);

    return {
      configured: config !== null && vatCodes > 0,
      whtBasis: config?.whtBasis ?? null,
      whtBasisAuthority: config?.whtBasisAuthority ?? null,
      tin: config?.tin ?? null,
      vatRegistrationNumber: config?.vatRegistrationNumber ?? null,
      vatFilingIntervalMonths: config?.vatFilingIntervalMonths ?? null,
      vatFilingDueDayOfMonth: config?.vatFilingDueDayOfMonth ?? null,
      effectiveFrom: config?.effectiveFrom?.toISOString() ?? null,
      vatCodeCount: vatCodes,
      whtCodeCount: whtCodes,
      whtCodesWithoutRate: unratedWht,
    };
  }

  /**
   * Idempotent. A company that already has an open-ended configuration keeps
   * it — changing a tax policy is a new effective-dated row, not this — and
   * codes, rates and mappings that already exist are left alone.
   */
  async activate(params: {
    companyId: string;
    actorId: string;
    whtBasis: WhtBasis;
    tin?: string | null;
    vatRegistrationNumber?: string | null;
  }) {
    const { companyId, actorId } = params;
    if (params.whtBasis !== 'NET_OF_VAT' && params.whtBasis !== 'GROSS_INCLUDING_VAT') {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax configuration',
        'Say whether withholding tax is computed before VAT or including it. ' +
          'The two give different amounts and neither is assumed.',
        {},
      );
    }

    const accounts = await this.prisma.gLAccount.findMany({
      where: { companyId, accountNumber: { in: Object.values(ACCOUNTS) }, active: true },
      select: { id: true, accountNumber: true },
    });
    const byNumber = new Map(accounts.map((a) => [a.accountNumber, a.id]));
    const missing = Object.values(ACCOUNTS).filter((n) => !byNumber.has(n));
    if (missing.length > 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax GL mapping',
        `Tax cannot be set up: this chart of accounts has no active ${missing.join(', ')}. ` +
          'VAT and withholding tax need their own control accounts to post to.',
        { missing },
      );
    }
    const account = (n: string) => byNumber.get(n)!;
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { fullName: true, email: true },
    });
    const actorName = actor?.fullName || actor?.email || actorId;
    const from = TAX_EFFECTIVE_FROM;

    const result = await this.prisma.$transaction(async (tx) => {
      let configCreated = false;
      const existingConfig = await tx.taxConfiguration.findFirst({
        where: { companyId, effectiveTo: null },
      });
      if (!existingConfig) {
        await tx.taxConfiguration.create({
          data: {
            companyId,
            rounding: 'HALF_UP',
            whtBasis: params.whtBasis,
            whtBasisAuthority:
              `Chosen by ${actorName} in Tax setup on ` +
              `${new Date().toISOString().slice(0, 10)}. Confirm with the company tax adviser.`,
            tin: params.tin?.trim() || null,
            vatRegistrationNumber: params.vatRegistrationNumber?.trim() || null,
            // Nigerian VAT is filed monthly, due the 21st of the following month.
            vatFilingIntervalMonths: 1,
            vatFilingDueDayOfMonth: 21,
            effectiveFrom: from,
          },
        });
        configCreated = true;
      }

      let codesCreated = 0;
      let ratesCreated = 0;

      const ensureMapping = async (taxCodeId: string, direction: string, glAccountId: string) => {
        const mapped = await tx.taxGLMapping.findFirst({
          where: { companyId, taxCodeId, direction },
        });
        if (!mapped) {
          await tx.taxGLMapping.create({
            data: { companyId, taxCodeId, direction, glAccountId, effectiveFrom: from },
          });
        }
      };
      const ensureRate = async (taxCodeId: string, rate: string, sourceReference: string) => {
        const existing = await tx.taxRate.findFirst({ where: { taxCodeId } });
        if (!existing) {
          await tx.taxRate.create({
            data: { taxCodeId, rate, effectiveFrom: from, sourceReference },
          });
          ratesCreated += 1;
        }
      };

      for (const spec of VAT_CODES) {
        const existing = await tx.taxCode.findUnique({
          where: { companyId_code: { companyId, code: spec.code } },
        });
        const code =
          existing ??
          (await tx.taxCode.create({
            data: {
              companyId,
              code: spec.code,
              name: spec.name,
              taxType: 'VAT',
              treatment: spec.treatment,
              priceBasis: 'EXCLUSIVE',
              recoverable: spec.recoverable,
            },
          }));
        if (!existing) codesCreated += 1;
        await ensureRate(code.id, spec.rate, spec.source);
        await ensureMapping(code.id, 'INPUT', account(ACCOUNTS.inputVat));
        await ensureMapping(code.id, 'OUTPUT', account(ACCOUNTS.outputVat));
      }

      for (const spec of WHT_CODES) {
        const existing = await tx.taxCode.findUnique({
          where: { companyId_code: { companyId, code: spec.code } },
        });
        const code =
          existing ??
          (await tx.taxCode.create({
            data: {
              companyId,
              code: spec.code,
              name: spec.name,
              taxType: 'WHT',
              treatment: 'STANDARD',
              whtCategory: spec.category,
            },
          }));
        if (!existing) codesCreated += 1;
        await ensureRate(code.id, spec.rate, `${spec.name}. ${WHT_SOURCE}`);
        await ensureMapping(code.id, 'PAYABLE', account(ACCOUNTS.whtPayable));
        await ensureMapping(code.id, 'RECEIVABLE', account(ACCOUNTS.whtReceivable));
      }

      return { configCreated, codesCreated, ratesCreated };
      // Roughly seventy small writes; Prisma's 5s default is tight for that
      // on a free-tier database across a network hop.
    }, { timeout: 30_000 });

    // Written after the transaction, not inside it: the audit service does its
    // own lookup, and holding a transaction open across it is how a small
    // connection pool deadlocks.
    await this.audit.write({
      transactionId: companyId,
      module: 'tax',
      entityType: 'TaxConfiguration',
      entityId: companyId,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: actorId,
      comments:
        `Tax set up: WHT basis ${params.whtBasis}; ${result.codesCreated} tax code(s) and ` +
        `${result.ratesCreated} rate(s) added.`,
      metadata: { whtBasis: params.whtBasis, ...result },
    });

    return { ...result, status: await this.status(companyId) };
  }
}
