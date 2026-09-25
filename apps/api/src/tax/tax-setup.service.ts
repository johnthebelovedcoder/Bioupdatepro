import { Injectable } from '@nestjs/common';
import { AuditAction, WhtBasis } from '@bioassetpro/database';
import { chartVersionOf, numberFor, type ChartVersion } from '../chart/chart';
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

/** The four tax control accounts, on the company's own chart (chart.ts). */
const TAX_ROLES = ['inputVat', 'whtReceivable', 'outputVat', 'whtPayable'] as const;
function taxAccounts(version: ChartVersion) {
  return Object.fromEntries(TAX_ROLES.map((role) => [role, numberFor(version, role)])) as Record<(typeof TAX_ROLES)[number], string>;
}

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

    const ACCOUNTS = taxAccounts(await chartVersionOf(this.prisma, companyId));
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

  /**
   * Correct the company's TIN and VAT registration number.
   *
   * Edited in place rather than as a new effective-dated row: these identify
   * the company, they do not change how any tax is calculated, and a return
   * should carry the right number whenever it is printed. The old and new
   * values go to the audit trail, so a change is still traceable.
   */
  async updateIdentifiers(params: {
    companyId: string;
    actorId: string;
    tin?: string | null;
    vatRegistrationNumber?: string | null;
  }) {
    const config = await this.prisma.taxConfiguration.findFirst({
      where: { companyId: params.companyId, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!config) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax configuration',
        'Tax is not set up for this company yet. Set it up first, then add its identifiers.',
        {},
      );
    }

    const tin = params.tin?.trim() || null;
    const vatRegistrationNumber = params.vatRegistrationNumber?.trim() || null;
    if (tin === config.tin && vatRegistrationNumber === config.vatRegistrationNumber) {
      return this.status(params.companyId);
    }

    await this.prisma.taxConfiguration.update({
      where: { id: config.id },
      data: { tin, vatRegistrationNumber },
    });

    await this.audit.write({
      transactionId: config.id,
      module: 'tax',
      entityType: 'TaxConfiguration',
      entityId: config.id,
      status: 'ACTIVE',
      action: AuditAction.UPDATE,
      userId: params.actorId,
      comments: 'Updated the company TIN and VAT registration number.',
      oldValue: { tin: config.tin, vatRegistrationNumber: config.vatRegistrationNumber },
      newValue: { tin, vatRegistrationNumber },
    });

    return this.status(params.companyId);
  }

  // -------------------------------------------------------------------------
  // Codes and rates
  // -------------------------------------------------------------------------

  /** Every tax code with its full rate history, newest rate first. */
  async listCodes(companyId: string) {
    const codes = await this.prisma.taxCode.findMany({
      where: { companyId },
      orderBy: [{ taxType: 'asc' }, { code: 'asc' }],
      include: { rates: { orderBy: { effectiveFrom: 'desc' } } },
    });
    const today = startOfDay(new Date());
    return codes.map((code) => {
      const current = code.rates.find(
        (r) => r.effectiveFrom <= today && (r.effectiveTo === null || r.effectiveTo >= today),
      );
      return {
        id: code.id,
        code: code.code,
        name: code.name,
        taxType: code.taxType,
        treatment: code.treatment,
        recoverable: code.recoverable,
        whtCategory: code.whtCategory,
        active: code.active,
        currentRate: current?.rate.toString() ?? null,
        rates: code.rates.map((r) => ({
          id: r.id,
          rate: r.rate.toString(),
          effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: r.effectiveTo?.toISOString().slice(0, 10) ?? null,
          sourceReference: r.sourceReference,
        })),
      };
    });
  }

  /**
   * Add a tax code — a VAT treatment or WHT category the defaults lack. It
   * posts to the same control accounts as every other code of its type.
   */
  async createCode(params: {
    companyId: string;
    actorId: string;
    taxType: 'VAT' | 'WHT';
    code: string;
    name: string;
    treatment?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
    whtCategory?: string | null;
    rate: string;
    effectiveFrom: string;
    sourceReference: string;
  }) {
    const code = String(params.code ?? '').trim().toUpperCase();
    const name = String(params.name ?? '').trim();
    const sourceReference = String(params.sourceReference ?? '').trim();
    if (params.taxType !== 'VAT' && params.taxType !== 'WHT') {
      throw new AccountingRuleViolation('Consolidated Reference §4 — Tax codes', 'A code is either VAT or WHT.', {});
    }
    if (!code || !name) {
      throw new AccountingRuleViolation('Consolidated Reference §4 — Tax codes', 'Give the code a code and a name.', {});
    }
    if (!sourceReference) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax rates',
        'Say where the rate comes from — the Act, a circular, the adviser. A rate with no source is a guess.',
        {},
      );
    }
    const rate = parseRate(params.rate);
    const from = parseDay(params.effectiveFrom);
    const treatment = params.taxType === 'VAT' ? (params.treatment ?? 'STANDARD') : 'STANDARD';
    const whtCategory = params.taxType === 'WHT' ? params.whtCategory?.trim() || name : null;

    const clash = await this.prisma.taxCode.findUnique({
      where: { companyId_code: { companyId: params.companyId, code } },
    });
    if (clash) {
      throw new AccountingRuleViolation('Consolidated Reference §4 — Tax codes', `${code} already exists.`, { code });
    }

    const ACCOUNTS = taxAccounts(await chartVersionOf(this.prisma, params.companyId));
    const pair =
      params.taxType === 'VAT'
        ? [
            { direction: 'INPUT', number: ACCOUNTS.inputVat },
            { direction: 'OUTPUT', number: ACCOUNTS.outputVat },
          ]
        : [
            { direction: 'RECEIVABLE', number: ACCOUNTS.whtReceivable },
            { direction: 'PAYABLE', number: ACCOUNTS.whtPayable },
          ];
    const accounts = await this.prisma.gLAccount.findMany({
      where: {
        companyId: params.companyId,
        accountNumber: { in: pair.map((p) => p.number) },
        active: true,
      },
      select: { id: true, accountNumber: true },
    });
    const byNumber = new Map(accounts.map((a) => [a.accountNumber, a.id]));
    const missing = pair.filter((p) => !byNumber.has(p.number)).map((p) => p.number);
    if (missing.length > 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax GL mapping',
        `This chart of accounts has no active ${missing.join(', ')} for ${params.taxType} to post to.`,
        { missing },
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const taxCode = await tx.taxCode.create({
        data: {
          companyId: params.companyId,
          code,
          name,
          taxType: params.taxType,
          treatment,
          priceBasis: 'EXCLUSIVE',
          // Exempt and out-of-scope carry no recoverable input tax — that is
          // the whole difference between them and zero-rated.
          recoverable: treatment === 'STANDARD' || treatment === 'ZERO_RATED',
          whtCategory,
        },
      });
      await tx.taxRate.create({
        data: { taxCodeId: taxCode.id, rate, effectiveFrom: from, sourceReference },
      });
      await tx.taxGLMapping.createMany({
        data: pair.map((p) => ({
          companyId: params.companyId,
          taxCodeId: taxCode.id,
          direction: p.direction,
          glAccountId: byNumber.get(p.number)!,
          effectiveFrom: from,
        })),
      });
      return taxCode;
    });

    await this.audit.write({
      transactionId: created.id,
      module: 'tax',
      entityType: 'TaxCode',
      entityId: created.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actorId,
      comments: `Added ${params.taxType} code ${code} at ${rate}, from ${params.effectiveFrom}.`,
      newValue: { code, name, treatment, whtCategory, rate, effectiveFrom: params.effectiveFrom, sourceReference },
    });
    return { id: created.id, code: created.code };
  }

  /**
   * A new rate for an existing code, from a date. The rate in force until
   * then is closed the day before, so every past calculation still
   * reproduces. Refused where it would reach back into a tax period already
   * closed or filed — that return was made on the old rate.
   */
  async setRate(params: {
    companyId: string;
    actorId: string;
    taxCodeId: string;
    rate: string;
    effectiveFrom: string;
    sourceReference: string;
  }) {
    const sourceReference = String(params.sourceReference ?? '').trim();
    if (!sourceReference) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax rates',
        'Say where the new rate comes from — the Act, a circular, the adviser.',
        {},
      );
    }
    const rate = parseRate(params.rate);
    const from = parseDay(params.effectiveFrom);

    const code = await this.prisma.taxCode.findFirstOrThrow({
      where: { id: params.taxCodeId, companyId: params.companyId },
      include: { rates: { orderBy: { effectiveFrom: 'desc' } } },
    });

    const latest = code.rates[0];
    if (latest && from <= latest.effectiveFrom) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax rates',
        `${code.code} already has a rate from ${latest.effectiveFrom.toISOString().slice(0, 10)}. ` +
          'A new rate has to start after it — rate history is added to, never rewritten.',
        { latestFrom: latest.effectiveFrom.toISOString().slice(0, 10) },
      );
    }

    const lockedPeriod = await this.prisma.taxPeriod.findFirst({
      where: {
        companyId: params.companyId,
        taxType: code.taxType,
        status: { in: ['CLOSED', 'FILED'] },
        endDate: { gte: from },
      },
      orderBy: { endDate: 'desc' },
    });
    if (lockedPeriod) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax periods',
        `${lockedPeriod.name} is ${lockedPeriod.status.toLowerCase()} for ${code.taxType}, and a rate ` +
          `from ${params.effectiveFrom} would change figures inside it. Start the new rate after ` +
          `${lockedPeriod.endDate.toISOString().slice(0, 10)}.`,
        { taxPeriodId: lockedPeriod.id },
      );
    }

    const dayBefore = new Date(from);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

    await this.prisma.$transaction(async (tx) => {
      await tx.taxRate.updateMany({
        where: { taxCodeId: code.id, effectiveTo: null },
        data: { effectiveTo: dayBefore },
      });
      await tx.taxRate.create({
        data: { taxCodeId: code.id, rate, effectiveFrom: from, sourceReference },
      });
    });

    await this.audit.write({
      transactionId: code.id,
      module: 'tax',
      entityType: 'TaxRate',
      entityId: code.id,
      status: 'ACTIVE',
      action: AuditAction.UPDATE,
      userId: params.actorId,
      comments: `${code.code} rate set to ${rate} from ${params.effectiveFrom}.`,
      oldValue: latest
        ? { rate: latest.rate.toString(), effectiveFrom: latest.effectiveFrom.toISOString().slice(0, 10) }
        : null,
      newValue: { rate, effectiveFrom: params.effectiveFrom, sourceReference },
    });

    return { code: code.code, rate, effectiveFrom: params.effectiveFrom };
  }

  /** Stop offering a code on new documents, or bring one back. History is untouched. */
  async setActive(params: {
    companyId: string;
    actorId: string;
    taxCodeId: string;
    active: boolean;
  }) {
    const code = await this.prisma.taxCode.findFirstOrThrow({
      where: { id: params.taxCodeId, companyId: params.companyId },
    });
    const active = params.active === true;
    if (code.active === active) return { code: code.code, active };

    await this.prisma.taxCode.update({ where: { id: code.id }, data: { active } });
    await this.audit.write({
      transactionId: code.id,
      module: 'tax',
      entityType: 'TaxCode',
      entityId: code.id,
      status: active ? 'ACTIVE' : 'INACTIVE',
      action: AuditAction.UPDATE,
      userId: params.actorId,
      comments: `${code.code} ${active ? 'reactivated' : 'deactivated'}.`,
    });
    return { code: code.code, active };
  }
}

/** A rate as a fraction ("0.07500000"), from a percentage typed by a person ("7.5"). */
function parseRate(input: string): string {
  const text = String(input ?? '').trim();
  const percent = Number(text);
  if (text === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new AccountingRuleViolation(
      'Consolidated Reference §4 — Tax rates',
      'Enter the rate as a percentage between 0 and 100, e.g. 7.5.',
      {},
    );
  }
  return (percent / 100).toFixed(8);
}

function parseDay(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input ?? '').trim());
  const day = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null;
  if (!day || Number.isNaN(day.getTime())) {
    throw new AccountingRuleViolation(
      'Consolidated Reference §4 — Tax rates',
      'Give the date as YYYY-MM-DD.',
      {},
    );
  }
  return day;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
