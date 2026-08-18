import { getVarianceFindings } from '@/lib/variance';
import { getFarmConfig } from '@/lib/farm-config.server';
import { formatNaira, toKobo } from '@/lib/money';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { Tabs, MONEY_TABS } from '@/components/tabs';
import { IconAlert, IconCheckCircle } from '@/components/icons';
import Link from 'next/link';

export const metadata = { title: 'Watching for losses — BioAssetPro' };

/**
 * What does not add up.
 *
 * The screen this product exists to be able to show. Nobody else in this market
 * can produce it, because it needs the operational record and the ledger to
 * agree — farm apps have the first, accounting packages have the second.
 *
 * Careful about tone throughout. Every line is a discrepancy with its basis
 * stated, never an accusation: over-feeding, spillage, a broken feeder, a
 * mis-counted flock and theft are indistinguishable from here, and software is
 * not entitled to pick one.
 */
export default async function LossesPage() {
  const [findings, config] = await Promise.all([getVarianceFindings(), getFarmConfig()]);

  const total = findings.reduce(
    (sum, finding) => sum + toKobo(finding.gapValueKobo ?? '0'),
    0n,
  );
  const critical = findings.filter((finding) => finding.severity === 'critical').length;

  return (
    <>
      <PageHeader
        title="Watching for losses"
        subtitle="Feed, eggs and stock that do not add up"
      />

      <Tabs tabs={MONEY_TABS} />

      <div className="stack">
        {!config.variance.enabled ? (
          <div className="notice notice-info">
            <span>
              This watch is switched off. Turn it on under{' '}
              <Link href="/settings">Farm setup → Watching for losses</Link>.
            </span>
          </div>
        ) : null}

        <div className="stat-grid">
          <Stat label="Things to look at" value={String(findings.length)} goodWhen="down" />
          <Stat label="Serious" value={String(critical)} goodWhen="down" />
          <Stat
            label="What it is worth"
            value={formatNaira(total)}
            money
            goodWhen="down"
            hint="over the period checked"
          />
          <Stat
            label="Feed tolerance"
            value={`${config.variance.feedPerHeadTolerancePct}%`}
            hint="your setting"
          />
        </div>

        {findings.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconCheckCircle size={22} />}
              title="Everything adds up"
              body="Nothing is outside the tolerances you set. That is either good news or a sign the tolerances are too loose — they are worth reviewing occasionally."
            />
          </Card>
        ) : (
          findings.map((finding) => (
            <Card key={finding.id} padded={false}>
              <div className="finding" data-severity={finding.severity}>
                <div className="finding-head">
                  <span
                    className={`list-icon ${finding.severity === 'critical' ? 'tone-danger' : 'tone-warning'}`}
                  >
                    <IconAlert size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="list-title">{finding.headline}</div>
                    <div className="faint" style={{ marginTop: 2 }}>
                      {finding.basis}
                    </div>
                  </div>
                  {finding.gapValueKobo ? (
                    <div style={{ textAlign: 'right' }}>
                      <div className="num" style={{ fontSize: 17, fontWeight: 600 }}>
                        {formatNaira(finding.gapValueKobo)}
                      </div>
                      <div className="list-time">worth</div>
                    </div>
                  ) : null}
                </div>

                <div className="finding-figures">
                  <span>
                    <span className="record-card-label">Should be</span>
                    <span className="record-card-value">{finding.expected}</span>
                  </span>
                  <span>
                    <span className="record-card-label">Actually is</span>
                    <span className="record-card-value" style={{ color: 'var(--error-700)' }}>
                      {finding.actual}
                    </span>
                  </span>
                  <span>
                    <span className="record-card-label">Out by</span>
                    <span className="record-card-value">{finding.gapPct}%</span>
                  </span>
                </div>

                <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
                  <Link className="btn btn-sm" href={finding.action.href}>
                    {finding.action.label}
                  </Link>
                </div>
              </div>
            </Card>
          ))
        )}

        <Card>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            Each line above is a <strong>discrepancy</strong>, not an accusation. Feed used
            above the norm can be over-feeding, spillage, a jammed feeder, a mis-counted
            flock, or feed leaving the farm — and these figures cannot tell those apart. What
            they can do is tell you where to go and look, and roughly what it is costing
            while you decide.
          </p>
        </Card>
      </div>
    </>
  );
}
