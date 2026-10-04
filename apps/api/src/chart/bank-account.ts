import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@bioassetpro/database';
import { AccountingRuleViolation } from '../common/errors';
import { allNumbersFor } from './chart';

type Client = PrismaService | Prisma.TransactionClient;

/**
 * The GL accounts cash can be paid from or received into: the bank role's
 * account on every chart (1101, 110100, 10100 — the last is a control account
 * on the approved chart, which is why a list of posting accounts cannot offer
 * it) and the account of any registered bank account.
 */
export async function bankGlAccounts(client: Client, companyId: string) {
  const registered = await client.bankAccount.findMany({ where: { companyId }, select: { glAccountId: true } });
  return client.gLAccount.findMany({
    where: {
      companyId,
      active: true,
      OR: [{ accountNumber: { in: allNumbersFor('bank') } }, { id: { in: registered.map((r) => r.glAccountId) } }],
    },
    orderBy: { accountNumber: 'asc' },
    select: { id: true, accountNumber: true, name: true, accountType: true },
  });
}

/** Refuses a payment or receipt whose cash account is not a bank or cash account (it would post to revenue, receivables, …). */
export async function assertBankGlAccount(client: Client, companyId: string, glAccountId: string, purpose: string): Promise<void> {
  const allowed = await bankGlAccounts(client, companyId);
  if (allowed.some((a) => a.id === glAccountId)) return;
  const named = await client.gLAccount.findFirst({ where: { id: glAccountId, companyId }, select: { accountNumber: true, name: true } });
  throw new AccountingRuleViolation(
    'Cash and bank accounts',
    `${purpose} must go through a bank or cash account${named ? `, not ${named.accountNumber} ${named.name}` : ''}. Choose one of: ${allowed.map((a) => `${a.accountNumber} ${a.name}`).join(', ') || 'none is set up'}.`,
    { glAccountId },
  );
}
