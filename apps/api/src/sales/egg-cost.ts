import { AccountingRuleViolation } from '../common/errors';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Eggs are valued when collected (PCR-067, EggPostingService), not at a
 * standard cost. Stock movements out of — or back into — the eggs item must
 * therefore use what they are carried at: the item's moving weighted
 * average, which each collection sets as it comes into stock. A standard
 * cost would move eggs through Eggs (130215) at a different figure than they
 * went in at, leaving value behind on an empty shelf.
 */
export async function eggItemIds(prisma: PrismaService, companyId: string): Promise<Set<string>> {
  const policies = await prisma.eggValuePolicy.findMany({
    where: { companyId },
    select: { itemId: true },
    distinct: ['itemId'],
  });
  return new Set(policies.map((policy) => policy.itemId));
}

/** One unit of eggs at the value they are carried at in stock. */
export async function eggUnitCost(prisma: PrismaService, itemId: string): Promise<bigint> {
  const item = await prisma.item.findUniqueOrThrow({
    where: { id: itemId },
    select: { code: true, weightedAverageCostKobo: true },
  });
  if (item.weightedAverageCostKobo === null) {
    throw new AccountingRuleViolation(
      'PCR-067 — Egg stock',
      `No eggs of "${item.code}" have been valued into stock yet. Set the egg value under Books → Farm costing, then post the waiting collections.`,
      { itemId },
    );
  }
  return item.weightedAverageCostKobo;
}
