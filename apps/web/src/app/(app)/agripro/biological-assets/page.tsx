import { getBiologicalAssetGroups } from '@/lib/biological-assets';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';
import { IconBox } from '@/components/icons';

export const metadata = { title: 'Biological assets — BioAssetPro' };

/**
 * The biological-asset register — §43, §61, §67, IAS 41.
 *
 * Every figure here is a posted position, not a display calculation. A
 * population's carrying value arrived through a real `Dr biological asset /
 * Cr GRNI` journal at acquisition and moved through a real mortality or
 * stage-transfer entry. Valuations live on their own tab — raising one is a
 * separate action from browsing what the farm currently holds.
 */
export default async function BiologicalAssetsPage() {
  const groups = await getBiologicalAssetGroups();

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
            label="Not yet posted"
            value={String(unposted.length)}
            goodWhen="down"
            hint="acquisition cost recorded, no journal yet"
          />
        </div>

        <TableSearch placeholder="Search populations">
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
        </TableSearch>
      </div>
    </>
  );
}
