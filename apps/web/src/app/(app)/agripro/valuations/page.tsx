import Link from 'next/link';
import { getBiologicalAssetGroups, getValuations } from '@/lib/biological-assets';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ValuationForm } from '@/components/valuation-form';
import { TableSearch } from '@/components/table-search';
import { IconBox } from '@/components/icons';

export const metadata = { title: 'Valuations — BioAssetPro' };

/**
 * Fair-value valuations — §61, §67, IAS 41.
 *
 * A valuation only ever asserts two numbers: a market price and a cost to
 * sell. Submitting one sends it to /approvals; it does not post. The gain or
 * loss only reaches the ledger once a Finance Controller approves it.
 */
export default async function ValuationsPage() {
  const [groups, valuations] = await Promise.all([
    getBiologicalAssetGroups(),
    getValuations(),
  ]);

  return (
    <>
      <PageHeader
        title="Valuations"
        subtitle="Fair value less costs to sell, raised per population and approved before it reaches the ledger"
      />

      <div className="stack">
        <Tabs />

        <TableSearch
          placeholder="Search valuations"
          actions={<ValuationForm groups={groups} />}
        >
          <Card
            title={`${valuations.length} ${valuations.length === 1 ? 'valuation' : 'valuations'} raised`}
            subtitle="Where each one stands"
            padded={false}
          >
            {valuations.length === 0 ? (
              <EmptyState
                icon={<IconBox size={22} />}
                title="No valuations yet"
                body="Raise one above once a population has a posted acquisition."
              />
            ) : (
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>Population</th>
                      <th style={{ width: 110 }}>Date</th>
                      <th className="right" style={{ width: 140 }}>
                        Rate change
                      </th>
                      <th className="right" style={{ width: 140 }}>
                        Gain / loss
                      </th>
                      <th style={{ width: 200 }}>Evidence</th>
                      <th style={{ width: 130 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuations.map((v) => (
                      <tr key={v.id}>
                        <td className="strong" style={{ textAlign: 'left' }}>
                          {v.groupCode}
                          <div className="faint">by {v.preparedBy}</div>
                        </td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {formatDate(v.valuationDate)}
                        </td>
                        <td className="num">
                          {formatNaira(v.priorFvlctsPerUnitKobo)} →{' '}
                          {formatNaira(v.currentFvlctsPerUnitKobo)}
                        </td>
                        <td className="num">
                          <span
                            style={{
                              color: v.direction === 'GAIN' ? 'var(--success-700)' : 'var(--error-700)',
                            }}
                          >
                            {v.direction === 'GAIN' ? '+' : '−'}
                            {formatNaira(v.gainLossKobo)}
                          </span>
                        </td>
                        <td className="faint">{v.evidenceReference}</td>
                        <td>
                          {v.status === 'POSTED' ? (
                            <span className="badge badge-success">posted</span>
                          ) : v.status === 'REJECTED' ? (
                            <span className="badge badge-danger">rejected</span>
                          ) : (
                            <span className="badge badge-warning">
                              {v.status.toLowerCase().replace(/_/g, ' ')}
                            </span>
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

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            A valuation waiting for approval sits in{' '}
            <Link href="/approvals">the same approvals queue</Link> as every other document —
            approving it is the moment the gain or loss reaches the ledger.
          </p>
        </Card>
      </div>
    </>
  );
}
