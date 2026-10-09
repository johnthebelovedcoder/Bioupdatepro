import Link from 'next/link';
import {
  getBuildOrder,
  getControlDashboard,
  getPostingChecks,
  getPostingControlStatus,
  getReleaseSignOffs,
} from '@/lib/controls';
import { formatDateTime, formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ReleaseSignOffForm } from '@/components/release-sign-off-form';
import { PostBacklogButton } from '@/components/post-backlog-button';
import { LoadPostingRulesButton } from '@/components/load-posting-rules-button';
import { ControlExceptionFollowups } from '@/components/control-exception-followup';

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
  const [checks, reconciliation, signOffs, buildOrder, provisioning] = await Promise.all([
    getPostingChecks(),
    getControlDashboard(),
    getReleaseSignOffs(),
    getBuildOrder(),
    getPostingControlStatus(),
  ]);

  const failingChecks = checks.ok ? checks.data.rows.filter((row) => row.state !== 'PASS').length : 0;
  const rows = reconciliation.ok ? reconciliation.data.rows : [];
  const variances = reconciliation.ok ? rows.filter((row) => !row.reconciled).length : 0;

  const chart = provisioning.ok ? provisioning.data.targetChart : null;
  // Each kind of finding is one line in the diagnostics; the heading says how many there are.
  const diagnosticCount = chart
    ? [
        chart.missingAccountNumbers.length > 0,
        chart.metadataMismatches.length > 0,
        chart.activeAccountsOutsideTarget.length > 0,
        chart.unresolvedPostingMaps.length > 0,
        chart.unresolvedRoles.length > 0,
        chart.configurationsOutsideTarget.length > 0,
        chart.resolvedActivePostingMaps < chart.expectedActivePostingMaps,
      ].filter(Boolean).length
    : 0;

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
        {!provisioning.ok || !provisioning.data.loaded ? (
          <Card
            title="Posting rules are not loaded"
            subtitle={
              provisioning.ok
                ? `${provisioning.data.rules} of ${provisioning.data.expectedRules} rules, ${provisioning.data.keys} of ${provisioning.data.expectedKeys} keys`
                : `Could not check: ${provisioning.error}`
            }
          >
            <p style={{ fontSize: 14, marginBottom: 'var(--sp-3)' }}>
              Manual journals, stock transfers and processing orders find their accounts through
              these rules, so none of them can post until they are loaded. Loading adds the
              client’s posting rules and the six-digit accounts they post to; it changes no
              account you already have.
            </p>
            <LoadPostingRulesButton />
          </Card>
        ) : null}

        {provisioning.ok && provisioning.data.chartVersion !== 'APPROVED' ? (
          <Card title="Not yet on the approved chart" subtitle="Balances move to the five-digit workbook chart by the cutover">
            <p style={{ fontSize: 14, marginBottom: 'var(--sp-3)' }}>
              The cutover previews where every balance goes, restates poultry rearing cost by each cohort&apos;s stage,
              repoints the settings and retires the old accounts. It runs once Finance has approved the account crosswalk.
            </p>
            <Link className="btn" href="/ledger/chart">
              Preview the cutover
            </Link>
          </Card>
        ) : null}

        {provisioning.ok ? (
          <Card
            title="Approved workbook chart readiness"
            subtitle={`${provisioning.data.targetChart.presentAccounts} of ${provisioning.data.targetChart.expectedAccounts} target accounts present`}
          >
            {provisioning.data.targetChart.ready ? (
              <div className="notice notice-success">Account master and active chart match the selected approved workbook.</div>
            ) : (
              <>
                <div className="notice notice-warning">
                  {provisioning.data.chartVersion === 'APPROVED'
                    ? 'The company is on the approved chart. What is listed below still needs a Finance decision or a setting.'
                    : 'The company is not yet on the selected five-digit workbook chart. Run the cutover from Approved chart readiness once Finance has approved the account crosswalk and the ledger is reconciled.'}
                </div>
                {diagnosticCount > 0 ? (
                <details style={{ marginTop: 'var(--sp-3)' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                    {diagnosticCount} {diagnosticCount === 1 ? 'finding' : 'findings'} in accounts and posting maps — show details
                  </summary>
                  <div className="stack" style={{ marginTop: 'var(--sp-3)' }}>
                    {provisioning.data.targetChart.missingAccountNumbers.length > 0 ? (
                      <p className="faint">
                        Missing target accounts: {provisioning.data.targetChart.missingAccountNumbers.slice(0, 12).join(', ')}
                        {provisioning.data.targetChart.missingAccountNumbers.length > 12 ? '…' : ''}
                      </p>
                    ) : null}
                    {provisioning.data.targetChart.metadataMismatches.length > 0 ? (
                      <p className="faint">
                        Account metadata mismatches: {provisioning.data.targetChart.metadataMismatches.slice(0, 8)
                          .map((row) => `${row.accountNumber} (${row.fields.join('/')})`).join(', ')}
                        {provisioning.data.targetChart.metadataMismatches.length > 8 ? '…' : ''}
                      </p>
                    ) : null}
                    {provisioning.data.targetChart.activeAccountsOutsideTarget.length > 0 ? (
                      <p className="faint">
                        Active accounts outside target: {provisioning.data.targetChart.activeAccountsOutsideTarget.slice(0, 12)
                          .map((row) => row.accountNumber).join(', ')}
                        {provisioning.data.targetChart.activeAccountsOutsideTarget.length > 12 ? '…' : ''}
                      </p>
                    ) : null}
                    {provisioning.data.targetChart.unresolvedPostingMaps.length > 0 ? (
                      <p className="faint">
                        Unresolved active posting maps: {provisioning.data.targetChart.unresolvedPostingMaps.slice(0, 8)
                          .map((row) => `${row.application}/${row.postingGroup}/${row.postingKey} → ${row.accountCode}`).join('; ')}
                        {provisioning.data.targetChart.unresolvedPostingMaps.length > 8 ? '…' : ''}
                      </p>
                    ) : null}
                    {provisioning.data.targetChart.unresolvedRoles.length > 0 ? (
                      <p className="faint">
                        Posting purposes with no usable account on this chart: {provisioning.data.targetChart.unresolvedRoles
                          .map((row) => `${row.role} (${row.state === 'no-workbook-account' ? 'the workbook names none' : `${row.number} missing`})`).join('; ')}
                      </p>
                    ) : null}
                    {provisioning.data.targetChart.configurationsOutsideTarget.length > 0 ? (
                      <p className="faint">
                        Sales and purchasing set-up still naming accounts outside the approved chart: {provisioning.data.targetChart.configurationsOutsideTarget
                          .map((row) => `${row.configuration} ${row.role} (${row.accountNumber})`).join('; ')}
                      </p>
                    ) : null}
                    {provisioning.data.targetChart.resolvedActivePostingMaps < provisioning.data.targetChart.expectedActivePostingMaps ? (
                      <p className="faint">
                        Only {provisioning.data.targetChart.resolvedActivePostingMaps} of {provisioning.data.targetChart.expectedActivePostingMaps} active workbook posting maps are linked to accounts.
                      </p>
                    ) : null}
                  </div>
                </details>
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        <Card
          title="Control accounts"
          subtitle={
            reconciliation.ok
              ? variances === 0
                ? 'Every control account agrees with its reconciliation source'
                : `${variances} account${variances === 1 ? '' : 's'} need attention`
              : undefined
          }
          padded={false}
        >
          {!reconciliation.ok ? (
            <div className="notice notice-error" style={{ margin: 'var(--sp-4)' }}>
              {reconciliation.error}
            </div>
          ) : rows.length === 0 ? (
            <p className="faint" style={{ padding: 'var(--sp-5)' }}>
              No control accounts are configured yet.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Reconciliation basis</th>
                    <th className="right" style={{ width: 140 }}>Ledger</th>
                    <th className="right" style={{ width: 140 }}>Expected balance</th>
                    <th className="right" style={{ width: 130 }}>Variance</th>
                    <th style={{ width: 110 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.accountNumber}-${row.source}`}>
                      <td style={{ textAlign: 'left' }}>
                        {row.accountNumber === '—' ? (
                          row.accountNumber
                        ) : (
                          <Link href={`/ledger/trial-balance/${encodeURIComponent(row.accountNumber)}`}>
                            {row.accountNumber}
                          </Link>
                        )}{' '}
                        {row.accountName}
                      </td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {row.source}
                      </td>
                      <td className="num">{formatNaira(row.glBalanceKobo)}</td>
                      <td className="num">{row.evidenceMissing ? '—' : formatNaira(row.subledgerKobo)}</td>
                      <td className="num">{row.evidenceMissing ? '—' : formatNaira(row.varianceKobo)}</td>
                      <td>
                        <span className={`badge ${row.evidenceMissing ? 'badge-warning' : row.reconciled ? 'badge-success' : 'badge-danger'}`}>
                          {row.evidenceMissing ? 'no evidence' : row.reconciled ? 'agrees' : 'differs'}
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
          title="Exception follow-up"
          subtitle="Assign an owner and due date; record acceptance or resolution with a reason"
        >
          {!reconciliation.ok ? (
            <div className="notice notice-error">{reconciliation.error}</div>
          ) : (
            <ControlExceptionFollowups
              cases={reconciliation.data.cases}
              users={reconciliation.data.users}
              today={new Date().toISOString().slice(0, 10)}
            />
          )}
        </Card>

        <Card
          title="Farm records waiting for the ledger"
          subtitle="Feeding, treatments, egg collections, and the rearing cost of deaths and sales, that have not posted yet"
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
                      <td style={{ textAlign: 'left' }}>
                        <p className="faint">{row.exceptionsAcknowledged ?? '—'}</p>
                        {row.snapshot ? (
                          <details style={{ marginTop: 'var(--sp-2)' }}>
                            <summary className="link" style={{ cursor: 'pointer' }}>View captured evidence</summary>
                            <div className="stack" style={{ marginTop: 'var(--sp-2)', minWidth: 280 }}>
                              <p className="faint">
                                {row.snapshot.failingCheckCount ?? 0} posting checks failing ·{' '}
                                {row.snapshot.variantAccountCount ?? 0} reconciliation exceptions
                              </p>
                              {(row.snapshot.postingControlChecks ?? []).filter((check) => check.state !== 'PASS').map((check) => (
                                <p key={check.id}>
                                  <strong>{check.state.toLowerCase()}: {check.what}</strong>
                                  <span className="faint"> — {check.found}{check.next ? `; next: ${check.next}` : ''}</span>
                                </p>
                              ))}
                              {(row.snapshot.controlReconciliation ?? []).filter((item) => !item.reconciled).map((item, index) => (
                                <p key={`${item.accountNumber}-${item.source}-${index}`}>
                                  <strong>{item.accountNumber} · {item.accountName}</strong>
                                  <span className="faint"> — {item.source}; {item.evidenceMissing ? 'evidence missing' : `variance ${formatNaira(item.varianceKobo)}`}</span>
                                </p>
                              ))}
                              {(row.snapshot.exceptionFollowups ?? []).length > 0 ? (
                                <div>
                                  <strong>Follow-up at sign-off</strong>
                                  {(row.snapshot.exceptionFollowups ?? []).map((item) => (
                                    <p key={item.key} className="faint">
                                      {item.accountNumber} · {item.status.toLowerCase().replace('_', ' ')}
                                      {item.assignedToName ? `; owner ${item.assignedToName}` : '; no owner'}
                                      {item.dueDate ? `; due ${item.dueDate}` : '; no due date'}
                                      {item.lastNote ? `; note: ${item.lastNote}` : ''}
                                    </p>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
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
