import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * UAT-023: a report is refused, with a reason, when it is asked about a year,
 * period, branch, farm, cost centre, department or project that is not this
 * company's, or about a period outside the year it names — rather than
 * answering quietly with nothing, which reads as "nothing happened".
 */
export async function assertReportFilter(
  prisma: PrismaService,
  filter: {
    companyId: string;
    financialYearId?: string | null;
    financialPeriodId?: string | null;
    branchId?: string | null;
    farmId?: string | null;
    costCentreId?: string | null;
    departmentId?: string | null;
    projectId?: string | null;
  },
): Promise<void> {
  const { companyId } = filter;
  const refuse = (what: string) => {
    throw new BadRequestException(`That ${what} is not one of this company's. Choose one from the list.`);
  };
  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const checks: Array<Promise<void>> = [];
  const owned = (value: string | null | undefined, what: string, find: (id: string) => Promise<unknown>) => {
    if (!value) return;
    if (!isUuid(value)) refuse(what);
    checks.push(find(value).then((row) => (row ? undefined : refuse(what))));
  };
  owned(filter.financialYearId, 'financial year', (id) => prisma.financialYear.findFirst({ where: { id, companyId }, select: { id: true } }));
  owned(filter.branchId, 'branch', (id) => prisma.branch.findFirst({ where: { id, companyId }, select: { id: true } }));
  owned(filter.farmId, 'farm', (id) => prisma.farm.findFirst({ where: { id, companyId }, select: { id: true } }));
  owned(filter.costCentreId, 'cost centre', (id) => prisma.costCentre.findFirst({ where: { id, companyId }, select: { id: true } }));
  owned(filter.departmentId, 'department', (id) => prisma.department.findFirst({ where: { id, companyId }, select: { id: true } }));
  owned(filter.projectId, 'project', (id) => prisma.project.findFirst({ where: { id, companyId }, select: { id: true } }));
  await Promise.all(checks);

  if (filter.financialPeriodId) {
    if (!isUuid(filter.financialPeriodId)) refuse('period');
    const period = await prisma.financialPeriod.findFirst({
      where: { id: filter.financialPeriodId, financialYear: { companyId } },
      select: { financialYearId: true, name: true },
    });
    if (!period) refuse('period');
    if (filter.financialYearId && period!.financialYearId !== filter.financialYearId) {
      throw new BadRequestException(`${period!.name} is not in the financial year chosen. Pick a period inside that year.`);
    }
  }
}
