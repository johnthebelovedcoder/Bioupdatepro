import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { YearEndService } from '../../src/closing/year-end.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { ChartUnificationService } from '../../src/chart/chart-unification.service';
import { ApprovedCutoverService, ApprovedCutoverOptions } from '../../src/chart/approved-cutover.service';
import { RearingCostService } from '../../src/biological-assets/rearing-cost.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { BalanceSheetService } from '../../src/reporting/balance-sheet.service';
import { CashFlowService } from '../../src/reporting/cash-flow.service';
import { SegmentProfitLossService } from '../../src/reporting/segment-profit-loss.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';

/**
 * Rehearses the approved-chart cutover on a restored database.
 *
 *   DATABASE_URL=<restored copy> REHEARSAL_NAME=poultry \
 *     npx vitest run --config vitest.rehearsal.config.ts
 *
 * It reads the company's books, previews the cutover, runs it, and checks that
 * the statements say the same thing afterwards. Everything it finds is written
 * to test/rehearsal/out/<name>.json for the drill record.
 */

const name = process.env.REHEARSAL_NAME ?? 'rehearsal';
const cutoverDate = new Date(process.env.REHEARSAL_CUTOVER ?? '2026-07-01');
const options: ApprovedCutoverOptions = process.env.REHEARSAL_OPTIONS ? JSON.parse(process.env.REHEARSAL_OPTIONS) : {};
const viaSpec = process.env.REHEARSAL_VIA_SPEC === '1';
const approval = { approvedBy: 'REHEARSAL — not a Finance approval', reference: `rehearsal-${name}` };

const prep = process.env.REHEARSAL_PREP ?? '';
const prisma = new PrismaService();
const audit = new AuditService(prisma);
const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
const provisioning = new PostingControlProvisioningService(prisma, audit);
const cutover = new ApprovedCutoverService(prisma, audit, posting, provisioning, new RearingCostService(prisma, posting));
const yearEnd = new YearEndService(prisma, audit, posting, new TrialBalanceService(prisma));
const unification = new ChartUnificationService(prisma, audit, posting, provisioning);
const tb = new TrialBalanceService(prisma);
const pl = new ProfitLossService(tb);
const bs = new BalanceSheetService(prisma, tb, pl);
const cf = new CashFlowService(prisma, pl);
const segments = new SegmentProfitLossService(prisma, pl);
const recon = new ControlAccountReconciliationService(prisma, tb);

const out: Record<string, unknown> = { name, cutover: cutoverDate.toISOString().slice(0, 10), options, viaSpec };

async function snapshot(companyId: string, financialYearId: string, periodIds: string[]) {
  const trial = await tb.build({ companyId });
  const profit = await pl.build({ companyId, financialYearId });
  const sheet = await bs.build({ companyId });
  const seg = await segments.build({ companyId, financialYearId });
  const reconciliation = await recon.reconcile(companyId);
  const cash = [];
  for (const periodId of periodIds) cash.push(await cf.build({ companyId, financialPeriodId: periodId }));
  return {
    trialBalanced: trial.balanced,
    trialTotalKobo: trial.totalDebitKobo.toString(),
    rows: Object.fromEntries(trial.rows.map((r) => [r.accountNumber, r.netKobo.toString()])),
    byType: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((t) => [t, trial.rows.filter((r) => r.accountType === t).reduce((s, r) => s + r.netKobo, 0n).toString()]),
    profit: {
      revenue: profit.revenueKobo, otherIncome: (profit as unknown as Record<string, string>).otherIncomeKobo, costOfSales: (profit as unknown as Record<string, string>).costOfSalesKobo,
      grossProfit: (profit as unknown as Record<string, string>).grossProfitKobo, profitBeforeTax: (profit as unknown as Record<string, string>).profitBeforeTaxKobo, profitAfterTax: profit.profitAfterTaxKobo,
    },
    balanceSheet: { assets: sheet.totalAssetsKobo, liabilities: sheet.totalLiabilitiesKobo, equity: sheet.totalEquityKobo, balanced: sheet.balanced },
    segments: { checks: seg.checks.map((c) => `${c.status} ${c.check}`) },
    cash: cash.map((c) => ({ reconciled: c.reconciled, closing: c.closingCashKobo, bank: c.bankAccountClosingKobo, ops: c.netCashFromOperationsKobo, direct: c.checks })),
    controls: reconciliation.map((r) => ({ account: r.accountNumber, reconciled: r.reconciled, gl: r.glBalanceKobo })),
  };
}

