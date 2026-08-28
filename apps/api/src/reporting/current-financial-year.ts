import type { PrismaService } from '../prisma/prisma.service';

/** The financial year whose date range covers today, if one is open. */
export async function currentFinancialYearId(
  prisma: PrismaService,
  companyId: string,
): Promise<string | null> {
  const today = new Date();
  const year = await prisma.financialYear.findFirst({
    where: { companyId, startDate: { lte: today }, endDate: { gte: today } },
    select: { id: true },
  });
  return year?.id ?? null;
}

/** The financial period whose date range covers today, if one is open. */
export async function currentFinancialPeriodId(
  prisma: PrismaService,
  companyId: string,
): Promise<string | null> {
  const today = new Date();
  const period = await prisma.financialPeriod.findFirst({
    where: {
      financialYear: { companyId },
      startDate: { lte: today },
      endDate: { gte: today },
    },
    select: { id: true },
  });
  return period?.id ?? null;
}
