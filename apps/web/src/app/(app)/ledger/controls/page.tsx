import Link from 'next/link';
import {
  getBuildOrder,
  getControlReconciliation,
  getPostingChecks,
  getReleaseSignOffs,
} from '@/lib/controls';
import { formatDateTime, formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ReleaseSignOffForm } from '@/components/release-sign-off-form';
import { PostBacklogButton } from '@/components/post-backlog-button';

export const metadata = { title: 'Controls — BioAssetPro' };

const STATE_TONE: Record<string, string> = {
  PASS: 'badge-success',
  FAIL: 'badge-danger',
  BLOCKED: 'badge-warning',
};

/**
 * Whether the ledger can be trusted right now.
 *
 * Three questions, each answered live rather than from a flag somebody set:
 * are the posting rules complete, does every control account equal the
 * subledger it summarises, and who signed off a release knowing what.
 */
export default async function ControlsPage() {
  const [checks, reconciliation, signOffs, buildOrder] = await Promise.all([
    getPostingChecks(),
    getControlReconciliation(),
    getReleaseSignOffs(),
    getBuildOrder(),
  ]);

  const failingChecks = checks.ok ? checks.data.rows.filter((row) => row.state !== 'PASS').length : 0;
  const variances = reconciliation.ok ? reconciliation.data.filter((row) => !row.reconciled).length : 0;

  return (
    <>
      <PageHeader
        title="Controls"
        subtitle="Posting rules, control-account reconciliation and release sign-off"
        actions={
          checks.ok && reconciliation.ok ? (
            <ReleaseSignOffForm exceptions={failingChecks + variances} />
          ) : null
        }
      />

      <Tabs />

      <div className="stack">
        <Card
          title="Control accounts"
          subtitle={
            reconciliation.ok
              ? variances === 0
                ? 'Every control account equals its subledger'
                : `${variances} account${variances === 1 ? '' : 's'} disagree with the subledger`
              : undefined
          }
          padded={false}
        >
          {!reconciliation.ok ? (
            <div className="notice notice-error" style={{ margin: 'var(--sp-4)' }}>
              {reconciliation.error}
            </div>
          ) : reconciliation.data.length === 0 ? (
            <p className="faint" style={{ padding: 'var(--sp-5)' }}>
              No control accounts are configured yet.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Subledger</th>
                    <th className="right" style={{ width: 140 }}>Ledger</th>
                    <th className="right" style={{ width: 140 }}>Subledger</th>
                    <th className="right" style={{ width: 130 }}>Variance</th>
                    <th style={{ width: 110 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.data.map((row) => (
                    <tr key={`${row.accountNumber}-${row.source}`}>
                      <td style={{ textAlign: 'left' }}>
                        <Link href={`/ledger/trial-balance/${encodeURIComponent(row.accountNumber)}`}>
                          {row.accountNumber}
                        </Link>{' '}
                        {row.accountName}
                      </td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {row.source}
                      </td>
                      <td className="num">{formatNaira(row.glBalanceKobo)}</td>
                      <td className="num">{formatNaira(row.subledgerKobo)}</td>
                      <td className="num">{formatNaira(row.varianceKobo)}</td>
                      <td>
                        <span className={`badge ${row.reconciled ? 'badge-success' : 'badge-danger'}`}>
                          {row.reconciled ? 'agrees' : 'differs'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Farm records waiting for the ledger"
          subtitle="Feeding and treatments recorded on the farm that have not posted yet"
        >
          <p className="faint" style={{ marginBottom: 'var(--sp-3)' }}>
            A round recorded while its period was closed, or before a feed item had a cost, is
            kept rather than lost — it waits here until it can post. The journals it makes carry
            your name.
          </p>
          <PostBacklogButton />
        </Card>

        <Card
          title="Posting control"
          subtitle={
            checks.ok
              ? checks.data.releasable
                ? 'Every posting rule resolves to a real account'
                : `${failingChecks} check${failingChecks === 1 ? '' : 's'} not passing`
              : undefined
          }
          action={
            <Link href="/ledger/posting-rules" className="btn btn-sm btn-ghost">
              See every rule
            </Link>
          }
          padded={false}
        >
          {!checks.ok ? (
            <div className="notice notice-error" style={{ margin: 'var(--sp-4)' }}>
              {checks.error}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Expected</th>
                    <th>Found</th>
                    <th style={{ width: 100 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ textAlign: 'left' }}>
                        {row.what}
                        {row.next ? <div className="faint">{row.next}</div> : null}
                      </td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {row.expected}
                      </td>
                      <td style={{ textAlign: 'left' }}>{row.found}</td>
                      <td>
                        <span className={`badge ${STATE_TONE[row.state] ?? ''}`}>
                          {row.state.toLowerCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Release sign-offs" subtitle="Every release decision, newest first" padded={false}>
          {!signOffs.ok ? (
            <div className="notice notice-error" style={{ margin: 'var(--sp-4)' }}>
              {signOffs.error}
            </div>
          ) : signOffs.data.length === 0 ? (
            <p className="faint" style={{ padding: 'var(--sp-5)' }}>
              Nothing has been signed off yet.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>When</th>
                    <th>Release</th>
                    <th style={{ width: 170 }}>Verdict</th>
                    <th>By</th>
                    <th>Exceptions acknowledged</th>
                  </tr>
                </thead>
                <tbody>
                  {signOffs.data.map((row) => (
                    <tr key={row.id}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDateTime(row.occurredAt)}
                      </td>
                      <td style={{ textAlign: 'left' }}>{row.snapshot?.releaseLabel ?? '—'}</td>
                      <td>
                        <span
                          className={`badge ${row.status === 'RELEASED' ? 'badge-success' : 'badge-warning'}`}
                        >
                          {row.status === 'RELEASED' ? 'clean' : 'with exceptions'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'left' }}>{row.signedOffBy}</td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {row.exceptionsAcknowledged ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {buildOrder.ok && buildOrder.data.length > 0 ? (
          <Card
            title="Build order"
            subtitle="The twelve implementation phases, each with the evidence this company's own data gives for it"
            padded={false}
          >
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Phase</th>
                    <th>What</th>
                    <th>Evidence</th>
                    <th style={{ width: 120 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {buildOrder.data.map((phase) => (
                    <tr key={phase.code}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {phase.code}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {phase.webPath ? <Link href={phase.webPath}>{phase.name}</Link> : phase.name}
                        {phase.scope ? <div className="faint">{phase.scope}</div> : null}
                      </td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {phase.signal ?? 'Nothing in this system can evidence it'}
                      </td>
                      <td>
                        <span
                          className={`badge ${phase.hasEvidence ? 'badge-success' : phase.signal ? '' : 'badge-warning'}`}
                        >
                          {phase.hasEvidence ? 'evidenced' : phase.signal ? 'not yet' : 'no signal'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
