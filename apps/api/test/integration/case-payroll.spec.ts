import { beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditAction, PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { EmployeeService } from '../../src/masters/employee.service';
import { documentPackGaps } from '../../src/masters/employee-onboarding';
import { PayeEngineService } from '../../src/payroll/paye-engine.service';
import { StatutoryEngineService } from '../../src/payroll/statutory-engine.service';
import { PayrollRunService } from '../../src/payroll/payroll-run.service';
import { PayrollPaymentService } from '../../src/payroll/payroll-payment.service';
import { PayrollSetupService } from '../../src/payroll/payroll-setup.service';
import { PayrollPaymentPostingHandler, PayrollPostingHandler } from '../../src/payroll/payroll.handler';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { numberFor } from '../../src/chart/chart';
import { kobo } from '../../src/common/money';
import { completeDocumentPack, setApprovedPay } from '../helpers/employee';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The client's 2026 statutory payroll case (NG_PAYE_2026, NG_Payroll_Journals,
 * Employee_Master_v2 … Employee_Compensation), run through the application —
 * NG_Statutory_Checks and Employee_Master_Checks.
 *
 * Six employees set up as HR would: recorded, paid ₦120,000 basic, ₦30,000
 * housing and ₦20,000 transport a month, approved by someone else, rent
 * declared (₦1,200,000 a year), document pack verified, and put on payroll
 * by a second person. Payroll activated through the app's own setup
 * (NTA 2025 bands; ITF from 5 staff). One month is calculated, approved,
 * posted, paid and every statutory payable remitted.
 *
 * Each workbook check is asserted, and the figures are written to
 * test/uat/case-payroll.json for run-uat.mjs to score the two sheets.
 */

const N = (naira: number) => BigInt(Math.round(naira * 100));

/** NG_Statutory_Checks, in the workbook's order. Money in kobo. */
const STATUTORY = {
  employees: 6,
  gross: N(1_020_000),
  employeePension: N(81_600),
  employerPension: N(102_000),
  nhf: N(25_500),
  paye: N(58_938),
  net: N(853_962),
  nsitf: N(10_200),
  itf: N(10_200),
  journals: N(2_284_800),
};

let prisma: PrismaService;
let fixture: TestFixture;
let employees: EmployeeService;
let payroll: PayrollRunService;
let payments: PayrollPaymentService;
let workflow: WorkflowService;
let setup: PayrollSetupService;

beforeAll(async () => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  employees = new EmployeeService(prisma, audit);
  payroll = new PayrollRunService(prisma, audit, posting, workflow, employees, new PayeEngineService(prisma), new StatutoryEngineService(prisma));
  payments = new PayrollPaymentService(prisma, audit, posting, workflow, payroll);
  setup = new PayrollSetupService(prisma, audit);
  workflow.register(new PayrollPostingHandler(payroll));
  workflow.register(new PayrollPaymentPostingHandler(payments));

  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'SPEC' } });
  await new PostingControlProvisioningService(prisma, audit).provision(fixture.companyId, null);
  for (const transactionType of ['PAYROLL_RUN', 'PAYROLL_PAYMENT']) {
    await prisma.workflowDefinition.create({
      data: {
        companyId: fixture.companyId, transactionType, name: transactionType, autoPostOnApproval: true, effectiveFrom: new Date('2026-01-01'),
        steps: { create: [{ level: 1, roleCode: 'FINANCE_MANAGER', name: 'Finance Manager', maxAmountKobo: null }] },
      },
    });
  }
}, 300_000);

async function balance(number: string) {
  const a = await prisma.gLAccount.findFirst({ where: { companyId: fixture.companyId, accountNumber: number } });
  if (!a) return 0n;
  const s = await prisma.journalLine.aggregate({ where: { glAccountId: a.id, journalEntry: { status: 'POSTED' } }, _sum: { debitKobo: true, creditKobo: true } });
  return (s._sum.debitKobo ?? 0n) - (s._sum.creditKobo ?? 0n);
}

