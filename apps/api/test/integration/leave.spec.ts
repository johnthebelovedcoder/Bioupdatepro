import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { EmployeeService } from '../../src/masters/employee.service';
import { LeaveService } from '../../src/leave/leave.service';
import { kobo } from '../../src/common/money';
import { setApprovedPay } from '../helpers/employee';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Leave (SOP-038, RPT-HR-007, AC-HR-003) on the Nigerian Labour Act defaults:
 * 6 working days' annual leave after 12 months (s.18), carried one year then
 * lapsing; 12 sick days a year with a certificate (s.16); 12 weeks' maternity
 * leave at 50% pay after 6 months (s.54).
 */

let prisma: PrismaService;
let employees: EmployeeService;
let leave: LeaveService;
let fixture: TestFixture;
let hr: { userId: string; roles: string[] };
let manager: { userId: string; roles: string[] };

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  employees = new EmployeeService(prisma, audit);
  leave = new LeaveService(prisma, audit);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  hr = { userId: fixture.makerId, roles: ['HR_OFFICER'] };
  manager = { userId: fixture.checkerId, roles: ['FARM_MANAGER'] };
});

const hire = (number: string, employmentDate: string) =>
  employees.create({
    companyId: fixture.companyId, employeeNumber: number, firstName: 'Ada', surname: number, employmentDate: new Date(employmentDate),
    departmentId: fixture.departmentId, branchId: fixture.branchId, costCentreId: fixture.costCentreId, taxState: 'Lagos', actorId: fixture.makerId,
  });

async function approved(employeeId: string, type: string, start: string, end: string, extra: Record<string, string> = {}) {
  const request = await leave.request({ companyId: fixture.companyId, employeeId, type, startDate: new Date(start), endDate: new Date(end), reason: 'Leave', actor: hr, ...extra });
  return leave.decide({ companyId: fixture.companyId, leaveId: request.id, approve: true, actor: manager });
}

