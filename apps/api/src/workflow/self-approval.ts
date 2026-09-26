import type { Prisma, PrismaClient } from '@bioassetpro/database';

type Client = Prisma.TransactionClient | PrismaClient;

/**
 * Whether the company has chosen to let one person make and check the same
 * record (a one-person farm, Company.allowSelfApproval). Off by default; where
 * it is on, the maker-checker rules allow the same person and the audit trail
 * records it, as every other approval does.
 */
export async function allowsSelfApproval(client: Client, companyId: string): Promise<boolean> {
  const company = await client.company.findUnique({ where: { id: companyId }, select: { allowSelfApproval: true } });
  return company?.allowSelfApproval === true;
}
