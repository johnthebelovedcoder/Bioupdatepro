import { getCutoverPreview, getPostingControlStatus } from '@/lib/controls';
import { ChartCutoverForm } from '@/components/chart-cutover-form';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { LoadPostingRulesButton } from '@/components/load-posting-rules-button';

export const metadata = { title: 'Approved chart readiness — BioAssetPro' };

/** The five-digit workbook chart selected for the pilot and its live preflight. */
export default async function ChartPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const status = await getPostingControlStatus();
  // The cutover is offered until the company is on the approved chart.
  const onApproved = status.ok && status.data.chartVersion === 'APPROVED';
  const cutover = onApproved ? null : await getCutoverPreview();

  return (
    <>
      <PageHeader title="Approved chart readiness" subtitle="Target: five-digit accounts from the approved posting-engine workbook" />
      <Tabs />
      <div className="stack">
        {done ? <div className="notice notice-success">{done}</div> : null}
        {!status.ok ? (
          <div className="notice notice-error">Could not check chart readiness: {status.error}</div>
        ) : (
          <Card
            title={status.data.targetChart.ready ? 'Target chart is ready' : onApproved ? 'Approved chart: checks outstanding' : 'Not yet on the approved chart'}
            subtitle={`${status.data.targetChart.presentAccounts} of ${status.data.targetChart.expectedAccounts} approved accounts present`}
          >
            {status.data.targetChart.ready ? (
              <div className="notice notice-success">The active account master matches the selected workbook chart.</div>
            ) : (
              <>
                <div className="notice notice-warning">
                  {onApproved
                    ? status.data.targetChart.unresolvedRoles.length > 0
                      ? 'The company is on the approved chart. What is left is listed below as needing a Finance decision.'
                      : 'The company is on the approved chart; the checks below still show gaps.'
                    : 'Balances stay on the current chart until the cutover below is run. Preview it, check each choice, and run it once Finance has approved the crosswalk.'}
                </div>
                <ul style={{ margin: 'var(--sp-3) 0 0 var(--sp-4)' }}>
                  <li>{status.data.targetChart.missingAccountNumbers.length} target accounts missing</li>
                  <li>{status.data.targetChart.metadataMismatches.length} account metadata mismatches</li>
                  <li>{status.data.targetChart.resolvedActivePostingMaps} of {status.data.targetChart.expectedActivePostingMaps} active posting maps linked to workbook accounts</li>
                  <li>{status.data.targetChart.activeAccountsOutsideTarget.length} active accounts outside the target chart</li>
                  <li>{status.data.targetChart.unresolvedPostingMaps.length} active posting maps without a linked GL account</li>
                </ul>
              </>
            )}
          </Card>
        )}
        {status.ok && !onApproved && status.data.targetChart.missingAccountNumbers.length > 0 ? (
          <Card
            title="Load the approved chart first"
            subtitle={`${status.data.targetChart.missingAccountNumbers.length} of ${status.data.targetChart.expectedAccounts} approved accounts are not in this company yet`}
          >
            <p style={{ fontSize: 14, marginBottom: 'var(--sp-3)' }}>
              The cutover moves balances into the approved accounts, so they have to exist first. Loading adds the approved
              accounts, cost centres and posting maps alongside your current ones; it moves nothing and changes no balance.
            </p>
            <LoadPostingRulesButton label="Load the approved chart" />
          </Card>
        ) : null}
        {cutover && cutover.ok && cutover.data.cutoverDate ? (
          <ChartCutoverForm initial={cutover.data} />
        ) : cutover && !cutover.ok ? (
          <div className="notice notice-error">Could not work out the cutover: {cutover.error}</div>
        ) : cutover && cutover.ok ? (
          <div className="notice notice-warning">No future month is open. Set up the next financial period first.</div>
        ) : null}
        {onApproved && status.ok && status.data.targetChart.unresolvedRoles.length > 0 ? (
          <Card title="Still needs a Finance decision" subtitle="Purposes with no account on the approved chart yet; posting to them is refused until one is chosen">
            <ul style={{ margin: '0 0 0 var(--sp-4)', lineHeight: 1.8 }}>
              {status.data.targetChart.unresolvedRoles.map((r) => (
                <li key={r.role}>
                  {r.role}: {r.state === 'no-workbook-account' ? 'the workbook names no account' : `${r.number} is missing from this company`}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {!onApproved ? (
          <Card title="What must clear before cutover">
            <ol style={{ marginLeft: 'var(--sp-4)', lineHeight: 1.8 }}>
              <li>Resolve all role mappings that depend on item, asset, livestock stage, cost centre, or transaction type.</li>
              <li>Match account posting, control, manual-journal, and cost-centre flags to the approved workbook.</li>
              <li>Reconcile the entity ledger and approve the account-level crosswalk with Finance.</li>
              <li>Preview and rehearse the cutover on a restored copy of the database before production.</li>
            </ol>
          </Card>
        ) : null}
      </div>
    </>
  );
}
