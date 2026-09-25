import { Injectable } from '@nestjs/common';
import { SalesInvoiceStatus, SupplierInvoiceStatus, StockDirection } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { TrialBalanceService } from './trial-balance.service';
import { chartVersionOf, numberFor } from '../chart/chart';

export interface ControlReconciliationRow {
  accountNumber: string;
  accountName: string;
  /** Debit-positive, same convention as TrialBalanceService. */
  glBalanceKobo: string;
  subledgerKobo: string;
  varianceKobo: string;
  reconciled: boolean;
  source: string;
}

/**
 * US-897-029's remaining criterion: proving a CONTROL account's GL balance
 * actually equals the subledger detail that is supposed to be the only thing
 * ever posted to it — not a manual reconciliation process, since nothing can
 * post to these accounts except the governed services below, but a live
 * check that the invariant those services promise actually holds.
 *
 * Deliberately NOT a generic sweep over every `PostingKey.ledgerFlag ===
 * CONTROL` row — the register's own audit already found `130100` carrying
 * two conflicting ledger flags across different rules, so that field alone
 * isn't a safe enumeration source. Three concrete, unambiguous pairs instead:
 *
 * - AR (120100) vs. the sum of open sales invoices — the same formula the
 *   AR-ageing report already uses.
 * - AP (210100) vs. the sum of open supplier invoices — same, AP-ageing.
 * - Every inventory GL account any `Item.inventoryGlAccountId` actually
 *   points at, vs. the net value of every `StockMovement` for items mapped
 *   to it — covers Raw Materials, Feed Inventory, and every finished-goods
 *   account generically, not one hardcoded number.
 * - WIP, by processing cycle (130410 SnailPro / 130420 PoultryPro / 130430
 *   Feed Mill) vs. the sum of every ProductionOrder's own closing-WIP
 *   figure (`wipDebits - finishedGoodsCostKobo - abnormalLossCostKobo`) —
 *   zero by construction (Rule 7) for a completed order, so this is really
 *   "does every still-open order's WIP actually equal what the GL shows."
 */