describe('The 2026 statutory payroll case, through the application (NG_Statutory_Checks)', () => {
  it('payroll case replay: six employees, one month, calculated, posted, paid and remitted as the workbook does', async () => {
    const hr = { userId: fixture.makerId, roles: ['HR_OFFICER'] };
    const finance = { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] };
    const approver = { userId: fixture.checkerId, roles: ['FINANCE_MANAGER'] };

    await setup.activate({ companyId: fixture.companyId, nhfCompanyParticipation: true, actorId: fixture.makerId });

    // --- Employee_Master_v2 / Employee_Compensation: six test employees ---
    const staff = [];
    for (let i = 1; i <= 6; i += 1) {
      const n = String(i).padStart(3, '0');
      const employee = await employees.create({
        companyId: fixture.companyId, employeeNumber: `EMP-${n}`, firstName: 'Test', surname: `Employee ${i}`,
        employmentDate: new Date('2026-01-01'), departmentId: fixture.departmentId, branchId: fixture.branchId, costCentreId: fixture.costCentreId,
        taxState: 'Lagos', bankName: 'Test Bank', accountNumber: `ACCT-VERIFIED-${n}`, tin: `TAX-LAG-${n}`,
        pensionEnrolled: true, pensionRsaNumber: `RSA-VERIFIED-${n}`, pensionAdministrator: 'Test PFA', nhfEnrolled: true, nhfNumber: `NHF-REF-${n}`,
        actorId: fixture.makerId,
      });
      for (const [code, naira] of [['BASIC', 120_000], ['HOUSING', 30_000], ['TRANSPORT', 20_000]] as const) {
        await setApprovedPay(employees, { employeeId: employee.id, componentCode: code, amount: kobo(N(naira)), effectiveFrom: new Date('2026-01-01'), actorId: fixture.makerId }, fixture);
      }
      // NG_PAYE_2026: ₦1,200,000 annual rent declared with evidence; NHF is not declared — the payroll deducts it.
      await prisma.employeeTaxRelief.create({ data: { employeeId: employee.id, taxYear: 2026, annualRentKobo: N(1_200_000), documentsComplete: true } });
      await completeDocumentPack(prisma, fixture, employee.id);
      // Put on payroll by someone other than whoever set them up (INT-012).
      await employees.activateForPayroll({ employeeId: employee.id, on: new Date('2026-01-31'), actorId: fixture.checkerId });
      staff.push(employee);
    }

    // --- NG_PAYE_2026: January's run ---
    const created = await payroll.createRun({
      companyId: fixture.companyId, year: 2026, month: 1, branchId: fixture.branchId, financialYearId: fixture.financialYearId,
      financialPeriodId: fixture.periodIds[0]!, currencyId: fixture.currencyId, actorId: fixture.makerId,
    });
    await payroll.calculate({ payrollRunId: created.id, actorId: fixture.makerId });
    const submitted = await payroll.submit({ payrollRunId: created.id, actor: hr });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: created.id } });
    const lines = await prisma.payrollRunLine.findMany({ where: { payrollRunId: run.id }, include: { employee: true } });
    // Rebased to the agreed statutory settings: PAYE ₦9,823, NHF 2.5% of ₦170,000,
    // net ₦142,327 after employee pension and statutory deductions.
    for (const line of lines) {
      expect({ who: line.employee.employeeNumber, paye: line.monthlyPayeKobo, net: line.netPayKobo, nhf: line.nhfKobo }).toEqual({
        who: line.employee.employeeNumber, paye: N(9_823), net: N(142_327), nhf: N(4_250),
      });
    }

    // --- NG_Payroll_Journals NGP005–010: pay staff, remit every statutory payable ---
    const bank =
      (await prisma.gLAccount.findFirst({ where: { companyId: fixture.companyId, accountNumber: '110100' } }))?.id ??
      (await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: '110100', name: 'Bank', accountType: 'ASSET', normalBalance: 'DEBIT' } })).id;
    for (const row of await payments.outstanding(run.id)) {
      const amountKobo = BigInt(row.outstandingKobo);
      if (amountKobo === 0n) continue;
      const payment = await payments.create({
        companyId: fixture.companyId, payrollRunId: run.id, bucket: row.bucket, amountKobo, paymentDate: new Date('2026-01-31'), method: 'BANK_TRANSFER',
        bankGlAccountId: bank, branchId: fixture.branchId, currencyId: fixture.currencyId, financialYearId: fixture.financialYearId, financialPeriodId: fixture.periodIds[0]!, actor: finance,
      });
      const sent = await payments.submit({ paymentId: payment.id, actor: finance });
      await workflow.approve({ transactionId: sent.transactionId, actor: approver });
    }

    // =================== The application's figures ===================
    const payrollJournals = await prisma.journalLine.aggregate({
      where: { journalEntry: { companyId: fixture.companyId, status: 'POSTED', sourceModule: 'payroll' } },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const allJournals = await prisma.journalLine.aggregate({
      where: { journalEntry: { companyId: fixture.companyId, status: 'POSTED' } },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const payable = async (role: 'payePayable' | 'pensionPayable' | 'nhfPayable' | 'nsitfPayable' | 'itfPayable' | 'salaryPayable') => balance(numberFor('SPEC', role));
    const statutory = {
      'Six employees calculated': [BigInt(run.employeeCount), BigInt(STATUTORY.employees)],
      'Gross payroll': [run.totalGrossKobo, STATUTORY.gross],
      'Employee pension at 8%': [run.totalEmployeePensionKobo, STATUTORY.employeePension],
      'Employer pension at 10%': [run.totalEmployerPensionKobo, STATUTORY.employerPension],
      'NHF configured calculation': [run.totalNhfKobo, STATUTORY.nhf],
      'PAYE equals employee detail': [run.totalPayeKobo, lines.reduce((s, l) => s + l.monthlyPayeKobo, 0n)],
      'PAYE (NG_PAYE_2026 total)': [run.totalPayeKobo, STATUTORY.paye],
      'Net pay equation': [run.totalNetPayKobo, STATUTORY.net],
      'NSITF employer-only 1%': [run.totalNsitfKobo, STATUTORY.nsitf],
      'ITF applicability and 1%': [run.totalItfKobo, STATUTORY.itf],
      'Payroll journals balance': [payrollJournals._sum.debitKobo ?? 0n, STATUTORY.journals],
      'PAYE payable cleared': [await payable('payePayable'), 0n],
      'Pension payables cleared': [await payable('pensionPayable'), 0n],
      'Other statutory payables cleared': [(await payable('nhfPayable')) + (await payable('nsitfPayable')) + (await payable('itfPayable')) + (await payable('salaryPayable')), 0n],
    } satisfies Record<string, [bigint, bigint]>;

    // --- Employee_Master_Checks ---
    const people = await prisma.employee.findMany({ where: { companyId: fixture.companyId }, include: { verifications: true } });
    const approvedPay = await prisma.employeeSalaryComponent.findMany({ where: { employee: { companyId: fixture.companyId } } });
    const audits = await prisma.auditRecord.count({ where: { companyId: fixture.companyId, entityType: 'Employee', action: { in: [AuditAction.CREATE, AuditAction.APPROVE] } } });
    const count = (predicate: (p: (typeof people)[number]) => boolean) => BigInt(people.filter(predicate).length);
    const statutoryPasses = BigInt(Object.values(statutory).filter(([a, e]) => a === e).length);
    const master = {
      'Six unique active employee IDs': [BigInt(new Set(people.filter((p) => p.payrollActive).map((p) => p.employeeNumber)).size), 6n],
      'Employee records approved': [count((p) => p.payrollActive), 6n],
      'PAYE state present': [count((p) => !!p.taxState), 6n],
      'Bank verification complete': [count((p) => p.verifications.some((v) => v.checkType === 'BANK' && v.status === 'VERIFIED')), 6n],
      'Tax references present': [count((p) => !!p.tin), 6n],
      'Pension references present': [count((p) => !!p.pensionRsaNumber && !!p.pensionAdministrator), 6n],
      'Employment assignments active': [count((p) => !!p.departmentId && !!p.costCentreId && !['TERMINATED', 'RESIGNED', 'RETIRED', 'SUSPENDED'].includes(p.employmentStatus)), 6n],
      'Compensation records approved': [BigInt(new Set(approvedPay.filter((r) => r.approvedById).map((r) => r.employeeId)).size), 6n],
      'Document packs complete': [count((p) => documentPackGaps(p, p.verifications).length === 0), 6n],
      'Audit events recorded': [BigInt(audits), 12n],
      'Payroll employee IDs tied': [BigInt(new Set(lines.map((l) => l.employeeId)).size), 6n],
      'Payroll gross tied to compensation': [lines.reduce((s, l) => s + l.monthlyGrossKobo, 0n), STATUTORY.gross],
      'Statutory payroll checks pass': [statutoryPasses, BigInt(Object.keys(statutory).length)],
    } satisfies Record<string, [bigint, bigint]>;

    const figures = (rows: Record<string, [bigint, bigint]>) =>
      Object.fromEntries(Object.entries(rows).map(([k, [a, e]]) => [k, { application: a.toString(), expected: e.toString() }]));
    writeFileSync(
      join(__dirname, '..', 'uat', 'case-payroll.json'),
      JSON.stringify({ product: 'payroll', run: new Date().toISOString(), statutory: figures(statutory), master: figures(master) }, null, 2),
    );

    expect(Object.entries(statutory).filter(([, [a, e]]) => a !== e)).toEqual([]);
    expect(Object.entries(master).filter(([, [a, e]]) => a !== e)).toEqual([]);
    expect((allJournals._sum.debitKobo ?? 0n) - (allJournals._sum.creditKobo ?? 0n)).toBe(0n);
    expect(await new TrialBalanceService(prisma).build({ companyId: fixture.companyId }).then((tb) => tb.balanced)).toBe(true);
  }, 600_000);
});
