import Link from 'next/link';
import { getBatchResults } from '@/lib/profitability';
import { formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'What each population made — BioAssetPro' };

/**
 * Which populations made money, ranked.
 *
 * A flock and a cohort rank on the same list here, so the copy stays at the
 * species-neutral word rather than picking one species' term and mislabelling
 * the other's rows — see `ResultRow` below for where a row does need its own
 * species' word.
 *
 * The screen the whole accounting spine exists to produce. Farm apps can tell
 * you how many birds died; this tells you that one population made ₦5.8m and
 * another lost ₦1.1m, and that feed was 79% of the cost in both cases.
 *
 * Closed and open are kept apart on purpose — see the note in profitability.ts.
 * A broiler flock three weeks from sale has spent a lot and earned nothing, and
 * showing that in the same list as a finished result would call it a loss when
 * it is simply unfinished.
 */
export default async function BatchProfitPage() {
  const results = await getBatchResults();
  const finished = results.filter((result) => result.final);
  const running = results.filter((result) => !result.final);

  const totalMargin = finished.reduce(
    (sum, result) => sum + toKobo(result.marginKobo),
    0n,
  );
  const best = finished[0];
  const worst = finished[finished.length - 1];

  return (
    <>
      <PageHeader
        title="What each population made"
        subtitle="Every population, ranked by what it earned against what it cost"
      />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          <Stat
            label="Finished populations"
            value={String(finished.length)}
            hint="complete results"
          />
          <Stat
            label="They made"
            value={formatNaira(totalMargin)}
            money
            goodWhen="up"
            hint="all finished populations"
          />
          <Stat
            label="Best"
            value={best ? best.group.code : '—'}
            hint={best ? formatNaira(best.marginKobo) : undefined}
          />
          <Stat
            label="Worst"
            value={worst && worst !== best ? worst.group.code : '—'}
            hint={worst && worst !== best ? formatNaira(worst.marginKobo) : undefined}
          />
        </div>

        <Card
          title="Finished"
          subtitle="Everything is in — these are final"
          padded={false}
        >
          {finished.length === 0 ? (
            <div className="card-body muted">
              No population has been closed out yet. A result only becomes final when the last
              animal has gone.
            </div>
          ) : (
            finished.map((result) => <ResultRow key={result.group.id} result={result} />)
          )}
        </Card>

        <Card
          title="Still running"
          subtitle="A position, not a result — these are not finished"
          padded={false}
        >
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <div className="notice notice-info">
              <span>
                An open population that has spent money and sold nothing shows a large negative
                figure. That is <strong>not a loss</strong> — it is what the population is worth
                so far. Judge these when they close.
              </span>
            </div>
          </div>
          {running.map((result) => (
            <ResultRow key={result.group.id} result={result} />
          ))}
        </Card>

        <Card>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            Cost here is what accumulated <strong>against the population itself</strong> — its
            chicks, its feed, its medication, its share of labour and overhead. That is why
            these figures add back to the profit and loss instead of drifting away from it,
            and it is the reason the accounting core exists.
          </p>
        </Card>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ResultRow({ result }: { result: Awaited<ReturnType<typeof getBatchResults>>[number] }) {
  const margin = toKobo(result.marginKobo);
  const positive = margin >= 0n;
  const snail = result.group.species === 'SNAIL';

  return (
    <div className="result-row">
      <div className="result-head">
        <div style={{ minWidth: 0 }}>
          <Link
            href={`/m/${snail ? 'snail' : 'poultry'}/${snail ? 'cohorts' : 'flocks'}/${result.group.id}`}
            className="num"
            style={{ fontWeight: 600, fontSize: 15, textAlign: 'left' }}
          >
            {result.group.code}
          </Link>
          <div className="list-sub">
            {result.group.breed} · {result.group.purpose} · {result.group.house}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            className="num"
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: positive ? 'var(--success-700)' : 'var(--error-700)',
            }}
          >
            {positive ? '' : '−'}
            {formatNaira(positive ? margin : -margin)}
          </div>
          <div className="list-time">
            {result.final ? 'final' : 'so far'}
            {result.roiPct !== null ? ` · ${result.roiPct.toFixed(0)}%` : ''}
          </div>
        </div>
      </div>

      <div className="result-figures">
        <span>
          <span className="record-card-label">Earned</span>
          <span className="record-card-value">{formatNaira(result.revenueKobo)}</span>
        </span>
        <span>
          <span className="record-card-label">Cost</span>
          <span className="record-card-value">{formatNaira(result.costKobo)}</span>
        </span>
        <span>
          <span className="record-card-label">
            Per {snail ? 'snail' : 'bird'}
          </span>
          <span className="record-card-value">{formatNaira(result.costPerAnimalKobo)}</span>
        </span>
      </div>

      {/*
        Where the money went, as one bar. A farmer already knows feed is the big
        one; what they want is the number, and whether this population is unusual.
      */}
      {result.breakdown.length > 0 ? (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <div className="cost-bar">
            {result.breakdown.map((line, index) => (
              <span
                key={line.label}
                className="cost-bar-part"
                data-index={index % 5}
                style={{ width: `${line.sharePct}%` }}
                title={`${line.label} — ${formatNaira(line.kobo)} (${line.sharePct.toFixed(0)}%)`}
              />
            ))}
          </div>
          <div className="cost-legend">
            {result.breakdown.map((line, index) => (
              <span key={line.label} className="cost-legend-item">
                <span className="cost-swatch" data-index={index % 5} />
                {line.label} {line.sharePct.toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
