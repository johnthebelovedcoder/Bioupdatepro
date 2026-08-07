import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PrismaClient,
  TaxPeriodStatus,
  TaxType,
  VatDirection,
  WhtDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { TaxEngineService } from '../../src/tax/tax-engine.service';
import { TaxRegisterService } from '../../src/tax/tax-register.service';
import { TaxPeriodService } from '../../src/tax/tax-period.service';
import { kobo } from '../../src/common/money';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Phase 3 — Tax Engine (Consolidated Reference §4).
 *
 * The accounting identity this phase must prove is the register/ledger
 * reconciliation: for every tax code and direction, the register total equals
 * the movement on the mapped GL control account. That is the tax equivalent of
 * Phase 1's trial balance and Phase 6's WIP-clearing test — if it holds, a VAT
 * return can be tied back to the accounts; if it does not, the return is
 * unsupportable however plausible its totals look.
 */
describe('Tax Engine (§4)', () => {
  let prisma: PrismaService;
  let engine: TaxEngineService;
  let registers: TaxRegisterService;
  let periods: TaxPeriodService;
  let posting: PostingService;
  let fixture: TestFixture;

  let vatStandardId: string;
  let vatExemptId: string;
  let whtContractId: string;
  let vatPeriodId: string;
  let whtPeriodId: string;

  const JAN = new Date('2026-01-15');

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const audit = new AuditService(prisma);
    const idempotency = new IdempotencyService(prisma);
    const periodService = new PeriodService(prisma);
    const dimensions = new DimensionValidatorService(prisma);
    posting = new PostingService(prisma, audit, idempotency, periodService, dimensions);

    engine = new TaxEngineService(prisma);
    registers = new TaxRegisterService(prisma, engine);
    periods = new TaxPeriodService(prisma, engine, registers, audit);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);

    await prisma.taxConfiguration.create({
      data: {
        companyId: fixture.companyId,
        rounding: 'HALF_UP',
        whtBasis: 'NET_OF_VAT',
        vatFilingIntervalMonths: 1,
        vatFilingDueDayOfMonth: 21,
        effectiveFrom: new Date('2026-01-01'),
      },
    });

    vatStandardId = await makeVatCode('VAT-STD', 'STANDARD', true, '0.07500000');
    await makeVatCode('VAT-ZERO', 'ZERO_RATED', true, '0.00000000');
    vatExemptId = await makeVatCode('VAT-EXEMPT', 'EXEMPT', false, '0.00000000');

    whtContractId = await makeWhtCode('WHT-CONTRACT', 'Contracts/Supplies');
    await makeWhtCode('WHT-NORATE', 'Unrated Category', null);

    vatPeriodId = await makeTaxPeriod(TaxType.VAT);
    whtPeriodId = await makeTaxPeriod(TaxType.WHT);
  });

  async function makeVatCode(
    code: string,
    treatment: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE',
    recoverable: boolean,
    rate: string,
    priceBasis: 'EXCLUSIVE' | 'INCLUSIVE' = 'EXCLUSIVE',
  ): Promise<string> {
    const created = await prisma.taxCode.create({
      data: {
        companyId: fixture.companyId,
        code,
        name: code,
        taxType: TaxType.VAT,
        treatment,
        recoverable,
        priceBasis,
        rates: {
          create: [{ rate, effectiveFrom: new Date('2026-01-01'), sourceReference: 'test' }],
        },
      },
    });

    await prisma.taxGLMapping.createMany({
      data: [
        {
          companyId: fixture.companyId,
          taxCodeId: created.id,
          direction: 'INPUT',
          glAccountId: fixture.accounts['1601']!,
          effectiveFrom: new Date('2026-01-01'),
        },
        {
          companyId: fixture.companyId,
          taxCodeId: created.id,
          direction: 'OUTPUT',
          glAccountId: fixture.accounts['2120']!,
          effectiveFrom: new Date('2026-01-01'),
        },
      ],
    });
    return created.id;
  }

  async function makeWhtCode(
    code: string,
    category: string,
    rate: string | null = '0.05000000',
  ): Promise<string> {
    const created = await prisma.taxCode.create({
      data: {
        companyId: fixture.companyId,
        code,
        name: code,
        taxType: TaxType.WHT,
        whtCategory: category,
        ...(rate
          ? {
              rates: {
                create: [
                  { rate, effectiveFrom: new Date('2026-01-01'), sourceReference: 'test' },
                ],
              },
            }
          : {}),
      },
    });

    await prisma.taxGLMapping.createMany({
      data: [
        {
          companyId: fixture.companyId,
          taxCodeId: created.id,
          direction: 'PAYABLE',
          glAccountId: fixture.accounts['2130']!,
          effectiveFrom: new Date('2026-01-01'),
        },
        {
          companyId: fixture.companyId,
          taxCodeId: created.id,
          direction: 'RECEIVABLE',
          glAccountId: fixture.accounts['1602']!,
          effectiveFrom: new Date('2026-01-01'),
        },
      ],
    });
    return created.id;
  }

  async function makeTaxPeriod(taxType: TaxType): Promise<string> {
    const created = await prisma.taxPeriod.create({
      data: {
        companyId: fixture.companyId,
        taxType,
        year: 2026,
        periodNumber: 1,
        name: 'January 2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
        dueDate: new Date('2026-02-21'),
      },
    });
    return created.id;
  }

  const dims = () => ({
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[0]!,
    currencyId: fixture.currencyId,
    exchangeRate: '1.00000000',
  });

  // -------------------------------------------------------------------------

  describe('VAT arithmetic (Rule 1 — round once, at the end)', () => {
    it('computes 7.5% on an exclusive amount', async () => {
      const result = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(1_000_000_00),
        on: JAN,
      });
      expect(result.taxableBaseKobo).toBe(100_000_000n);
      expect(result.taxKobo).toBe(7_500_000n);
      expect(result.grossKobo).toBe(107_500_000n);
    });

    it('extracts VAT from an inclusive price so base + tax equals the price', async () => {
      await makeVatCode('VAT-INC', 'STANDARD', true, '0.07500000', 'INCLUSIVE');

      const result = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-INC',
        amount: kobo(107_500_00),
        on: JAN,
      });
      expect(result.taxKobo).toBe(750_000n);
      expect(result.taxableBaseKobo).toBe(10_000_000n);
      // The invariant that matters: the customer pays exactly what was quoted.
      expect(result.taxableBaseKobo + result.taxKobo).toBe(10_750_000n);
    });

    it('rounds half up at the kobo, once', async () => {
      // 1,333.33 naira x 7.5% = 99.99975 naira = 9,999.75 kobo -> 10,000 kobo.
      const result = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(133_333n),
        on: JAN,
      });
      expect(result.taxKobo).toBe(10_000n);
    });

    it('honours a configured rounding rule other than the default', async () => {
      await prisma.taxConfiguration.updateMany({
        where: { companyId: fixture.companyId },
        data: { rounding: 'DOWN' },
      });
      const result = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(133_333n),
        on: JAN,
      });
      expect(result.taxKobo).toBe(9_999n);
    });

    it('sums a document from its rounded lines, so the total matches the breakdown', async () => {
      const result = await engine.calculateDocument({
        companyId: fixture.companyId,
        on: JAN,
        lines: [
          { lineNumber: 1, taxCode: 'VAT-STD', amount: kobo(333_33n) },
          { lineNumber: 2, taxCode: 'VAT-STD', amount: kobo(333_33n) },
          { lineNumber: 3, taxCode: 'VAT-STD', amount: kobo(333_34n) },
        ],
      });

      const lineSum = result.lines.reduce((s, l) => s + l.taxKobo, 0n);
      expect(result.totalTaxKobo).toBe(lineSum);
    });

    it('refuses a negative amount rather than producing a negative liability', async () => {
      await expect(
        engine.calculateVat({
          companyId: fixture.companyId,
          taxCode: 'VAT-STD',
          amount: kobo(-100_00),
          on: JAN,
        }),
      ).rejects.toThrow(/negative amount/i);
    });
  });

  describe('treatments are not interchangeable', () => {
    it('zero-rates with recovery', async () => {
      const result = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-ZERO',
        amount: kobo(500_000_00),
        on: JAN,
      });
      expect(result.taxKobo).toBe(0n);
      expect(result.recoverable).toBe(true);
      expect(result.treatment).toBe('ZERO_RATED');
    });

    it('exempts without recovery — the distinction a zero rate would lose', async () => {
      const result = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-EXEMPT',
        amount: kobo(500_000_00),
        on: JAN,
      });
      expect(result.taxKobo).toBe(0n);
      expect(result.recoverable).toBe(false);
      expect(result.treatment).toBe('EXEMPT');
    });
  });

  describe('configuration is refused, never guessed (Rule 10)', () => {
    it('refuses a tax code that does not exist', async () => {
      await expect(
        engine.calculateVat({
          companyId: fixture.companyId,
          taxCode: 'VAT-INVENTED',
          amount: kobo(100_00),
          on: JAN,
        }),
      ).rejects.toThrow(/is not configured/i);
    });

    it('refuses a WHT category with no rate rather than deducting nothing', async () => {
      await expect(
        engine.calculateWht({
          companyId: fixture.companyId,
          taxCode: 'WHT-NORATE',
          amount: kobo(1_000_000_00),
          on: JAN,
        }),
      ).rejects.toThrow(/no rate effective/i);
    });

    it('refuses a rate that has not taken effect yet', async () => {
      // A code whose only rate starts in July, queried in February. The company
      // configuration IS effective on that date, so this isolates the missing
      // rate rather than tripping the configuration check first.
      const future = await prisma.taxCode.create({
        data: {
          companyId: fixture.companyId,
          code: 'VAT-FUTURE',
          name: 'Not yet in force',
          taxType: TaxType.VAT,
          rates: {
            create: [{ rate: '0.07500000', effectiveFrom: new Date('2026-07-01') }],
          },
        },
      });
      expect(future.id).toBeTruthy();

      await expect(
        engine.calculateVat({
          companyId: fixture.companyId,
          taxCode: 'VAT-FUTURE',
          amount: kobo(100_00),
          on: new Date('2026-02-01'),
        }),
      ).rejects.toThrow(/no rate effective/i);
    });

    it('refuses when no configuration is effective on the document date', async () => {
      await expect(
        engine.calculateVat({
          companyId: fixture.companyId,
          taxCode: 'VAT-STD',
          amount: kobo(100_00),
          on: new Date('2025-06-01'),
        }),
      ).rejects.toThrow(/No tax configuration is effective/i);
    });

    it('applies the rate in force on the document date, not the latest one', async () => {
      await prisma.taxRate.updateMany({
        where: { taxCodeId: vatStandardId },
        data: { effectiveTo: new Date('2026-06-30') },
      });
      await prisma.taxRate.create({
        data: {
          taxCodeId: vatStandardId,
          rate: '0.10000000',
          effectiveFrom: new Date('2026-07-01'),
          sourceReference: 'hypothetical increase',
        },
      });

      const january = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(1_000_000_00),
        on: JAN,
      });
      const august = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(1_000_000_00),
        on: new Date('2026-08-15'),
      });

      expect(january.taxKobo).toBe(7_500_000n);
      expect(august.taxKobo).toBe(10_000_000n);
    });

    it('refuses two rates effective on the same day, at the database', async () => {
      await expect(
        prisma.taxRate.create({
          data: {
            taxCodeId: vatStandardId,
            rate: '0.05000000',
            effectiveFrom: new Date('2026-03-01'),
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a VAT code used for a WHT calculation', async () => {
      await expect(
        engine.calculateWht({
          companyId: fixture.companyId,
          taxCode: 'VAT-STD',
          amount: kobo(100_00),
          on: JAN,
        }),
      ).rejects.toThrow(/is a VAT code/i);
    });

    it('refuses an inactive code', async () => {
      await prisma.taxCode.update({
        where: { id: vatStandardId },
        data: { active: false },
      });
      await expect(
        engine.calculateVat({
          companyId: fixture.companyId,
          taxCode: 'VAT-STD',
          amount: kobo(100_00),
          on: JAN,
        }),
      ).rejects.toThrow(/inactive/i);
    });

    it('refuses when the company has no tax configuration', async () => {
      await prisma.taxConfiguration.deleteMany({ where: { companyId: fixture.companyId } });
      await expect(
        engine.calculateVat({
          companyId: fixture.companyId,
          taxCode: 'VAT-STD',
          amount: kobo(100_00),
          on: JAN,
        }),
      ).rejects.toThrow(/No tax configuration/i);
    });
  });

  describe('WHT basis is a stated policy, not an assumption', () => {
    it('withholds on the amount before VAT under NET_OF_VAT', async () => {
      const result = await engine.calculateWht({
        companyId: fixture.companyId,
        taxCode: 'WHT-CONTRACT',
        amount: kobo(1_000_000_00),
        vatAmount: kobo(75_000_00),
        on: JAN,
      });
      expect(result.taxableBaseKobo).toBe(100_000_000n);
      expect(result.taxKobo).toBe(5_000_000n);
      // Paid out: 1,000,000 + 75,000 VAT - 50,000 withheld.
      expect(result.netPayableKobo).toBe(102_500_000n);
    });

    it('withholds on the VAT-inclusive amount under GROSS_INCLUDING_VAT', async () => {
      await prisma.taxConfiguration.updateMany({
        where: { companyId: fixture.companyId },
        data: { whtBasis: 'GROSS_INCLUDING_VAT' },
      });

      const result = await engine.calculateWht({
        companyId: fixture.companyId,
        taxCode: 'WHT-CONTRACT',
        amount: kobo(1_000_000_00),
        vatAmount: kobo(75_000_00),
        on: JAN,
      });
      expect(result.taxableBaseKobo).toBe(107_500_000n);
      expect(result.taxKobo).toBe(5_375_000n);
    });
  });

  // -------------------------------------------------------------------------

  describe('the register agrees with the ledger', () => {
    /** Post a sales invoice and register its output VAT in the same transaction. */
    async function postSalesInvoice(net: bigint, reference: string) {
      const vat = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(net),
        on: JAN,
      });

      return prisma.$transaction(async (tx) => {
        const result = await posting.post(
          {
            sourceModule: 'sales',
            sourceDocumentType: 'SalesInvoice',
            sourceDocumentId: reference,
            journalNumber: `JRN-${reference}`,
            journalDate: JAN,
            narration: `Sales invoice ${reference}`,
            ...dims(),
            idempotencyKey: `sales:${reference}`,
            actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
            lines: [
              {
                glAccountId: fixture.accounts['1101']!,
                description: 'Receivable',
                debit: kobo(vat.grossKobo),
                dimensions: dims(),
              },
              {
                glAccountId: fixture.accounts['4101']!,
                description: 'Revenue',
                credit: kobo(vat.taxableBaseKobo),
                dimensions: dims(),
              },
              {
                glAccountId: fixture.accounts['2120']!,
                description: 'Output VAT',
                credit: kobo(vat.taxKobo),
                dimensions: dims(),
              },
            ],
          },
          tx,
        );

        await registers.recordVat(
          {
            companyId: fixture.companyId,
            branchId: fixture.branchId,
            direction: VatDirection.OUTPUT,
            calculation: vat,
            sourceModule: 'sales',
            sourceDocumentType: 'SalesInvoice',
            documentReference: reference,
            documentDate: JAN,
            counterpartyName: 'Test Customer',
            counterpartyTin: 'TIN-001',
            journalEntryId: result.journalEntryId,
          },
          tx,
        );

        return result;
      });
    }

    it('reconciles register totals to the GL control account', async () => {
      await postSalesInvoice(1_000_000_00n, 'INV-001');
      await postSalesInvoice(500_000_00n, 'INV-002');

      const reconciliation = await registers.reconcile(fixture.companyId, vatPeriodId);
      expect(reconciliation.agrees).toBe(true);

      const output = reconciliation.lines.find((l) => l.direction === 'OUTPUT')!;
      expect(output.registerTaxKobo).toBe('11250000');
      expect(output.ledgerBalanceKobo).toBe('11250000');
      expect(output.differenceKobo).toBe('0');
    });

    it('detects a posting that bypassed the register', async () => {
      await postSalesInvoice(1_000_000_00n, 'INV-001');

      // A journal that credits output VAT without a register entry — exactly
      // the drift this reconciliation exists to catch.
      await posting.post({
        sourceModule: 'sales',
        sourceDocumentType: 'SalesInvoice',
        journalNumber: 'JRN-ROGUE',
        journalDate: JAN,
        narration: 'Output VAT posted without a register entry',
        ...dims(),
        idempotencyKey: 'rogue-1',
        actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
        lines: [
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Bank',
            debit: kobo(10_000_00),
            dimensions: dims(),
          },
          {
            glAccountId: fixture.accounts['2120']!,
            description: 'Output VAT',
            credit: kobo(10_000_00),
            dimensions: dims(),
          },
        ],
      });

      const reconciliation = await registers.reconcile(fixture.companyId, vatPeriodId);
      expect(reconciliation.agrees).toBe(false);
      const output = reconciliation.lines.find((l) => l.direction === 'OUTPUT')!;
      expect(output.differenceKobo).toBe('-1000000');
    });

    it('summarises the VAT return with only recoverable input tax', async () => {
      await postSalesInvoice(1_000_000_00n, 'INV-001');

      // Two purchases: one standard (recoverable), one exempt (not).
      for (const [code, taxCodeName, amount, ref] of [
        [vatStandardId, 'VAT-STD', 400_000_00n, 'PUR-001'],
        [vatExemptId, 'VAT-EXEMPT', 200_000_00n, 'PUR-002'],
      ] as const) {
        const vat = await engine.calculateVat({
          companyId: fixture.companyId,
          taxCode: taxCodeName,
          amount: kobo(amount),
          on: JAN,
        });

        await prisma.$transaction(async (tx) => {
          const result = await posting.post(
            {
              sourceModule: 'procurement',
              sourceDocumentType: 'SupplierInvoice',
              journalNumber: `JRN-${ref}`,
              journalDate: JAN,
              narration: `Supplier invoice ${ref}`,
              ...dims(),
              idempotencyKey: `pur:${ref}`,
              actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
              lines: [
                {
                  glAccountId: fixture.accounts['1301']!,
                  description: 'Inventory',
                  debit: kobo(vat.taxableBaseKobo),
                  dimensions: dims(),
                },
                ...(vat.taxKobo > 0n
                  ? [
                      {
                        glAccountId: fixture.accounts['1601']!,
                        description: 'Input VAT',
                        debit: kobo(vat.taxKobo),
                        dimensions: dims(),
                      },
                    ]
                  : []),
                {
                  glAccountId: fixture.accounts['1101']!,
                  description: 'Payable',
                  credit: kobo(vat.grossKobo),
                  dimensions: dims(),
                },
              ],
            },
            tx,
          );

          await registers.recordVat(
            {
              companyId: fixture.companyId,
              branchId: fixture.branchId,
              direction: VatDirection.INPUT,
              calculation: vat,
              sourceModule: 'procurement',
              sourceDocumentType: 'SupplierInvoice',
              documentReference: ref,
              documentDate: JAN,
              journalEntryId: result.journalEntryId,
            },
            tx,
          );
        });
      }

      const register = await registers.vatRegister(fixture.companyId, vatPeriodId);
      expect(register.summary.outputTaxKobo).toBe('7500000');
      expect(register.summary.inputTaxRecoverableKobo).toBe('3000000');
      expect(register.summary.netPayableKobo).toBe('4500000');
      // The exempt purchase appears as turnover but contributes no recoverable tax.
      expect(register.entries).toHaveLength(3);
    });

    it('records zero-tax lines so declared turnover is complete', async () => {
      const vat = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-ZERO',
        amount: kobo(750_000_00),
        on: JAN,
      });

      await prisma.$transaction(async (tx) => {
        const result = await posting.post(
          {
            sourceModule: 'sales',
            sourceDocumentType: 'SalesInvoice',
            journalNumber: 'JRN-ZERO',
            journalDate: JAN,
            narration: 'Zero-rated sale',
            ...dims(),
            idempotencyKey: 'zero-1',
            actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
            lines: [
              {
                glAccountId: fixture.accounts['1101']!,
                description: 'Bank',
                debit: kobo(750_000_00),
                dimensions: dims(),
              },
              {
                glAccountId: fixture.accounts['4101']!,
                description: 'Revenue',
                credit: kobo(750_000_00),
                dimensions: dims(),
              },
            ],
          },
          tx,
        );

        await registers.recordVat(
          {
            companyId: fixture.companyId,
            branchId: fixture.branchId,
            direction: VatDirection.OUTPUT,
            calculation: vat,
            sourceModule: 'sales',
            sourceDocumentType: 'SalesInvoice',
            documentReference: 'ZERO-001',
            documentDate: JAN,
            journalEntryId: result.journalEntryId,
          },
          tx,
        );
      });

      const register = await registers.vatRegister(fixture.companyId, vatPeriodId);
      expect(register.summary.outputTurnoverKobo).toBe('75000000');
      expect(register.summary.outputTaxKobo).toBe('0');
    });
  });

  // -------------------------------------------------------------------------

  describe('registers are append-only (Rule 2)', () => {
    async function oneEntry() {
      const vat = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(100_000_00),
        on: JAN,
      });
      return prisma.$transaction(async (tx) => {
        const result = await posting.post(
          {
            sourceModule: 'sales',
            sourceDocumentType: 'SalesInvoice',
            journalNumber: 'JRN-APP',
            journalDate: JAN,
            narration: 'Invoice',
            ...dims(),
            idempotencyKey: 'append-1',
            actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
            lines: [
              {
                glAccountId: fixture.accounts['1101']!,
                description: 'Bank',
                debit: kobo(vat.grossKobo),
                dimensions: dims(),
              },
              {
                glAccountId: fixture.accounts['4101']!,
                description: 'Revenue',
                credit: kobo(vat.taxableBaseKobo),
                dimensions: dims(),
              },
              {
                glAccountId: fixture.accounts['2120']!,
                description: 'Output VAT',
                credit: kobo(vat.taxKobo),
                dimensions: dims(),
              },
            ],
          },
          tx,
        );
        await registers.recordVat(
          {
            companyId: fixture.companyId,
            branchId: fixture.branchId,
            direction: VatDirection.OUTPUT,
            calculation: vat,
            sourceModule: 'sales',
            sourceDocumentType: 'SalesInvoice',
            documentReference: 'APP-001',
            documentDate: JAN,
            journalEntryId: result.journalEntryId,
          },
          tx,
        );
        return result;
      });
    }

    it('refuses an update to a VAT register entry', async () => {
      await oneEntry();
      const entry = await prisma.vatRegisterEntry.findFirstOrThrow();
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE vat_register_entries SET tax_kobo = 1 WHERE id = $1::uuid`,
          entry.id,
        ),
      ).rejects.toThrow(/append-only/i);
    });

    it('refuses a delete from a VAT register entry', async () => {
      await oneEntry();
      const entry = await prisma.vatRegisterEntry.findFirstOrThrow();
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM vat_register_entries WHERE id = $1::uuid`,
          entry.id,
        ),
      ).rejects.toThrow(/append-only/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('the filing calendar', () => {
    it('generates a year of monthly periods due on the 21st', async () => {
      await prisma.taxPeriod.deleteMany({ where: { companyId: fixture.companyId } });
      const result = await periods.generateYear({
        companyId: fixture.companyId,
        taxType: TaxType.VAT,
        year: 2026,
        actorId: fixture.makerId,
      });

      expect(result.created).toBe(12);
      const january = await prisma.taxPeriod.findFirstOrThrow({
        where: { companyId: fixture.companyId, taxType: TaxType.VAT, periodNumber: 1 },
      });
      expect(january.dueDate.toISOString().slice(0, 10)).toBe('2026-02-21');
    });

    it('closes a period whose register agrees with the ledger', async () => {
      const closed = await periods.close({
        taxPeriodId: vatPeriodId,
        actorId: fixture.makerId,
      });
      expect(closed.status).toBe(TaxPeriodStatus.CLOSED);
    });

    it('refuses to close a period whose register disagrees with the ledger', async () => {
      await posting.post({
        sourceModule: 'sales',
        sourceDocumentType: 'SalesInvoice',
        journalNumber: 'JRN-UNREG',
        journalDate: JAN,
        narration: 'Output VAT with no register entry',
        ...dims(),
        idempotencyKey: 'unreg-1',
        actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
        lines: [
          {
            glAccountId: fixture.accounts['1101']!,
            description: 'Bank',
            debit: kobo(5_000_00),
            dimensions: dims(),
          },
          {
            glAccountId: fixture.accounts['2120']!,
            description: 'Output VAT',
            credit: kobo(5_000_00),
            dimensions: dims(),
          },
        ],
      });

      // A register entry must exist for the reconciliation to compare against.
      const vat = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(100_00),
        on: JAN,
      });
      const journal = await prisma.journalEntry.findFirstOrThrow();
      await prisma.$transaction((tx) =>
        registers.recordVat(
          {
            companyId: fixture.companyId,
            branchId: fixture.branchId,
            direction: VatDirection.OUTPUT,
            calculation: vat,
            sourceModule: 'sales',
            sourceDocumentType: 'SalesInvoice',
            documentReference: 'MISMATCH',
            documentDate: JAN,
            journalEntryId: journal.id,
          },
          tx,
        ),
      );

      await expect(
        periods.close({ taxPeriodId: vatPeriodId, actorId: fixture.makerId }),
      ).rejects.toThrow(/register and the general ledger disagree/i);
    });

    it('refuses a register entry into a closed period, at the database', async () => {
      await periods.close({ taxPeriodId: vatPeriodId, actorId: fixture.makerId });

      const vat = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(100_00),
        on: JAN,
      });

      await expect(
        prisma.$transaction(async (tx) => {
          const result = await posting.post(
            {
              sourceModule: 'sales',
              sourceDocumentType: 'SalesInvoice',
              journalNumber: 'JRN-LATE',
              journalDate: JAN,
              narration: 'Late entry',
              ...dims(),
              idempotencyKey: 'late-1',
              actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
              lines: [
                {
                  glAccountId: fixture.accounts['1101']!,
                  description: 'Bank',
                  debit: kobo(vat.grossKobo),
                  dimensions: dims(),
                },
                {
                  glAccountId: fixture.accounts['4101']!,
                  description: 'Revenue',
                  credit: kobo(vat.taxableBaseKobo),
                  dimensions: dims(),
                },
                {
                  glAccountId: fixture.accounts['2120']!,
                  description: 'Output VAT',
                  credit: kobo(vat.taxKobo),
                  dimensions: dims(),
                },
              ],
            },
            tx,
          );
          await registers.recordVat(
            {
              companyId: fixture.companyId,
              branchId: fixture.branchId,
              direction: VatDirection.OUTPUT,
              calculation: vat,
              sourceModule: 'sales',
              sourceDocumentType: 'SalesInvoice',
              documentReference: 'LATE-001',
              documentDate: JAN,
              journalEntryId: result.journalEntryId,
            },
            tx,
          );
        }),
      ).rejects.toThrow(/will not accept new register entries/i);
    });

    it('files only a closed period', async () => {
      await expect(
        periods.markFiled({
          taxPeriodId: vatPeriodId,
          filingReference: 'FIRS-001',
          actorId: fixture.makerId,
        }),
      ).rejects.toThrow(/Close it/i);

      await periods.close({ taxPeriodId: vatPeriodId, actorId: fixture.makerId });
      const filed = await periods.markFiled({
        taxPeriodId: vatPeriodId,
        filingReference: 'FIRS-001',
        actorId: fixture.makerId,
      });
      expect(filed.status).toBe(TaxPeriodStatus.FILED);
    });

    it('refuses to re-open a filed period, at the database', async () => {
      await periods.close({ taxPeriodId: vatPeriodId, actorId: fixture.makerId });
      await periods.markFiled({
        taxPeriodId: vatPeriodId,
        filingReference: 'FIRS-001',
        actorId: fixture.makerId,
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE tax_periods SET status = 'OPEN' WHERE id = $1::uuid`,
          vatPeriodId,
        ),
      ).rejects.toThrow(/has been filed and cannot be re-opened/i);
    });

    it('writes an immutable audit record on close (Rule 9)', async () => {
      await periods.close({ taxPeriodId: vatPeriodId, actorId: fixture.makerId });
      const audit = await prisma.auditRecord.findMany({
        where: { entityType: 'TaxPeriod', entityId: vatPeriodId },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe('PERIOD_CLOSE');
    });

    it('refuses a taxable document with no tax period covering its date', async () => {
      const vat = await engine.calculateVat({
        companyId: fixture.companyId,
        taxCode: 'VAT-STD',
        amount: kobo(100_00),
        on: JAN,
      });
      const journal = await prisma.journalEntry.findFirst();

      await expect(
        prisma.$transaction((tx) =>
          registers.recordVat(
            {
              companyId: fixture.companyId,
              branchId: fixture.branchId,
              direction: VatDirection.OUTPUT,
              calculation: vat,
              sourceModule: 'sales',
              sourceDocumentType: 'SalesInvoice',
              documentReference: 'OUT-OF-RANGE',
              // No 2027 period exists.
              documentDate: new Date('2027-05-05'),
              journalEntryId: journal?.id ?? vatPeriodId,
            },
            tx,
          ),
        ),
      ).rejects.toThrow(/No VAT tax period covers/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('WHT register', () => {
    it('flags receivable entries with no credit note, since they cannot be claimed', async () => {
      const wht = await engine.calculateWht({
        companyId: fixture.companyId,
        taxCode: 'WHT-CONTRACT',
        amount: kobo(1_000_000_00),
        on: JAN,
      });

      await prisma.$transaction(async (tx) => {
        const result = await posting.post(
          {
            sourceModule: 'sales',
            sourceDocumentType: 'CustomerReceipt',
            journalNumber: 'JRN-WHT',
            journalDate: JAN,
            narration: 'Receipt net of WHT',
            ...dims(),
            idempotencyKey: 'wht-1',
            actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
            lines: [
              {
                glAccountId: fixture.accounts['1101']!,
                description: 'Bank',
                debit: kobo(950_000_00),
                dimensions: dims(),
              },
              {
                glAccountId: fixture.accounts['1602']!,
                description: 'WHT receivable',
                debit: kobo(wht.taxKobo),
                dimensions: dims(),
              },
              {
                glAccountId: fixture.accounts['4101']!,
                description: 'Revenue',
                credit: kobo(1_000_000_00),
                dimensions: dims(),
              },
            ],
          },
          tx,
        );

        await registers.recordWht(
          {
            companyId: fixture.companyId,
            branchId: fixture.branchId,
            direction: WhtDirection.RECEIVABLE,
            calculation: wht,
            grossAmountKobo: 100_000_000n,
            sourceModule: 'sales',
            sourceDocumentType: 'CustomerReceipt',
            documentReference: 'RCT-001',
            documentDate: JAN,
            journalEntryId: result.journalEntryId,
          },
          tx,
        );
      });

      const register = await registers.whtRegister(fixture.companyId, whtPeriodId);
      expect(register.summary.receivableKobo).toBe('5000000');
      expect(register.summary.receivableWithoutCreditNote).toBe(1);

      const reconciliation = await registers.reconcile(fixture.companyId, whtPeriodId);
      expect(reconciliation.agrees).toBe(true);
    });
  });
});
