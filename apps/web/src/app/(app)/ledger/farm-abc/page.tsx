import { api, ApiError } from '@/lib/api';
import { defaultYear, getContext } from '@/lib/org';
import { formatNaira } from '@/lib/money';
import type { SessionUser } from '@/lib/session';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconChart } from '@/components/icons';
import { AbcRateForm } from '@/components/abc-rate-form';

export const metadata = { title: 'Farm ABC — BioAssetPro' };

interface Outcome {
  keptKobo: string;
  liveKobo: string;
  processingKobo: string;
}
interface Snailery {
  financialYear: string;
  pools: { feedKobo: string; labourKobo: string; totalKobo: string };
  allocatedKobo: string;
  marketReady: { total: number; kept: number; live: number; processing: number };
  outcome: Outcome | null;
  stages: Array<{
    stage: string;
    driver: string;
    driverQuantity: string;
    feedRate: string;
    labourRate: string;
    feedKobo: string;
    labourKobo: string;
    totalKobo: string;
    outcome: Outcome | null;
  }>;
}
interface Flock {
  code: string;
  status: string;
  acquisitionKobo: string;
  feedKobo: string;
  medicationKobo: string;
  labourKobo: string;
  totalKobo: string;
  birds: { live: number; processing: number; held: number };
  liveKobo: string;
  processingKobo: string;
  heldKobo: string;
}

const n = (v: number | string) => Number(v).toLocaleString('en-NG', { maximumFractionDigits: 2 });

/**
 * Farm lifecycle ABC (S_SNAILERY_ABC, P_POULTRY_FARM_ABC): what each stage of
 * the snail lifecycle cost and what live sales and processing carried; and
 * each flock's capitalised cost by where its birds went. A management view —
 * nothing here posts.
 */
export default async function FarmAbcPage() {
  const [context, me] = await Promise.all([getContext(), api<SessionUser>('/auth/me').catch(() => null)]);
  const year = defaultYear(context);
  const canEdit = Boolean(me?.roles.some((r) => r === 'FINANCE_CONTROLLER' || r === 'CFO'));
  let snails: Snailery | null = null;
  let flocks: Flock[] = [];
  let error: string | null = null;
  try {
    [snails, flocks] = await Promise.all([
      year ? api<Snailery>(`/cost-allocation/farm-abc/snails?financialYearId=${year.id}`) : Promise.resolve(null),
      api<Flock[]>('/cost-allocation/farm-abc/flocks'),
    ]);
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the schedule.';
  }

  return (
    <>
      <PageHeader title="Farm ABC" subtitle="What each stage of the lifecycle cost, and what the live sales and the processing carried" />
      <Tabs />
      {error ? <div className="notice notice-error">{error}</div> : null}

      {snails ? (
        <div className="stack">
          <div className="stat-grid">
            <Stat label="Snailery cost" value={formatNaira(snails.pools.totalKobo)} money hint={`${snails.financialYear} · feed ${formatNaira(snails.pools.feedKobo)}, labour ${formatNaira(snails.pools.labourKobo)}`} />
            <Stat label="To live sales" value={snails.outcome ? formatNaira(snails.outcome.liveKobo) : '—'} money hint={`${n(snails.marketReady.live)} snails`} />
            <Stat label="To processing" value={snails.outcome ? formatNaira(snails.outcome.processingKobo) : '—'} money hint={`${n(snails.marketReady.processing)} snails`} />
            <Stat label="Kept" value={snails.outcome ? formatNaira(snails.outcome.keptKobo) : '—'} money hint={`${n(snails.marketReady.kept)} replacement and still held`} />
          </div>

          <Card
            title="Snailery by stage"
            subtitle="Each pool shared across the stages by driver × rate, then over what became of the market-ready snails. The rates are weights: the year’s actual cost is always allocated in full."
            padded={false}
          >
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th className="num">Driver</th>
                    <th className="num">Feed rate</th>
                    <th className="num">Labour rate</th>
                    <th className="num">Feed and medication</th>
                    <th className="num">Labour and facility</th>
                    <th className="num">Stage cost</th>
                    <th className="num">Live sale</th>
                    <th className="num">Processing</th>
                    <th className="num">Kept</th>
                  </tr>
                </thead>
                <tbody>
                  {snails.stages.map((s) => (
                    <tr key={s.stage}>
                      <td>{s.stage}</td>
                      <td className="num">
                        {n(s.driverQuantity)}
                        <div className="faint">{s.driver.toLowerCase()}</div>
                      </td>
                      <td className="num">
                        <AbcRateForm stage={s.stage} pool="FEED" rate={s.feedRate} canEdit={canEdit} />
                      </td>
                      <td className="num">
                        <AbcRateForm stage={s.stage} pool="LABOUR" rate={s.labourRate} canEdit={canEdit} />
                      </td>
                      <td className="num">{formatNaira(s.feedKobo)}</td>
                      <td className="num">{formatNaira(s.labourKobo)}</td>
                      <td className="num strong">{formatNaira(s.totalKobo)}</td>
                      <td className="num">{s.outcome ? formatNaira(s.outcome.liveKobo) : '—'}</td>
                      <td className="num">{s.outcome ? formatNaira(s.outcome.processingKobo) : '—'}</td>
                      <td className="num">{s.outcome ? formatNaira(s.outcome.keptKobo) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      <div style={{ marginTop: 'var(--sp-5)' }}>
        <Card title="Poultry flocks" subtitle="Each flock’s capitalised cost, shared over the birds that left it alive or are still held" padded={false}>
          {flocks.length === 0 ? (
            <EmptyState icon={<IconChart size={22} />} title="No flocks yet" body="A flock appears here once it is placed." />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Flock</th>
                    <th className="num">Birds and transport</th>
                    <th className="num">Feed</th>
                    <th className="num">Medication</th>
                    <th className="num">Labour</th>
                    <th className="num">Total</th>
                    <th className="num">Live sale</th>
                    <th className="num">Processing</th>
                    <th className="num">Held</th>
                  </tr>
                </thead>
                <tbody>
                  {flocks.map((f) => (
                    <tr key={f.code}>
                      <td>
                        {f.code}
                        <div className="faint">{f.status.toLowerCase()}</div>
                      </td>
                      <td className="num">{formatNaira(f.acquisitionKobo)}</td>
                      <td className="num">{formatNaira(f.feedKobo)}</td>
                      <td className="num">{formatNaira(f.medicationKobo)}</td>
                      <td className="num">{formatNaira(f.labourKobo)}</td>
                      <td className="num strong">{formatNaira(f.totalKobo)}</td>
                      <td className="num">
                        {formatNaira(f.liveKobo)}
                        <div className="faint">{n(f.birds.live)} birds</div>
                      </td>
                      <td className="num">
                        {formatNaira(f.processingKobo)}
                        <div className="faint">{n(f.birds.processing)} birds</div>
                      </td>
                      <td className="num">
                        {formatNaira(f.heldKobo)}
                        <div className="faint">{n(f.birds.held)} birds</div>
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
