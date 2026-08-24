import Link from 'next/link';
import {
  getGoodsReceipts,
  getPendingApprovals,
  getPurchaseOrders,
} from '@/lib/procurement';
import { Card } from './ui';
import { IconArrowRight } from './icons';

/**
 * What the platform itself has in flight.
 *
 * The dashboard was entirely a farm dashboard — feed, mortality, eggs — so a
 * customer running AgriPro Core with no species module opened it to a page
 * about animals they do not keep, and once the livestock sections were gated,
 * to a page with almost nothing on it. This is the platform's own picture, and
 * it is the half that matters to whoever is running the business rather than
 * walking the pens.
 *
 * Every figure is a document waiting on a person, in the order the work moves:
 * an order needs approving, then goods arrive, then the receipt needs
 * confirming before the ledger hears about any of it. A count with nowhere to
 * go would be a notification, so each row links to the queue it came from.
 */
export async function CoreOperations() {
  const [approvals, orders, receipts] = await Promise.all([
    getPendingApprovals().catch(() => []),
    getPurchaseOrders().catch(() => []),
    getGoodsReceipts().catch(() => []),
  ]);

  const awaitingApproval = orders.filter((order) => order.pendingTransactionId).length;
  const readyToReceive = orders.filter((order) => order.canReceive).length;
  const unposted = receipts.filter((receipt) => !receipt.journalEntryId).length;

  const rows = [
    {
      label: 'Waiting on you',
      count: approvals.length,
      detail:
        approvals.length === 0
          ? 'Nothing needs your approval'
          : 'Documents you can approve or send back',
      href: '/approvals',
    },
    {
      label: 'Orders awaiting approval',
      count: awaitingApproval,
      detail:
        awaitingApproval === 0
          ? 'No order is held up'
          : 'Goods cannot be received until these are approved',
      href: '/procurement',
    },
    {
      label: 'Deliveries expected',
      count: readyToReceive,
      detail:
        readyToReceive === 0
          ? 'Nothing outstanding on an approved order'
          : 'Approved orders with goods still to come in',
      href: '/procurement/receipts',
    },
    {
      label: 'Receipts not yet posted',
      count: unposted,
      detail:
        unposted === 0
          ? 'Every delivery has reached the ledger'
          : 'Stock is noted but the ledger has not moved',
      href: '/procurement/receipts',
    },
  ];

  return (
    <Card
      title="In flight"
      subtitle="Documents moving through AgriPro Core"
      padded={false}
    >
      {rows.map((row) => (
        <Link key={row.label} href={row.href} className="list-row">
          <div className="list-main">
            <div className="list-title">{row.label}</div>
            <div className="list-sub">{row.detail}</div>
          </div>
          <div
            className="num"
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: row.count > 0 ? 'var(--gray-900)' : 'var(--gray-400)',
            }}
          >
            {row.count}
          </div>
          <IconArrowRight size={15} />
        </Link>
      ))}
    </Card>
  );
}
