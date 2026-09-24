import { getCostPools, getUnusedCapacity } from '@/lib/production';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { NewCostPoolButton } from '@/components/new-cost-pool-button';
import { SetCostPoolRateButton } from '@/components/set-cost-pool-rate-button';
import { IconChart } from '@/components/icons';

export const metadata = { title: 'Cost pools — BioAssetPro' };

/**
 * Activity cost pools — US-897-015.
 *
 * Overhead absorbed by what actually drives it, not spread evenly across
 * every unit regardless of how much of the pool it used. A routing
 * operation picks a pool; a production order's routing lines absorb the
 * pool's rate for the hours it actually ran.
 */
export default async function CostPoolsPage() {
  const pools = await getCostPools();
  // Capacity paid for but not absorbed by any order — the cost ABC exists to
  // make visible, since it would otherwise sit silently inside the rate.
  const idle = await Promise.all(pools.map((pool) => getUnusedCapacity(pool.id)));

  return (
    <>
      <PageHeader
        title="Cost pools"
        subtitle="Overhead grouped by what drives it — machine hours, labour hours, kilos processed"
      />

      <div className="stack">
        <Tabs />

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <NewCostPoolButton />
        </div>

        <Card title={`${pools.length} ${pools.length === 1 ? 'pool' : 'pools'}`} padded={false}>
          {pools.length === 0 ? (
            <EmptyState
              icon={<IconChart size={22} />}
              title="No cost pools yet"
              body="Add the first one above. A routing operation needs a pool to absorb overhead into — nothing can be costed until one exists."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Code</th>
                    <th>Name</th>
                    <th>Driver</th>
                    <th className="right" style={{ width: 140 }}>
                      Pool cost
                    </th>
                    <th className="right" style={{ width: 120 }}>
                      Capacity
                    </th>
                    <th className="right" style={{ width: 130 }}>
                      Rate
                    </th>
                    <th className="right" style={{ width: 150 }}>
                      Idle capacity
                    </th>
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {pools.map((pool, index) => (
                    <tr key={pool.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {pool.code}
                      </td>
                      <td>{pool.name}</td>
                      <td className="faint">{pool.driverName}</td>
                      <td className="num">
                        {pool.poolCostKobo ? formatNaira(pool.poolCostKobo) : '—'}
                      </td>
                      <td className="num">{pool.practicalCapacity ?? '—'}</td>
                      <td className="num">
                        {pool.ratePerUnitKobo ? `${formatNaira(pool.ratePerUnitKobo)}/unit` : '—'}
                      </td>
                      <td className="num">
                        {(() => {
                          const unused = idle[index];
                          if (!unused || !unused.hasRate) return '—';
                          return (
                            <>
                              {formatNaira(unused.unusedCapacityCostKobo)}
                              <div className="faint">
                                {unused.unusedCapacity} of {unused.practicalCapacity} unused
                              </div>
                            </>
                          );
                        })()}
                      </td>
                      <td>
                        <SetCostPoolRateButton poolId={pool.id} poolName={pool.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
