import type { PrismaService } from '../../src/prisma/prisma.service';
import type { EmployeeService } from '../../src/masters/employee.service';
import { VERIFICATION_CHECKS } from '../../src/masters/employee-onboarding';

/**
 * Pay as the tests mean it: proposed by the maker, approved by the checker
 * (Employee_Compensation), so it is in force.
 */
export async function setApprovedPay(
  employees: EmployeeService,
  params: Parameters<EmployeeService['setSalaryComponent']>[0],
  fixture: { companyId: string; checkerId: string },
) {
  const proposed = await employees.setSalaryComponent(params);
  return employees.decideSalaryComponent({
    companyId: fixture.companyId,
    rowId: proposed.id,
    approve: true,
    actorId: fixture.checkerId,
  });
}

/** Every check in the document pack verified (Employee_Documents). */
export async function completeDocumentPack(
  prisma: PrismaService,
  fixture: { companyId: string; checkerId: string },
  employeeId: string,
) {
  await prisma.employeeVerification.createMany({
    data: VERIFICATION_CHECKS.map((check) => ({
      companyId: fixture.companyId,
      employeeId,
      checkType: check.code,
      status: 'VERIFIED',
      reference: `TEST-${check.code}`,
      verifiedById: fixture.checkerId,
    })),
    skipDuplicates: true,
  });
}
