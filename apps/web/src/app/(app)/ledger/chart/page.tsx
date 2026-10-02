import { getPostingControlStatus } from '@/lib/controls';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Approved chart readiness — BioAssetPro' };

/** The five-digit workbook chart selected for the pilot and its live preflight. */
export default async function ChartPage() {
  const status = await getPostingControlStatus();

  return (
    <>
      <PageHeader title="Approved chart readiness" subtitle="Target: five-digit accounts from the approved posting-engine workbook" />
      <Tabs />
      <div className="stack">
        {!status.ok ? (
          <div className="notice notice-error">Could not check chart readiness: {status.error}</div>
        ) : (
          <Card
            title={status.data.targetChart.ready ? 'Target chart is ready' : 'Cutover is blocked'}
            subtitle={`${status.data.targetChart.presentAccounts} of ${status.data.targetChart.expectedAccounts} approved accounts present`}
          >
            {status.data.targetChart.ready ? (
              <div className="notice notice-success">The active account master matches the selected workbook chart.</div>
            ) : (
              <>
                <div className="notice notice-warning">
                  Historical balances must stay on the current chart until the five-digit account mapping and ledger reconciliation are complete. The prior six-digit cutover has been disabled.
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
        <Card title="What must clear before cutover">
          <ol style={{ marginLeft: 'var(--sp-4)', lineHeight: 1.8 }}>
            <li>Resolve all role mappings that depend on item, asset, livestock stage, cost centre, or transaction type.</li>
            <li>Match account posting, control, manual-journal, and cost-centre flags to the approved workbook.</li>
            <li>Reconcile the entity ledger and approve the account-level crosswalk with Finance.</li>
            <li>Preview and rehearse the five-digit cutover on a restored staging database before production.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
