import { getCostPools, getUnusedCapacity } from '@/lib/production';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { NewCostPoolButton } from '@/components/new-cost-pool-button';
import { SetCostPoolRateButton } from '@/components/set-cost-pool-rate-button';
import { IconChart } from '@/components/icons';
import { PoolSourcesForm } from '@/components/pool-sources-form';
import { api } from '@/lib/api';
import { getGlAccounts } from '@/lib/trade';

interface PoolReconciliation {
  poolId: string;
  code: string;
  name: string;
  sources: Array<{ glAccountId: string; costCentreId: string | null; account: string }>;
  hasRate: boolean;
  window?: { from: string; to: string };
  ledgerKobo?: string;
  absorbedKobo?: string;
  notYetAbsorbedKobo?: string;
  unusedCapacityKobo?: string;
  differenceKobo?: string;
  rateVsLedgerKobo?: string;
  reconciled: boolean;
  note: string | null;
}

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
  const [recon, accounts, dimensions] = await Promise.all([
    api<PoolReconciliation[]>('/costing/cost-pools/reconciliation').catch(() => [] as PoolReconciliation[]),
    getGlAccounts().catch(() => []),
    api<{ costCentres: Array<{ id: string; code: string; name: string }> }>('/reporting/dimensions').catch(() => ({ costCentres: [] })),
  ]);
  const accountOptions = accounts.filter((a) => a.accountType === 'EXPENSE').map((a) => ({ id: a.id, label: `${a.accountNumber} ${a.name}` }));
  const centreOptions = dimensions.costCentres.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }));

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

        <Card
          title="Pools against the ledger"
          subtitle="AC-MFG-004: each pool's ledger cost over its rate's window, against what orders absorbed and the capacity left unused"
          padded={false}
        >
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th className="right">Ledger cost</th>
                  <th className="right">Absorbed</th>
                  <th className="right">Unused capacity</th>
                  <th className="right">Spending variance</th>
                  <th className="right">Rate vs ledger</th>
                  <th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {recon.map((r) => (
                  <tr key={r.poolId}>
                    <td style={{ textAlign: 'left' }}>
                      <span className="strong">{r.code}</span> {r.name}
                      <div className="faint" style={{ fontSize: 12 }}>
                        {r.sources.length ? r.sources.map((s) => s.account).join(', ') : r.note}
                        {r.window ? ` · ${r.window.from} to ${r.window.to}` : ''}
                      </div>
                    </td>
                    <td className="num right">{r.ledgerKobo ? formatNaira(r.ledgerKobo) : '—'}</td>
                    <td className="num right">
                      {r.absorbedKobo ? formatNaira(r.absorbedKobo) : '—'}
                      {r.notYetAbsorbedKobo && r.notYetAbsorbedKobo !== '0' ? <div className="faint">+{formatNaira(r.notYetAbsorbedKobo)} to come</div> : null}
                    </td>
                    <td className="num right">{r.unusedCapacityKobo ? formatNaira(r.unusedCapacityKobo) : '—'}</td>
                    <td className="num right">
                      {r.differenceKobo !== undefined ? (
                        <span className={`badge ${r.differenceKobo === '0' ? 'badge-success' : 'badge-warning'}`}>{formatNaira(r.differenceKobo)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num right">{r.rateVsLedgerKobo ? formatNaira(r.rateVsLedgerKobo) : '—'}</td>
                    <td>
                      <PoolSourcesForm
                        poolId={r.poolId}
                        poolCode={r.code}
                        current={r.sources.map((s) => ({ glAccountId: s.glAccountId, costCentreId: s.costCentreId }))}
                        accounts={accountOptions}
                        costCentres={centreOptions}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
