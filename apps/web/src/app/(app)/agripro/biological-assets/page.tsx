import Link from 'next/link';
import { getBiologicalAssetGroups, getValuations } from '@/lib/biological-assets';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ValuationForm } from '@/components/valuation-form';
import { IconBox } from '@/components/icons';

export const metadata = { title: 'Biological assets — BioAssetPro' };

/**
 * The biological-asset ledger — §43, §61, §67, IAS 41.
 *
 * Every figure here is a posted position, not a display calculation. A
 * population's carrying value arrived through a real `Dr biological asset /
 * Cr GRNI` journal at acquisition, moved through a real mortality or
 * stage-transfer entry, and only ever revalued through a valuation a
 * Finance Controller has approved. There is nothing on this page the ledger
 * has not already agreed to.
 */
export default async function BiologicalAssetsPage() {
  const [groups, valuations] = await Promise.all([
    getBiologicalAssetGroups(),
    getValuations(),
  ]);

  const totalCarryingKobo = groups.reduce(
    (sum, g) => sum + BigInt(g.carryingValueKobo ?? '0'),
    0n,
  );
  const unposted = groups.filter((g) => !g.acquisitionPosted && BigInt(g.acquisitionCostKobo) > 0n);

  return (
    <>
      <PageHeader
        title="Biological assets"
        subtitle="Every population's carrying value, and what moved it"
      />

      <div className="stack">
        <Tabs />

        <div className="stat-grid">
          <Stat label="Populations" value={String(groups.length)} />
          <Stat label="Total carrying value" value={formatNaira(totalCarryingKobo)} money />
          <Stat
            label="Valuations raised"
            value={String(valuations.length)}
            hint="fair value less costs to sell"
          />
          <Stat
            label="Not yet posted"
            value={String(unposted.length)}
            goodWhen="down"
            hint="acquisition cost recorded, no journal yet"
          />
        </div>

        <Card title="Populations" padded={false}>
          {groups.length === 0 ? (
            <EmptyState
              icon={<IconBox size={22} />}
              title="No populations yet"
              body="Place a flock or a cohort from Farm, and its acquisition cost posts here as a biological asset."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Population</th>
                    <th style={{ width: 130 }}>Stage</th>
                    <th className="right" style={{ width: 90 }}>
                      Alive
                    </th>
                    <th className="right" style={{ width: 140 }}>
                      Per unit
                    </th>
                    <th className="right" style={{ width: 160 }}>
                      Carrying value
                    </th>
                    <th style={{ width: 140 }}>Ledger</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td className="strong" style={{ textAlign: 'left' }}>
                        {g.code}
                        <div className="faint">{g.breed}</div>
                      </td>
                      <td className="faint">{g.stage}</td>
                      <td className="num">{g.population}</td>
                      <td className="num">
                        {g.currentFvlctsPerUnitKobo ? formatNaira(g.currentFvlctsPerUnitKobo) : '—'}
                      </td>
                      <td className="num">
                        {g.carryingValueKobo ? formatNaira(g.carryingValueKobo) : '—'}
                      </td>
                      <td>
                        {g.acquisitionPosted ? (
                          <span className="badge badge-success">posted</span>
                        ) : BigInt(g.acquisitionCostKobo) > 0n ? (
                          <span className="badge badge-warning">not posted</span>
                        ) : (
                          <span className="faint">no cost recorded</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <ValuationForm groups={groups} />

        <Card title="Valuations" subtitle="Raised, and where each one stands" padded={false}>
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
