import Link from 'next/link';
import { api } from '@/lib/api';
import {
  CORE_CAPABILITIES,
  CORE_GAPS,
  availableModules,
  coreProgress,
  installedModules,
  sectionHref,
} from '@/lib/products';
import { Card, PageHeader, Stat } from '@/components/ui';
import { IconArrowRight } from '@/components/icons';

export const metadata = { title: 'AgriPro Core — BioAssetPro' };

/**
 * What AgriPro Core is, and how much of it is real.
 *
 * The client has asked twice where AgriPro is in the application, and both
 * times the honest answer was that it was in there without being named: the
 * business cycles in the sidebar are the platform layer his specification
 * describes. This page names it, shows what the platform consists of, and says
 * plainly how far each part has got.
 *
 * It reports three states rather than two. Most of this application is
 * "engine-only" — the posting rules exist and are covered by integration
 * tests, and no person can reach them because nothing renders a screen. A page
 * that showed only done-or-missing would have to lie about that in one
 * direction or the other, and the difference is exactly what somebody planning
 * the next month needs to know.
 */
export default async function AgriProCorePage() {
  const counts = await Promise.all([
    safeCount('/masters/suppliers'),
    safeCount('/masters/customers'),
    safeCount('/masters/items'),
    safeCount('/procurement/orders'),
    safeCount('/procurement/receipts'),
  ]);
  const [vendors, customers, items, orders, receipts] = counts;

  const progress = coreProgress();
  const installed = installedModules();
  const available = availableModules();

  return (
    <>
      <PageHeader
        title="AgriPro Core"
        subtitle="The shared platform every species module posts through"
      />

      <div className="stack">
        <Card>
          <p style={{ fontSize: 15, lineHeight: 1.6 }}>
            AgriPro Core owns the ledger, the approval workflow, the master data and the
            common subledgers. SnailPro and PoultryPro add the biology — cohorts, flocks,
            stages, mortality, harvest — and when one of their events has a financial
            effect, it calls Core. <strong>They never create a second set of books.</strong>
          </p>
          <p className="muted" style={{ fontSize: 14, marginTop: 'var(--sp-3)' }}>
            That boundary is the specification&rsquo;s §60, and it is why a farm can buy
            AgriPro on its own and add a species module later.
          </p>
        </Card>

        <div className="stat-grid">
          <Stat
            label="Platform areas working"
            value={`${progress.live} of ${progress.total}`}
            hint="usable from a screen"
          />
          <Stat
            label="Built but unreachable"
            value={String(progress.engine)}
            hint="posts through the API only"
            goodWhen="down"
          />
          <Stat
            label="Not started"
            value={String(progress.missing)}
            hint="no code at all"
            goodWhen="down"
          />
          <Stat label="Species modules" value={String(installed.length)} hint="installed" />
        </div>

        <Card
          title="What the platform does"
          subtitle="Each cycle, and how far it has got"
          padded={false}
        >
          {CORE_CAPABILITIES.map((capability) => {
            const href = capability.href ?? sectionHref(capability.sectionKey);
            const body = (
              <>
                <div className="list-main">
                  <div className="list-title">
                    {capability.name} <StateBadge state={capability.state} />
                  </div>
                  <div className="list-sub">{capability.what}</div>
                  {capability.note ? (
                    <div className="faint" style={{ marginTop: 2 }}>
                      {capability.note}
                    </div>
                  ) : null}
                </div>
                {href ? <IconArrowRight size={15} /> : null}
              </>
            );

            return href ? (
              <Link key={capability.name} href={href} className="list-row">
                {body}
              </Link>
            ) : (
              <div key={capability.name} className="list-row">
                {body}
              </div>
            );
          })}
        </Card>

        <Card title="What Core is holding right now" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Record</th>
                  <th className="right" style={{ width: 120 }}>
                    Count
                  </th>
                  <th style={{ width: 200 }}>Owned by</th>
                </tr>
              </thead>
              <tbody>
                <Row name="Vendors" count={vendors} owner="Core — shared master" />
                <Row name="Customers" count={customers} owner="Core — shared master" />
                <Row name="Items" count={items} owner="Core — shared master" />
                <Row name="Purchase orders" count={orders} owner="Core — procure to pay" />
                <Row name="Goods receipts" count={receipts} owner="Core — procure to pay" />
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Modules on top"
          subtitle="Species extensions, and what each adds that Core cannot infer"
          padded={false}
        >
          {installed.map((module) => (
            <Link key={module.key} href={`/m/${module.key}`} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {module.productName} <span className="badge badge-success">installed</span>
                </div>
                <div className="list-sub">
                  {module.terms.group.many}, {module.terms.housing.many}, stages,{' '}
                  {module.terms.output.many}
                </div>
              </div>
              <IconArrowRight size={15} />
            </Link>
          ))}
          {available.map((module) => (
            <div key={module.key} className="list-row">
              <div className="list-main">
                <div className="list-title faint">{module.productName}</div>
                <div className="list-sub">
                  Available as an extension. Nothing in Core changes to add it.
                </div>
              </div>
              <span className="badge">not subscribed</span>
            </div>
          ))}
        </Card>

        <Card
          title="Not built yet"
          subtitle="Named rather than left for somebody to discover"
          padded={false}
        >
          {CORE_GAPS.map((gap) => (
            <div className="list-row" key={gap.label}>
              <div className="list-main">
                <div className="list-title faint">{gap.label}</div>
                <div className="list-sub">{gap.why}</div>
              </div>
              <span className="badge">under {gap.belongsUnder}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function StateBadge({ state }: { state: 'live' | 'engine-only' | 'not-built' }) {
  if (state === 'live') return <span className="badge badge-success">working</span>;
  if (state === 'engine-only') return <span className="badge badge-warning">no screen yet</span>;
  return <span className="badge">not started</span>;
}

function Row({ name, count, owner }: { name: string; count: number; owner: string }) {
  return (
    <tr>
      <td className="strong">{name}</td>
      <td className="num">{count}</td>
      <td className="faint">{owner}</td>
    </tr>
  );
}

/**
 * A count, or zero.
 *
 * An endpoint that is not reachable should leave a nought on the page rather
 * than replacing the whole screen with an error — this page's job is to say
 * what exists, and it can still do most of that with one figure missing.
 */
async function safeCount(path: string): Promise<number> {
  try {
    const rows = await api<unknown[]>(path);
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}
