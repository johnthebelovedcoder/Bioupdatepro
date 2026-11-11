import { PrismaClient } from '@bioassetpro/database';

/** Seed the Finance decision required before an approved-chart posting can use a master. */
export async function assignApprovedPostingGroup(
  prisma: PrismaClient,
  params: { companyId: string; masterType: string; masterId: string; application: string; postingGroup: string; assignedById: string; effectiveFrom?: Date },
) {
  const effectiveFrom = params.effectiveFrom ?? new Date('2026-01-01');
  const group = await prisma.approvedPostingGroup.findFirstOrThrow({
    where: { companyId: params.companyId, application: params.application, postingGroup: params.postingGroup, masterType: params.masterType, status: 'Active' },
  });
  return prisma.postingGroupAssignment.create({
    data: {
      companyId: params.companyId, approvedPostingGroupId: group.id, masterType: params.masterType, masterId: params.masterId,
      effectiveFrom, status: 'Active', assignedById: params.assignedById,
    },
  });
}

export async function assignApprovedLifecycleGroups(prisma: PrismaClient, companyId: string, assignedById: string) {
  const breeds = await prisma.speciesBreed.findMany({
    where: { companyId, active: true },
    include: { stages: { where: { maturityClass: { in: ['IMMATURE', 'MATURE'] } } } },
  });
  for (const breed of breeds) {
    const species = breed.speciesKey.toLowerCase();
    if (species !== 'poultry' && species !== 'snail') continue;
    const application = species === 'poultry' ? 'YifrehPoultry' : 'YifrehSnail';
    const prefix = species === 'poultry' ? 'PLP' : 'SNP';
    for (const stage of breed.stages) {
      await assignApprovedPostingGroup(prisma, {
        companyId, masterType: 'Lifecycle stage', masterId: stage.id, application,
        postingGroup: prefix + '-BA-' + (stage.maturityClass === 'IMMATURE' ? 'IMM' : 'MAT'), assignedById,
      });
    }
  }
}

/** Give report fixtures explicit classifications for every fixture chart account. */
export async function classifyFixtureFinancialStatements(prisma: PrismaClient, companyId: string) {
  await prisma.gLAccount.updateMany({ where: { companyId, accountType: 'ASSET' }, data: { fsCategory: 'CURRENT_ASSET' } });
  await prisma.gLAccount.updateMany({ where: { companyId, accountType: 'LIABILITY' }, data: { fsCategory: 'CURRENT_LIABILITY' } });
  await prisma.gLAccount.updateMany({ where: { companyId, accountType: 'EQUITY' }, data: { fsCategory: 'EQUITY' } });
  await prisma.gLAccount.updateMany({ where: { companyId, accountType: 'REVENUE' }, data: { fsCategory: 'REVENUE' } });
  await prisma.gLAccount.updateMany({ where: { companyId, accountType: 'EXPENSE' }, data: { fsCategory: 'OPERATING_EXPENSE' } });
}
