import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { IconArrowRight } from '@/components/icons';

export const metadata = { title: 'Build Order — BioAssetPro' };

interface BuildPhase {
  code: string;
  sequence: number;
  name: string;
  scope: string;
  owner: string;
  exitEvidence: string;
  dependencyCodes: string[];
  evidenceSheet: string;
  webPath: string | null;
  hasEvidence: boolean;
  signal: string | null;
}

/**
 * US-897-001 — the workbook's own governed 12-phase build sequence
 * (Developer_Build_Order DEV-01..12, cross-checked against 00_BEGIN_HERE),
 * so a developer or reviewer can follow the same order the client specified
 * — masters through workflow, P2P, inventory, both species' lifecycles,
 * production, sales, reports, then UAT and release — without guessing what
 * comes next or jumping straight to reports before the chain behind them
 * exists.
 *
 * `hasEvidence` is computed live server-side from real data in this
 * company, never a hand-set flag — a phase reads as done only when this
 * company's own database actually has the kind of record that phase
 * produces.
 */
export default async function BuildOrderPage() {
  let phases: BuildPhase[] = [];
  let error: string | null = null;
  try {
    phases = await api<BuildPhase[]>('/reporting/build-order');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load the build order.';
  }

  return (
    <div className="stack">
      <PageHeader
        title="Build Order"
        subtitle="The client's own 12-phase sequence — masters through UAT and release"
      />

      {error ? <div className="notice notice-error">{error}</div> : null}

      <Card padded={false}>
        {phases.map((phase) => {
          const body = (
            <>
              <div className="list-main">
                <div className="list-title">
                  <span className="faint" style={{ marginRight: 'var(--sp-2)' }}>
                    {phase.code}
                  </span>
                  {phase.name} <PhaseBadge hasEvidence={phase.hasEvidence} hasSignal={phase.signal !== null} />
                </div>
                <div className="list-sub">{phase.scope}</div>
                <div className="faint" style={{ marginTop: 2, fontSize: 12 }}>
                  {phase.owner} · exits on: {phase.exitEvidence}
                  {phase.signal ? ` · ${phase.signal}` : ''}
                </div>
                {phase.dependencyCodes.length > 0 ? (
                  <div className="faint" style={{ marginTop: 2, fontSize: 12 }}>
                    depends on {phase.dependencyCodes.join(', ')}
                  </div>
                ) : null}
              </div>
              {phase.webPath ? <IconArrowRight size={15} /> : null}
            </>
          );

          return phase.webPath ? (
            <Link key={phase.code} href={phase.webPath} className="list-row">
              {body}
            </Link>
          ) : (
            <div key={phase.code} className="list-row">
              {body}
            </div>
          );
        })}
      </Card>

      <Card>
        <p className="muted" style={{ fontSize: 14 }}>
          Every phase and its exit evidence comes from the client&rsquo;s own
          Developer_Build_Order and 00_BEGIN_HERE sheets. A phase with no screen yet
          (production costing, integrations, migration, release sign-off) is shown
          without a link rather than pointed at something that doesn&rsquo;t exist.
        </p>
      </Card>
    </div>
  );
}

function PhaseBadge({ hasEvidence, hasSignal }: { hasEvidence: boolean; hasSignal: boolean }) {
  if (hasEvidence) return <span className="badge badge-success">in use</span>;
  if (hasSignal) return <span className="badge badge-warning">no data yet</span>;
  return <span className="badge">not started</span>;
}