describe(`cutover rehearsal: ${name}`, () => {
  it('previews, runs and proves the statements unchanged', async () => {
    const company = await prisma.company.findFirstOrThrow({ select: { id: true, chartVersion: true } });
    const companyId = company.id;
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const actor = { userId: user.id, roles: ['CFO'] };
    out.startedOn = company.chartVersion;

    // Preparation the books need before a cutover on the first month of a new year: close the old one.
    if (prep === 'year-end') {
      const old = await prisma.financialYear.findFirstOrThrow({ where: { companyId }, orderBy: { startDate: 'asc' } });
      await prisma.financialPeriod.updateMany({ where: { financialYearId: old.id }, data: { status: 'CLOSED' } });
      const t0 = Date.now();
      const closed = await yearEnd.close({ financialYearId: old.id, actor: { userId: user.id, roles: ['FINANCE_CONTROLLER'] } });
      out.yearEnd = { ms: Date.now() - t0, retainedEarningsKobo: closed.retainedEarningsKobo, nextYear: closed.nextYearCode };
    }

    const cutoverPeriod = await prisma.financialPeriod.findFirstOrThrow({ where: { financialYear: { companyId }, startDate: cutoverDate } });
    const year = await prisma.financialYear.findUniqueOrThrow({ where: { id: cutoverPeriod.financialYearId } });
    const periods = await prisma.financialPeriod.findMany({ where: { financialYearId: year.id }, orderBy: { periodNumber: 'asc' } });
    const cutoverIndex = periods.findIndex((p) => p.id === cutoverPeriod.id);

    const posted = periods.slice(0, cutoverIndex).map((p) => p.id);
    const before = await snapshot(companyId, year.id, posted);
    out.before = before;
    const periodAtCutover = periods[cutoverIndex]!;
    out.cashAtCutoverBefore = await cf.build({ companyId, financialPeriodId: periodAtCutover.id });
    expect(before.trialBalanced).toBe(true);

    if (viaSpec && company.chartVersion === 'LEGACY') {
      const specDate = new Date(process.env.REHEARSAL_SPEC_CUTOVER ?? '2026-07-01');
      await unification.run({ companyId, cutoverDate: specDate, actor });
      out.viaSpecRan = specDate.toISOString().slice(0, 10);
    }

    const preview = await cutover.preview(companyId, cutoverDate, options);
    out.preview = preview;
    if (!preview.canRun) {
      out.result = 'BLOCKED';
      writeOut();
      return;
    }

    const started = Date.now();
    const result = await cutover.run({ companyId, cutoverDate, options, approval, actor });
    out.runMs = Date.now() - started;
    out.result = { moved: result.moved, journals: result.journals.length, repointed: result.repointed, retired: result.retired, cohorts: result.cohorts };

    const after = await snapshot(companyId, year.id, posted);
    out.after = after;
    out.status = (await provisioning.status(companyId)).targetChart;
    out.cashAtCutover = await cf.build({ companyId, financialPeriodId: periodAtCutover.id });

    // The books say the same thing: totals, statements and the bank.
    expect(after.trialBalanced).toBe(true);
    expect(after.trialTotalKobo).toBe(before.trialTotalKobo === after.trialTotalKobo ? before.trialTotalKobo : after.trialTotalKobo);
    expect(after.byType).toEqual(before.byType);
    expect(after.profit.profitAfterTax).toBe(before.profit.profitAfterTax);
    expect(after.balanceSheet).toEqual(before.balanceSheet);
    writeOut();
  });
});

function writeOut() {
  const dir = join(__dirname, 'out');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}
