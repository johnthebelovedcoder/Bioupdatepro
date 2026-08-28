import Link from 'next/link';
import { getRequisitions } from '@/lib/procurement';
import { getPurchasableItems } from '@/lib/trade';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconBox } from '@/components/icons';
import { RequisitionForm } from '@/components/requisition-form';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Requisitions — BioAssetPro' };

/**
 * What has been requested, before any supplier or price is decided.
 *
 * The client asked for this as its own explicit step — raise a requisition,
 * then convert it to an order — rather than one screen that does both. A
 * requisition here carries no commitment: approving it only says the need is
 * real, not that any money has been agreed.
 */
export default async function RequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ raised?: string }>;
}) {
  const [requisitions, items, query] = await Promise.all([
    getRequisitions(),
    getPurchasableItems(),
    searchParams,
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Requisitions"
        subtitle="What the farm has asked to buy, before a supplier or price is named"
      />

      <Tabs />

      <div className="stack">
        {query.raised ? (
          <div className="notice notice-success">
            Requisition raised and sent for approval. Once approved it can be converted into a
            purchase order.
          </div>
        ) : null}

        <TableSearch
          placeholder="Search requisitions"
          actions={<RequisitionForm items={items} today={today} />}
        >
          <Card title="All requisitions" padded={false}>
            {requisitions.length === 0 ? (
              <EmptyState
                icon={<IconBox size={22} />}
                title="Nothing requested yet"
                body="Raise a requisition above when the farm needs something bought."
              />
            ) : (
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th style={{ width: 170 }}>Requisition</th>
                      <th style={{ width: 110 }}>Date</th>
                      <th style={{ width: 130 }}>Status</th>
                      <th className="right" style={{ width: 140 }}>
                        Estimated
                      </th>
                      <th style={{ width: 160 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {requisitions.map((requisition) => (
                      <tr key={requisition.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {requisition.requisitionNumber}
                          <div className="faint">
                            {requisition.lineCount} line{requisition.lineCount === 1 ? '' : 's'}
                          </div>
                        </td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {formatDate(requisition.requestDate)}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              requisition.status === 'APPROVED'
                                ? 'badge-success'
                                : requisition.status === 'REJECTED' ||
                                    requisition.status === 'CANCELLED'
                                  ? 'badge-danger'
                                  : 'badge-warning'
                            }`}
                          >
                            {requisition.status.toLowerCase().replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="num">{formatNaira(requisition.estimatedCostKobo)}</td>
                        <td>
                          {requisition.canConvert ? (
                            <Link
                              href={`/procurement/requisitions/${requisition.id}`}
                              className="btn btn-primary"
                            >
                              Convert to PO
                            </Link>
                          ) : requisition.pendingTransactionId ? (
                            <Link href="/approvals" className="faint">
                              Awaiting approval
                            </Link>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TableSearch>
      </div>
    </>
  );
}