describe('Leave (SOP-038, AC-HR-003)', () => {
  it('starts on the Labour Act minimums and refuses a policy below them', async () => {
    expect(await leave.policy(fixture.companyId)).toMatchObject({ annualDays: 6, sickDays: 12, maternityWeeks: 12, maternityPayPercent: 50, statutory: true });
    const cfo = { userId: fixture.financeUserId, roles: ['CFO'] };
    await expect(leave.setPolicy({ companyId: fixture.companyId, values: { annualDays: 5 }, actor: cfo })).rejects.toThrow(/annual leave below 6 days \(s\.18\)/);
    await expect(leave.setPolicy({ companyId: fixture.companyId, values: { annualDays: 15 }, actor: hr })).rejects.toThrow(/Only the CFO/);
    const better = await leave.setPolicy({ companyId: fixture.companyId, values: { annualDays: 15, maternityWeeks: 16, maternityPayPercent: 100 }, actor: cfo });
    expect(better).toMatchObject({ annualDays: 15, maternityWeeks: 16, statutory: false });
  });

  it('earns annual leave on the service anniversary, carries it a year, and rolls the balance forward', async () => {
    const ada = await hire('EMP-A', '2024-03-01');
    // 2025: 6 days earned on 1 March 2025, 4 taken, 2 carried into 2026.
    await approved(ada.id, 'ANNUAL', '2025-06-02', '2025-06-05');

    // February 2026 is before this year's anniversary: only the 2 carried days are there.
    await expect(
      leave.request({ companyId: fixture.companyId, employeeId: ada.id, type: 'ANNUAL', startDate: new Date('2026-02-02'), endDate: new Date('2026-02-04'), reason: 'Trip', actor: hr }),
    ).rejects.toThrow(/2 days of annual leave available on 2026-02-02; 3 asked for/);
    await approved(ada.id, 'ANNUAL', '2026-02-02', '2026-02-03');
    // After 1 March 2026 the year's 6 are there.
    await approved(ada.id, 'ANNUAL', '2026-04-06', '2026-04-10');

    const report = await leave.balances(fixture.companyId, new Date('2026-09-30'));
    const row = report.rows.find((r) => r.employee.startsWith('EMP-A'))!;
    expect(row).toMatchObject({ opening: 2, earned: 6, earnedOn: '2026-03-01', taken: 7, closing: 1, lapsingAtYearEnd: 0 });
  });

  it('lapses carried days not taken by the end of the following year', async () => {
    const bola = await hire('EMP-B', '2024-01-15');
    // 6 earned in 2025, none taken: carried into 2026 and lapsing at its end unless used.
    const report = await leave.balances(fixture.companyId, new Date('2026-06-30'));
    const row = report.rows.find((r) => r.employee.startsWith('EMP-B'))!;
    expect(row).toMatchObject({ opening: 6, earned: 6, closing: 12, lapsingAtYearEnd: 6 });
  });

  it('values the closing balance at the daily rate (RPT-HR-007 liability)', async () => {
    const ada = await hire('EMP-C', '2024-01-10');
    // A second employee's salary components, set up through the approved-pay path.
    await prisma.salaryComponent.create({
      data: { companyId: fixture.companyId, code: 'BASIC', name: 'Basic salary', type: 'EARNING', basis: 'FIXED', isTaxable: true, isPensionable: true, isNhfBase: true, isGrossPayComponent: true },
    });
    await setApprovedPay(employees, { employeeId: ada.id, componentCode: 'BASIC', amount: kobo(220_000_00n), effectiveFrom: new Date('2026-01-01'), actorId: fixture.makerId }, fixture);
    // September 2026 has 22 working days: ₦10,000 a day.
    const report = await leave.balances(fixture.companyId, new Date('2026-09-30'));
    const row = report.rows.find((r) => r.employee.startsWith('EMP-C'))!;
    expect(row.dailyRateKobo).toBe(10_000_00n.toString());
    expect(row.liabilityKobo).toBe((BigInt(row.closing) * 10_000_00n).toString());
    expect(report.totalLiabilityKobo).toBe(row.liabilityKobo);
  });

  it('needs a medical certificate for sick leave and stops at 12 paid days a year (s.16)', async () => {
    const ada = await hire('EMP-D', '2025-01-06');
    await expect(
      leave.request({ companyId: fixture.companyId, employeeId: ada.id, type: 'SICK', startDate: new Date('2026-03-02'), endDate: new Date('2026-03-03'), reason: 'Malaria', actor: hr }),
    ).rejects.toThrow(/medical certificate/);
    await approved(ada.id, 'SICK', '2026-03-02', '2026-03-13', { evidenceReference: 'LUTH certificate 4411' }); // 10 days
    await expect(
      leave.request({
        companyId: fixture.companyId, employeeId: ada.id, type: 'SICK', startDate: new Date('2026-05-04'), endDate: new Date('2026-05-06'), reason: 'Flu',
        evidenceReference: 'Clinic note', actor: hr,
      }),
    ).rejects.toThrow(/2 paid sick day\(s\) left in 2026; 3 asked for/);
  });

  it('pays maternity leave at 50% after six months, nothing before, for up to 12 weeks (s.54)', async () => {
    const long = await hire('EMP-E', '2025-01-06');
    const recent = await hire('EMP-F', '2026-05-04');
    await expect(
      leave.request({ companyId: fixture.companyId, employeeId: long.id, type: 'MATERNITY', startDate: new Date('2026-06-01'), endDate: new Date('2026-09-30'), reason: 'Maternity', actor: hr }),
    ).rejects.toThrow(/up to 12 weeks/);
    const paid = await leave.request({ companyId: fixture.companyId, employeeId: long.id, type: 'MATERNITY', startDate: new Date('2026-06-01'), endDate: new Date('2026-08-23'), reason: 'Maternity', actor: hr });
    expect(paid.payPercent).toBe(50);
    const unpaid = await leave.request({ companyId: fixture.companyId, employeeId: recent.id, type: 'MATERNITY', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-22'), reason: 'Maternity', actor: hr });
    expect(unpaid.payPercent).toBe(0);
  });

  it('refuses overlapping leave, approval by the requester, and changing a decided request', async () => {
    const ada = await hire('EMP-G', '2024-01-08');
    const request = await leave.request({ companyId: fixture.companyId, employeeId: ada.id, type: 'UNPAID', startDate: new Date('2026-07-06'), endDate: new Date('2026-07-10'), reason: 'Travel', actor: hr });
    await expect(
      leave.request({ companyId: fixture.companyId, employeeId: ada.id, type: 'ANNUAL', startDate: new Date('2026-07-09'), endDate: new Date('2026-07-13'), reason: 'Trip', actor: hr }),
    ).rejects.toThrow(/already has unpaid leave from 2026-07-06 to 2026-07-10/);
    await expect(leave.decide({ companyId: fixture.companyId, leaveId: request.id, approve: true, actor: { ...hr, roles: ['FARM_MANAGER'] } })).rejects.toThrow(
      /You requested this leave, so someone else approves it/,
    );
    await expect(leave.decide({ companyId: fixture.companyId, leaveId: request.id, approve: false, actor: manager })).rejects.toThrow(/Say why/);
    await leave.decide({ companyId: fixture.companyId, leaveId: request.id, approve: true, actor: manager });
    await expect(prisma.leaveRequest.update({ where: { id: request.id }, data: { endDate: new Date('2026-07-17') } })).rejects.toThrow(/fixed once requested/);
    // Approved leave with no posted payroll behind it can still be cancelled, with a reason.
    await expect(leave.cancel({ companyId: fixture.companyId, leaveId: request.id, actor: manager })).rejects.toThrow(/Say why/);
    expect((await leave.cancel({ companyId: fixture.companyId, leaveId: request.id, note: 'Trip called off', actor: manager })).status).toBe('CANCELLED');
  });
});
