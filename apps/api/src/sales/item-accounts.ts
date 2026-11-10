import type { Prisma } from '@bioassetpro/database';
import { chartVersionOf } from '../chart/chart';
import { resolveApprovedMappedAccount } from '../posting-control/approved-account-map';
import { AccountingRuleViolation } from '../common/errors';

/**
 * Which accounts a sale of each item posts to.
 *
 * An item may name its own revenue, cost-of-sales and inventory accounts —
 * on the client's chart that is how live birds, eggs, live snails and
 * processed products each reach their own 410xxx / 510xxx / 1305xx account
 * (PCR-072). Anything an item does not name falls back to the company's
 * sales configuration, which is all there was before.
 *
 * The inventory side matters most: stock leaves the ITEM's store account.
 * Until 2026-09-25 every delivery credited the configuration's single
 * inventory account, so an item held elsewhere — eggs in 130215 — was
 * relieved from the wrong account and the two stopped agreeing.
 */
export interface SaleAccounts {
  revenue: string;
  costOfSales: string;
  inventory: string;
}

export async function saleAccountsByItem(
  client: Prisma.TransactionClient,
  companyId: string,
  itemIds: Array<string | null | undefined>,
  config: { revenueGlAccountId: string; costOfSalesGlAccountId: string; inventoryGlAccountId: string },
  on: Date,
): Promise<(itemId: string | null | undefined) => SaleAccounts> {
  const approved = (await chartVersionOf(client, companyId)) === 'APPROVED';
  const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
  const items = ids.length
    ? await client.item.findMany({
        where: { companyId, id: { in: ids } },
        select: { id: true, category: true, isBiologicalFeed: true, revenueGlAccountId: true, costOfSalesGlAccountId: true, inventoryGlAccountId: true },
      })
    : [];
  const revenueById = new Map<string, string>();
  for (const item of items) {
    let revenue = item.revenueGlAccountId ?? config.revenueGlAccountId;
    if (approved && item.category?.trim()) {
      const mapped = await resolveApprovedMappedAccount(client, {
        companyId,
        application: 'YifrehCore',
        masterType: 'Sales class',
        masterId: item.category.trim(),
        postingKey: item.isBiologicalFeed ? 'FEED_REVENUE' : 'SALES_REVENUE',
        on,
      });
      if (item.revenueGlAccountId && item.revenueGlAccountId !== mapped.glAccountId) {
        throw new AccountingRuleViolation('Approved Posting Group — sales class', `Item ${item.id} revenue account conflicts with the workbook map for its assigned sales class.`, { itemId: item.id, category: item.category });
      }
      revenue = mapped.glAccountId;
    }
    revenueById.set(item.id, revenue);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  return (itemId) => {
    const item = itemId ? byId.get(itemId) : undefined;
    return {
      revenue: item ? revenueById.get(item.id)! : config.revenueGlAccountId,
      costOfSales: item?.costOfSalesGlAccountId ?? config.costOfSalesGlAccountId,
      inventory: item?.inventoryGlAccountId ?? config.inventoryGlAccountId,
    };
  };
}

/** Sum amounts into one line per account pair, keeping first-seen order. */
export function groupByAccounts<T extends { debitAccount: string; creditAccount: string; amountKobo: bigint }>(
  rows: T[],
): Array<{ debitAccount: string; creditAccount: string; amountKobo: bigint }> {
  const out = new Map<string, { debitAccount: string; creditAccount: string; amountKobo: bigint }>();
  for (const row of rows) {
    if (row.amountKobo === 0n) continue;
    const key = `${row.debitAccount}|${row.creditAccount}`;
    const entry = out.get(key) ?? { debitAccount: row.debitAccount, creditAccount: row.creditAccount, amountKobo: 0n };
    entry.amountKobo += row.amountKobo;
    out.set(key, entry);
  }
  return [...out.values()];
}