@Injectable()
export class ControlAccountReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trialBalance: TrialBalanceService,
  ) {}

  async reconcile(companyId: string): Promise<ControlReconciliationRow[]> {
    // Built ONCE and shared — every row below reads its own account's balance
    // out of this same trial balance rather than re-running the full
    // journal-line aggregate per account.
    const tb = await this.trialBalance.build({ companyId });
    const balanceOf = (accountNumber: string): bigint =>
      tb.rows.find((r) => r.accountNumber === accountNumber)?.netKobo ?? 0n;

    // AR and AP on the company's own chart: 1201/2201 until it moves, 120100/210100 after.
    const version = await chartVersionOf(this.prisma, companyId);
    const [ar, ap, inventory, wip] = await Promise.all([
      this.receivables(companyId, balanceOf, numberFor(version, 'receivables')),
      this.payables(companyId, balanceOf, numberFor(version, 'tradePayables')),
      this.inventoryByGlAccount(companyId, balanceOf),
      this.wipByCycle(companyId, balanceOf),
    ]);
    return [ar, ap, ...inventory, ...wip];
  }

  private async receivables(companyId: string, balanceOf: (accountNumber: string) => bigint, account: string): Promise<ControlReconciliationRow> {
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { companyId, status: { in: [SalesInvoiceStatus.POSTED, SalesInvoiceStatus.PART_PAID] } },
      select: { grossAmountKobo: true, settledAmountKobo: true },
    });
    const subledgerKobo = invoices.reduce((s, i) => s + (i.grossAmountKobo - i.settledAmountKobo), 0n);
    return this.row(account, 'Trade Receivables', balanceOf(account), subledgerKobo, `${invoices.length} open sales invoices`);
  }

  private async payables(companyId: string, balanceOf: (accountNumber: string) => bigint, account: string): Promise<ControlReconciliationRow> {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: { companyId, status: { in: [SupplierInvoiceStatus.POSTED, SupplierInvoiceStatus.PART_PAID] } },
      select: { grossAmountKobo: true, settledAmountKobo: true },
    });
    // Payables is a credit-normal-balance account; TrialBalanceService's
    // debit-positive convention makes an ordinary payables balance NEGATIVE.
    // The subledger sum below is naturally positive (an amount owed), so it
    // is negated here to compare like with like, not the other way round.
    const subledgerKobo = -invoices.reduce((s, i) => s + (i.grossAmountKobo - i.settledAmountKobo), 0n);
    return this.row(account, 'Trade Payables', balanceOf(account), subledgerKobo, `${invoices.length} open supplier invoices`);
  }

  private async inventoryByGlAccount(companyId: string, balanceOf: (accountNumber: string) => bigint): Promise<ControlReconciliationRow[]> {
    const items = await this.prisma.item.findMany({
      where: { companyId, inventoryGlAccountId: { not: null } },
      select: { id: true, inventoryGlAccountId: true },
    });
    if (items.length === 0) return [];

    const itemsByAccount = new Map<string, string[]>();
    for (const item of items) {
      const accountId = item.inventoryGlAccountId!;
      const list = itemsByAccount.get(accountId) ?? [];
      list.push(item.id);
      itemsByAccount.set(accountId, list);
    }

    const accounts = await this.prisma.gLAccount.findMany({
      where: { id: { in: [...itemsByAccount.keys()] } },
      select: { id: true, accountNumber: true, name: true },
    });

    const movements = await this.prisma.stockMovement.groupBy({
      by: ['itemId', 'direction'],
      where: { companyId, itemId: { in: items.map((i) => i.id) } },
      _sum: { valueKobo: true },
    });
    const valueByItem = new Map<string, bigint>();
    for (const m of movements) {
      const signed = (m.direction === StockDirection.IN ? 1n : -1n) * (m._sum.valueKobo ?? 0n);
      valueByItem.set(m.itemId, (valueByItem.get(m.itemId) ?? 0n) + signed);
    }

    const rows: ControlReconciliationRow[] = [];
    for (const account of accounts) {
      const itemIds = itemsByAccount.get(account.id) ?? [];
      const subledgerKobo = itemIds.reduce((s, id) => s + (valueByItem.get(id) ?? 0n), 0n);
      rows.push(this.row(account.accountNumber, account.name, balanceOf(account.accountNumber), subledgerKobo, `${itemIds.length} items`));
    }
    return rows.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  }

  private async wipByCycle(companyId: string, balanceOf: (accountNumber: string) => bigint): Promise<ControlReconciliationRow[]> {
    const CYCLE_ACCOUNTS: Record<string, { accountNumber: string; name: string }> = {
      SNAILPRO: { accountNumber: '130410', name: 'WIP — Snail Processing' },
      POULTRYPRO: { accountNumber: '130420', name: 'WIP — Poultry Processing' },
      FEED_MILL: { accountNumber: '130430', name: 'Feed Mill WIP' },
    };

    const orders = await this.prisma.productionOrder.findMany({
      where: { companyId },
      select: {
        processingCycle: true,
        biologicalInputValueKobo: true,
        rearingCostKobo: true,
        packagingCostKobo: true,
        settledAt: true,
        standardConversionCostKobo: true,
        finishedGoodsCostKobo: true,
        abnormalLossCostKobo: true,
      },
    });

    const byCycle = new Map<string, { subledgerKobo: bigint; count: number }>();
    for (const order of orders) {
      // The same WIP debits settle() checks: biological input, its rearing cost, packaging, standard conversion.
      const wipDebits = order.biologicalInputValueKobo + order.rearingCostKobo + order.packagingCostKobo + order.standardConversionCostKobo;
      const closingWip = wipDebits - order.finishedGoodsCostKobo - order.abnormalLossCostKobo;
      const entry = byCycle.get(order.processingCycle) ?? { subledgerKobo: 0n, count: 0 };
      entry.subledgerKobo += closingWip;
      entry.count += 1;
      byCycle.set(order.processingCycle, entry);
    }

    const rows: ControlReconciliationRow[] = [];
    for (const [cycle, meta] of Object.entries(CYCLE_ACCOUNTS)) {
      const entry = byCycle.get(cycle);
      if (!entry) continue; // No orders raised for this cycle — nothing to reconcile.
      rows.push(this.row(meta.accountNumber, meta.name, balanceOf(meta.accountNumber), entry.subledgerKobo, `${entry.count} production orders`));
    }

    /*
     * The processing recovery accounts (PCR-053/076 credit them with the
     * standard absorbed; PCR-058/080 clear them at settlement). Their balance
     * is the standard absorbed by orders not yet settled, as a credit — and
     * nothing once every order is settled. A residual is conversion cost
     * counted twice (orders settled before 2026-09-25 cleared only the variance).
     */
    const RECOVERY: Record<string, { accountNumber: string; name: string }> = {
      SNAILPRO: { accountNumber: '219810', name: 'S_Recovery_GL' },
      POULTRYPRO: { accountNumber: '219820', name: 'P_Recovery_GL' },
    };
    for (const [cycle, meta] of Object.entries(RECOVERY)) {
      const cycleOrders = orders.filter((o) => o.processingCycle === cycle);
      if (cycleOrders.length === 0) continue;
      const open = cycleOrders.filter((o) => o.settledAt === null);
      const expected = -open.reduce((n, o) => n + o.standardConversionCostKobo, 0n);
      rows.push(this.row(meta.accountNumber, meta.name, balanceOf(meta.accountNumber), expected, `${open.length} unsettled of ${cycleOrders.length} production orders`));
    }
    return rows;
  }

  private row(
    accountNumber: string,
    accountName: string,
    glBalanceKobo: bigint,
    subledgerKobo: bigint,
    source: string,
  ): ControlReconciliationRow {
    const varianceKobo = glBalanceKobo - subledgerKobo;
    return {
      accountNumber,
      accountName,
      glBalanceKobo: glBalanceKobo.toString(),
      subledgerKobo: subledgerKobo.toString(),
      varianceKobo: varianceKobo.toString(),
      reconciled: varianceKobo === 0n,
      source,
    };
  }
}
