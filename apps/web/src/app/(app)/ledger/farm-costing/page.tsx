import Link from 'next/link';
import { defaultYear, getContext } from '@/lib/org';
import { getAllocations, getAllocationSources, getEggValuePolicies, getPopulationShares } from '@/lib/farm-costing';
import { getStockItems } from '@/lib/masters';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconClipboard } from '@/components/icons';
import { AllocationForm, EggValueForm } from '@/components/farm-costing-forms';

export const metadata = { title: 'Farm costing — BioAssetPro' };

/**
 * The farm's costing decisions of 2026-09-24, and the runs that apply them:
 *
 *   Egg value           PCR-067 — eggs recognised when collected, at a dated
 *                       value per crate; the gain goes to 420210.
 *   Labour & overhead   PCR-028/043/064 — a month's wages and overheads shared
 *                       across the populations alive by animal-days: flocks
 *                       into their Work in Progress, snails to 612000.
 *   Machines            PCR-031 — set per asset on Fixed assets.
 */
export default async function FarmCostingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const [context, params, policies, items, allocations] = await Promise.all([
    getContext(),
    searchParams,
    getEggValuePolicies().catch(() => []),
    getStockItems().catch(() => []),
    getAllocations().catch(() => []),
  ]);
  const year = defaultYear(context);
  const today = new Date().toISOString().slice(0, 10);
  const periods = year?.periods ?? [];
  // The latest open month that has started — the one most likely being closed.
  const started = periods.filter((p) => p.status === 'OPEN' && p.startDate.slice(0, 10) <= today);
  const period = periods.find((p) => p.id === params.period) ?? started[started.length - 1] ?? periods[0] ?? null;

  const [sources, shares, hourShares] = period
    ? await Promise.all([
        getAllocationSources(period.id).catch(() => []),
        getPopulationShares(period.id).catch(() => []),
        getPopulationShares(period.id, 'HOURS').catch(() => []),
      ])
    : [[], [], []];
  const current = policies[0] ?? null;

  return (
    <div className="stack">
      <PageHeader
        title="Farm costing"
        subtitle="What eggs are worth, and how wages and overheads reach each flock and snail cohort"
      />
      <Tabs />

      <Card
        title="Egg value"
        subtitle="Eggs are recognised when collected — Dr Eggs (130215), Cr Agricultural Produce Gain (420210)"
        action={
          <EggValueForm
            items={items.map((i) => ({ id: i.id, code: i.code, name: i.name, unit: i.unit }))}
            today={today}
            current={current?.item ? { itemId: current.item.id, eggsPerUnit: current.eggsPerUnit } : null}
          />
        }
      >
        {policies.length === 0 ? (
          <p className="muted">
            No value set yet. Egg collections are recorded, but wait under{' '}
            <Link href="/ledger/controls">Farm records waiting for the ledger</Link> until one is.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>From</th>
                  <th>Stocked as</th>
                  <th className="right">Table eggs</th>
                  <th className="right">Hatching eggs</th>
                  <th className="right">Per egg</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p, index) => (
                  <tr key={p.id}>
                    <td>
                      {formatDate(p.effectiveFrom)}
                      {index === 0 ? <span className="badge badge-success" style={{ marginLeft: 8 }}>current</span> : null}
                    </td>
                    <td>{p.item ? `${p.item.code} — ${p.item.description}` : '—'}</td>
                    <td className="num">
                      {formatNaira(p.valuePerUnitKobo)} <span className="faint">per {p.eggsPerUnit === 30 ? 'crate of 30' : `${p.eggsPerUnit} eggs`}</span>
                    </td>
                    <td className="num">
                      {p.hatchingValuePerUnitKobo ? formatNaira(p.hatchingValuePerUnitKobo) : <span className="faint">same</span>}
                    </td>
                    <td className="num">
                      {formatNaira((BigInt(p.valuePerUnitKobo) / BigInt(p.eggsPerUnit)).toString())}
                      {p.hatchingValuePerUnitKobo ? (
                        <div className="faint">
                          hatching {formatNaira((BigInt(p.hatchingValuePerUnitKobo) / BigInt(p.eggsPerUnit)).toString())}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="faint" style={{ fontSize: 13, marginTop: 'var(--sp-3)' }}>
          Setting eggs into the incubator moves their value to Eggs in Incubation (130216); the chicks
          that hatch carry it into Biological Assets — Poultry (130210).
        </p>
      </Card>

      <Card
        title="Wages and overheads to populations"
        subtitle="Shared by animal-days, or by timesheet hours × pay rate. Flocks take theirs into Work in Progress; snail cohorts to 612000."
        action={
          <Link href="/finance/timesheets" className="btn btn-sm btn-ghost">
            Timesheets
          </Link>
        }
      >
        {!period ? (
          <EmptyState icon={<IconClipboard size={22} />} title="No financial year" body="Set up a financial year first." />
        ) : (
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {periods
                .filter((p) => p.startDate.slice(0, 10) <= today)
                .map((p) => (
                  <Link
                    key={p.id}
                    href={`/ledger/farm-costing?period=${p.id}`}
                    className={`btn btn-sm ${p.id === period.id ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {p.name}
                  </Link>
                ))}
            </div>
            {period.status !== 'OPEN' ? (
              <div className="notice notice-warning">{period.name} is closed — nothing can be allocated into it.</div>
            ) : (
              <AllocationForm
                key={period.id}
                periodId={period.id}
                periodName={period.name}
                sources={sources}
                shares={shares}
                hourShares={hourShares}
              />
            )}
          </div>
        )}
      </Card>

      <Card title="Allocations posted" padded={false}>
        {allocations.length === 0 ? (
          <EmptyState icon={<IconClipboard size={22} />} title="None yet" body="Allocations you post appear here." />
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Period</th>
                  <th>Shared across</th>
                  <th className="right">Total</th>
                  <th>Journal</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => (
                  <tr key={a.id}>
                    <td className="strong">{a.reference}</td>
                    <td>
                      {a.period}
                      <div className="faint">{a.basis === 'HOURS' ? 'by hours worked' : 'by animal-days'}</div>
                    </td>
                    <td className="faint">
                      {a.lines.map((l) => `${l.group} ${formatNaira(l.amountKobo)}`).join(' · ')}
                    </td>
                    <td className="num">{formatNaira(a.totalKobo)}</td>
                    <td>
                      {a.journalNumber}
                      {a.reversedBy ? <div className="faint">reversed by {a.reversedBy}</div> : null}
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
          Machines that serve a processing line or the feed mill are marked on{' '}
          <Link href="/ledger/fixed-assets">Fixed assets</Link> (&ldquo;Line&rdquo;); their depreciation
          then posts to that line&rsquo;s overhead. To undo an allocation, reverse its journal under{' '}
          <Link href="/ledger/journals">Journal entries</Link> — the amounts become available to share again.
        </p>
      </Card>
    </div>
  );
}
