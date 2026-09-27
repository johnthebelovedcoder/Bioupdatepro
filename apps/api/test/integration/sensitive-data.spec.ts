import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { EmployeeService } from '../../src/masters/employee.service';
import { EmployeeOnboardingService } from '../../src/masters/employee-onboarding.service';
import { EmployeeSealService } from '../../src/masters/employee-seal.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Sensitive personal data (handbook security controls): an employee's bank
 * account, TIN, RSA and NHF numbers are encrypted in the database, masked
 * wherever they are shown, visible in the clear only to the roles allowed,
 * and every such view is logged.
 */
describe('Sensitive employee numbers', () => {
  let prisma: PrismaService;
  let employees: EmployeeService;
  let onboarding: EmployeeOnboardingService;
  let fixture: TestFixture;
  const originalKey = process.env.PII_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = 'integration-test-key';
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    employees = new EmployeeService(prisma, audit);
    onboarding = new EmployeeOnboardingService(prisma, audit, employees);
  });

  afterAll(async () => {
    if (originalKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = originalKey;
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);
  });

  const makeEmployee = (overrides: Record<string, unknown> = {}) =>
    employees.create({
      companyId: fixture.companyId,
      employeeNumber: `EMP-${Math.random().toString(36).slice(2, 7)}`,
      firstName: 'Amina',
      surname: 'Yusuf',
      employmentDate: new Date('2026-01-01'),
      departmentId: fixture.departmentId,
      branchId: fixture.branchId,
      costCentreId: fixture.costCentreId,
      bankName: 'Test Bank',
      accountNumber: '0123456789',
      tin: 'TIN-1001',
      nhfNumber: 'NHF-77',
      pensionRsaNumber: 'PEN100200300',
      taxState: 'Lagos',
      actorId: fixture.makerId,
      ...overrides,
    });

  it('stores the numbers encrypted: the database never holds them in the clear', async () => {
    const employee = await makeEmployee();
    const [row] = await prisma.$queryRaw<Array<Record<string, string>>>`
      SELECT account_number, tin, nhf_number, pension_rsa_number, account_number_hash FROM employees WHERE id = ${employee.id}::uuid`;
    for (const [column, plain] of [['account_number', '0123456789'], ['tin', 'TIN-1001'], ['nhf_number', 'NHF-77'], ['pension_rsa_number', 'PEN100200300']] as const) {
      expect(row![column]).toMatch(/^enc:v1:/);
      expect(row![column]).not.toContain(plain);
    }
    expect(row!.account_number_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('masks them on the employee record', async () => {
    const employee = await makeEmployee();
    const view = await onboarding.onboarding(fixture.companyId, employee.id, new Date('2026-01-15'));
    expect(view.employee.details).toMatchObject({ accountNumber: '••••6789', tin: '••••1001', nhfNumber: '••••F-77', pensionRsaNumber: '••••0300' });
    expect(view.employee.encrypted).toBe(true);
  });

  it('shows them in the clear only to the roles allowed, and logs every look without the numbers', async () => {
    const employee = await makeEmployee();
    await expect(
      onboarding.reveal({ companyId: fixture.companyId, employeeId: employee.id, actor: { userId: fixture.makerId, roles: ['FARM_MANAGER'] } }),
    ).rejects.toThrow(/shown to HR and finance managers, treasury/);

    const shown = await onboarding.reveal({
      companyId: fixture.companyId,
      employeeId: employee.id,
      actor: { userId: fixture.checkerId, roles: ['HR_MANAGER'], ipAddress: '10.0.0.7' },
    });
    expect(shown).toMatchObject({ accountNumber: '0123456789', tin: 'TIN-1001', nhfNumber: 'NHF-77', pensionRsaNumber: 'PEN100200300' });

    const views = await prisma.auditRecord.findMany({ where: { entityId: employee.id, action: 'VIEW' } });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ userId: fixture.checkerId, ipAddress: '10.0.0.7' });
    expect(views[0]!.comments).toMatch(/Viewed accountNumber, tin, nhfNumber, pensionRsaNumber for EMP-/);
    expect(JSON.stringify(views[0])).not.toContain('0123456789');
  });

  it('still refuses a second employee on the same bank account or TIN', async () => {
    await makeEmployee();
    await expect(makeEmployee({ accountNumber: '0123 456 789', tin: 'TIN-2002' })).rejects.toThrow(/Account ••••6789 is already EMP-/);
    await expect(makeEmployee({ accountNumber: '9999999999', tin: 'tin-1001' })).rejects.toThrow(/TIN ••••1001 is already EMP-/);
  });

  it('treats an unchanged number as unchanged, so its verification stands', async () => {
    const employee = await makeEmployee();
    await prisma.employeeVerification.create({
      data: { companyId: fixture.companyId, employeeId: employee.id, checkType: 'BANK', status: 'VERIFIED', verifiedById: fixture.checkerId },
    });
    await onboarding.updateDetails({ companyId: fixture.companyId, employeeId: employee.id, details: { accountNumber: '0123456789' }, actorId: fixture.makerId });
    expect(await prisma.employeeVerification.count({ where: { companyId: fixture.companyId, employeeId: employee.id, checkType: 'BANK' } })).toBe(1);

    await onboarding.updateDetails({ companyId: fixture.companyId, employeeId: employee.id, details: { accountNumber: '5555555555' }, actorId: fixture.makerId });
    expect(await prisma.employeeVerification.count({ where: { companyId: fixture.companyId, employeeId: employee.id, checkType: 'BANK' } })).toBe(0);
    const shown = await onboarding.reveal({ companyId: fixture.companyId, employeeId: employee.id, actor: { userId: fixture.checkerId, roles: ['CFO'] } });
    expect(shown.accountNumber).toBe('5555555555');
  });

  it('treats the NIN and NHIA number the same way, and refuses one NIN on two employees', async () => {
    const employee = await makeEmployee({ nin: '12345678901', nhiaNumber: 'NHIA-5566' });
    const [row] = await prisma.$queryRaw<Array<Record<string, string>>>`SELECT nin, nhia_number, nin_hash FROM employees WHERE id = ${employee.id}::uuid`;
    expect(row!.nin).toMatch(/^enc:v1:/);
    expect(row!.nhia_number).toMatch(/^enc:v1:/);
    expect(row!.nin_hash).toMatch(/^[0-9a-f]{64}$/);

    const view = await onboarding.onboarding(fixture.companyId, employee.id, new Date('2026-01-15'));
    expect(view.employee.details).toMatchObject({ nin: '••••8901', nhiaNumber: '••••5566' });
    const shown = await onboarding.reveal({ companyId: fixture.companyId, employeeId: employee.id, actor: { userId: fixture.checkerId, roles: ['HR_MANAGER'] } });
    expect(shown).toMatchObject({ nin: '12345678901', nhiaNumber: 'NHIA-5566' });

    await expect(makeEmployee({ accountNumber: '8888888888', tin: 'TIN-3003', nin: '12345678901' })).rejects.toThrow(/NIN ••••8901 is already EMP-/);
  });

  it('needs the number before an identity check is verified, and keeps the evidence reference sealed and masked', async () => {
    const employee = await makeEmployee();
    await expect(
      onboarding.verify({ companyId: fixture.companyId, employeeId: employee.id, checkType: 'NIN', status: 'VERIFIED', reference: 'NIN slip 12345678901', actorId: fixture.checkerId }),
    ).rejects.toThrow(/Record the NIN before verifying/);

    await onboarding.updateDetails({ companyId: fixture.companyId, employeeId: employee.id, details: { nin: '12345678901' }, actorId: fixture.makerId });
    await onboarding.verify({ companyId: fixture.companyId, employeeId: employee.id, checkType: 'NIN', status: 'VERIFIED', reference: 'NIN slip 12345678901', actorId: fixture.checkerId });

    const stored = await prisma.employeeVerification.findFirstOrThrow({ where: { companyId: fixture.companyId, employeeId: employee.id, checkType: 'NIN' } });
    expect(stored.reference).toMatch(/^enc:v1:/);
    const view = await onboarding.onboarding(fixture.companyId, employee.id, new Date('2026-01-15'));
    expect(view.checks.find((c) => c.code === 'NIN')!.reference).toBe('••••8901');
    const audit = await prisma.auditRecord.findFirstOrThrow({ where: { companyId: fixture.companyId, entityType: 'EmployeeVerification', entityId: stored.id } });
    expect(audit.comments).not.toContain('12345678901');

    // A non-identity check's reference is left as written.
    await onboarding.verify({ companyId: fixture.companyId, employeeId: employee.id, checkType: 'CONTRACT', status: 'VERIFIED', reference: 'HR file 7', actorId: fixture.checkerId });
    expect((await onboarding.onboarding(fixture.companyId, employee.id, new Date('2026-01-15'))).checks.find((c) => c.code === 'CONTRACT')!.reference).toBe('HR file 7');

    // Changing the NIN undoes its verification.
    await onboarding.updateDetails({ companyId: fixture.companyId, employeeId: employee.id, details: { nin: '10987654321' }, actorId: fixture.makerId });
    expect(await prisma.employeeVerification.count({ where: { companyId: fixture.companyId, employeeId: employee.id, checkType: 'NIN' } })).toBe(0);
  });

  it('encrypts records written before the key was set', async () => {
    const employee = await makeEmployee();
    await prisma.employee.updateMany({
      where: { id: employee.id, companyId: fixture.companyId },
      data: { accountNumber: '1111111111', tin: 'TIN-OLD', nhfNumber: null, pensionRsaNumber: null, accountNumberHash: null, tinHash: null },
    });
    const oldReference = await prisma.employeeVerification.create({
      data: { companyId: fixture.companyId, employeeId: employee.id, checkType: 'BANK', status: 'VERIFIED', reference: 'Bank letter 1111111111', verifiedById: fixture.checkerId },
    });
    // The employee record and the bank check's reference.
    expect(await new EmployeeSealService(prisma).sealAll()).toEqual({ sealed: 2 });
    expect((await prisma.employeeVerification.findFirstOrThrow({ where: { id: oldReference.id, companyId: fixture.companyId } })).reference).toMatch(/^enc:v1:/);
    const row = await prisma.employee.findFirstOrThrow({ where: { id: employee.id, companyId: fixture.companyId } });
    expect(row.accountNumber).toMatch(/^enc:v1:/);
    expect(row.accountNumberHash).toMatch(/^[0-9a-f]{64}$/);
    // Idempotent: a second pass finds nothing to do.
    expect(await new EmployeeSealService(prisma).sealAll()).toEqual({ sealed: 0 });
    await expect(makeEmployee({ accountNumber: '1111111111', tin: 'TIN-NEW' })).rejects.toThrow(/already EMP-/);
  });
});
