import Link from 'next/link';
import { getPostingRules, resolvePostingRule, type PostingSide } from '@/lib/controls';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconClipboard } from '@/components/icons';

export const metadata = { title: 'Posting rules — BioAssetPro' };

/**
 * How the system explains itself: for every business event, which account is
 * debited, which credited, who makes it, who approves it, and what blocks it.
 *
 * Choosing a rule resolves it live — the same lookup a real posting does — so
 * a rule that would fail tells you why here, rather than when somebody is
 * standing at the store with a delivery.
 */
export default async function PostingRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string; rule?: string }>;
}) {
  const params = await searchParams;
  const [all, selected] = await Promise.all([
    getPostingRules(),
    params.rule ? resolvePostingRule(params.rule) : Promise.resolve(null),
  ]);

  const rules = all.ok ? all.data : [];
  const cycles = [...new Set(rules.map((rule) => rule.cycle))].sort();
  const shown = params.cycle ? rules.filter((rule) => rule.cycle === params.cycle) : rules;
  const linkFor = (next: { cycle?: string; rule?: string }) => {
    const query = new URLSearchParams();
    const cycle = 'cycle' in next ? next.cycle : params.cycle;
    if (cycle) query.set('cycle', cycle);
    if (next.rule) query.set('rule', next.rule);
    return `/ledger/posting-rules${query.size ? `?${query}` : ''}`;
  };

  return (
    <>
      <PageHeader
        title="Posting rules"
        subtitle="Every business event, and the double entry it makes"
        actions={
          <Link href="/ledger/controls" className="btn btn-ghost">
            Controls
          </Link>
        }
      />

      <Tabs />

      <div className="stack">
        {!all.ok ? <div className="notice notice-error">{all.error}</div> : null}

        {cycles.length > 1 ? (
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <Link
              href={linkFor({ cycle: undefined })}
              className={`btn btn-sm ${params.cycle ? 'btn-ghost' : 'btn-primary'}`}
            >
              All
            </Link>
            {cycles.map((cycle) => (
              <Link
                key={cycle}
                href={linkFor({ cycle })}
                className={`btn btn-sm ${params.cycle === cycle ? 'btn-primary' : 'btn-ghost'}`}
              >
                {cycle}
              </Link>
            ))}
          </div>
        ) : null}

        {selected ? (
          <Card title={`Rule ${params.rule}`} subtitle="Resolved as a posting made today would resolve it">
            {!selected.ok ? (
              <div className="notice notice-error">{selected.error}</div>
            ) : selected.data.resolvable ? (
              selected.data.postsNothing ? (
                <p>This rule deliberately posts nothing — it is approval and audit only.</p>
              ) : (
                <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                  <div>
                    <strong>Dr</strong> {selected.data.debit?.accountNumber}{' '}
                    {selected.data.debit?.accountName}{' '}
                    <span className="faint">({selected.data.debit?.ledgerFlag.toLowerCase()})</span>
                  </div>
                  <div>
                    <strong>Cr</strong> {selected.data.credit?.accountNumber}{' '}
                    {selected.data.credit?.accountName}{' '}
                    <span className="faint">({selected.data.credit?.ledgerFlag.toLowerCase()})</span>
                  </div>
                  <span className="badge badge-success" style={{ alignSelf: 'flex-start' }}>
                    resolves
                  </span>
                </div>
              )
            ) : (
              <div className="notice notice-error">{selected.data.reason}</div>
            )}
          </Card>
        ) : null}

        <Card title={`${shown.length} rule${shown.length === 1 ? '' : 's'}`} padded={false}>
          {shown.length === 0 ? (
            <EmptyState
              icon={<IconClipboard size={22} />}
              title="No posting rules"
              body="Posting rules are loaded with the chart of accounts. Without them nothing can post."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Rule</th>
                    <th>Event</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th style={{ width: 170 }}>Maker → approver</th>
                    <th style={{ width: 100 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((rule) => (
                    <tr key={rule.ruleId}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        <Link href={linkFor({ rule: rule.ruleId })}>{rule.ruleId}</Link>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {rule.trigger}
                        <div className="faint">
                          {rule.module} · {rule.sourceDocument}
                          {rule.blockingControl ? ` · blocks on: ${rule.blockingControl}` : ''}
                        </div>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {rule.postsNothing ? <span className="faint">no journal</span> : <Side side={rule.debit} />}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {rule.postsNothing ? <span className="faint">no journal</span> : <Side side={rule.credit} />}
                      </td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {rule.makerRole} → {rule.approverRole}
                      </td>
                      <td>
                        <span className={`badge ${rule.status === 'APPROVED' ? 'badge-success' : 'badge-warning'}`}>
                          {rule.status.toLowerCase()}
                        </span>
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

function Side({ side }: { side: PostingSide | null }) {
  if (!side) return <span className="badge badge-danger">missing key</span>;
  return (
    <>
      <span className="num">{side.code ?? '—'}</span> {side.name}
      <div className="faint">
        {side.ledgerFlag.toLowerCase()}
        {side.flagConflict ? ` (workbook says ${side.flagConflict.toLowerCase()})` : ''}
        {side.dynamicResolution ? ` · ${side.dynamicResolution}` : ''}
        {!side.resolved && !side.dynamicResolution ? ' · not resolved to an active account' : ''}
      </div>
    </>
  );
}
