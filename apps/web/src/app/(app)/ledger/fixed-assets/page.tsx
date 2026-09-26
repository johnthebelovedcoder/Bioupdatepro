import Link from 'next/link';
import { getFixedAssets } from '@/lib/fixed-assets';
import { api } from '@/lib/api';
import { defaultYear, getContext } from '@/lib/org';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconBox } from '@/components/icons';
import { CapitaliseAssetForm } from '@/components/capitalise-asset-form';
import { RunDepreciationForm } from '@/components/run-depreciation-form';
import { DisposeAssetForm } from '@/components/dispose-asset-form';
import { PROCESSING_LINES, ProcessingLineForm } from '@/components/processing-line-form';
import { MachineHoursForm } from '@/components/machine-hours-form';
import { TableSearch } from '@/components/table-search';
import { ImpairAssetForm, ImpairmentDecision, TransferAssetForm } from '@/components/asset-change-forms';
import type { SessionUser } from '@/lib/session';

interface PendingImpairment {
  id: string;
  assetNumber: string;
  name: string;
  impairedOn: string;
  amountKobo: string;
  recoverableAmountKobo: string;
  reason: string;
  evidence: string | null;
  requestedById: string;
}

export const metadata = { title: 'Fixed assets — BioAssetPro' };

/**
 * The asset register: what the farm owns outright, what it cost, and what
 * has been depreciated so far.
 *
 * Account numbers here (1701 PPE, 1702 Accumulated Depreciation, 5501
 * Depreciation Expense) are additive to this company's own chart, not the
 * client's six-digit spec chart — provisional pending that migration, the
 * same disclosed-provisional pattern already used for the posting-control
 * keys and the approval-ladder thresholds.
 */
export default async function FixedAssetsPage() {
  const [assets, context, dimensions, pendingImpairments, me] = await Promise.all([
    getFixedAssets(),
    getContext(),
    api<{ costCentres: Array<{ id: string; code: string; name: string }> }>(
      '/reporting/dimensions',
    ),
    api<PendingImpairment[]>('/fixed-assets/impairments/pending').catch(() => [] as PendingImpairment[]),
    api<SessionUser>('/auth/me'),
  ]);
  const canDecideImpairment = me.roles.some((r) => r === 'FINANCE_CONTROLLER' || r === 'CFO');

  const year = defaultYear(context);
  const today = new Date().toISOString().slice(0, 10);
  const awaiting = assets.filter((asset) => asset.pendingTransactionId);

  return (
    <div className="stack">
      <PageHeader
        title="Fixed assets"
        subtitle="What the farm owns outright, and what has been depreciated so far"
      />

      <Tabs />

      {awaiting.length > 0 ? (
        <div className="notice notice-warning">
          {awaiting.length} asset{awaiting.length === 1 ? '' : 's'} waiting for approval — a capitalisation or a disposal.
          Nothing has posted for {awaiting.length === 1 ? 'it' : 'them'} yet —{' '}
          <Link href="/approvals">the approvals queue</Link> is where that happens.
        </div>
      ) : null}

      {pendingImpairments.length > 0 ? (
        <Card title="Impairments awaiting a decision" subtitle="Approved by the finance controller or CFO, not whoever raised it" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Asset</th>
                  <th>Why</th>
                  <th className="right" style={{ width: 140 }}>Recoverable</th>
                  <th className="right" style={{ width: 140 }}>Impairment</th>
                  <th style={{ width: 220 }} />
                </tr>
              </thead>
              <tbody>
                {pendingImpairments.map((p) => (
                  <tr key={p.id}>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {p.assetNumber}
                      <div className="faint">{p.impairedOn}</div>
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {p.name}: {p.reason}
                      {p.evidence ? <div className="faint">{p.evidence}</div> : null}
                    </td>
                    <td className="num right">{formatNaira(p.recoverableAmountKobo)}</td>
                    <td className="num right">{formatNaira(p.amountKobo)}</td>
                    <td>{canDecideImpairment && p.requestedById !== me.userId ? <ImpairmentDecision id={p.id} /> : <span className="faint">waiting</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <TableSearch
        placeholder="Search the register"
        actions={
          <>
            <CapitaliseAssetForm costCentres={dimensions.costCentres} today={today} />
            <RunDepreciationForm periods={year?.periods ?? []} />
          </>
        }
      >
        <Card title="Register" padded={false}>
          {assets.length === 0 ? (
            <EmptyState
              icon={<IconBox size={22} />}
              title="Nothing capitalised yet"
              body="Capitalise an asset above to start the register."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Asset</th>
                    <th>Name &amp; class</th>
                    <th style={{ width: 110 }}>Acquired</th>
                    <th className="right" style={{ width: 130 }}>
                      Cost
                    </th>
                    <th className="right" style={{ width: 150 }}>
                      Accumulated depreciation
                    </th>
                    <th className="right" style={{ width: 130 }}>
                      Net book value
                    </th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 200 }} />
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {asset.assetNumber}
                      </td>
                      <td>
                        {asset.name}
                        <div className="faint">
                          {asset.assetClass}
                          {asset.costCentre ? ` · ${asset.costCentre}` : ''}
                        </div>
                        {asset.processingCycle ? (
                          <div className="faint">Depreciates to {PROCESSING_LINES[asset.processingCycle]}</div>
                        ) : null}
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(asset.acquisitionDate)}
                      </td>
                      <td className="num">{formatNaira(asset.costKobo)}</td>
                      <td className="num">{formatNaira(asset.accumulatedDepreciationKobo)}</td>
                      <td className="num">{formatNaira(asset.netBookValueKobo)}</td>
                      <td>
                        {asset.disposedOn ? (
                          <span className="badge">disposed</span>
                        ) : asset.pendingTransactionId ? (
                          <span className="badge badge-warning">awaiting approval</span>
                        ) : asset.status === 'POSTED' ? (
                          <span className="badge badge-success">
                            {asset.fullyDepreciated ? 'fully depreciated' : 'in service'}
                          </span>
                        ) : (
                          <span className="badge">{asset.status.toLowerCase()}</span>
                        )}
                      </td>
                      <td>
                        {asset.status === 'POSTED' && !asset.disposedOn ? (
                          <>
                            <ProcessingLineForm assetId={asset.id} assetNumber={asset.assetNumber} current={asset.processingCycle} />
                            <MachineHoursForm assetId={asset.id} assetNumber={asset.assetNumber} periods={year?.periods ?? []} />
                          </>
                        ) : null}
                        {asset.status === 'POSTED' && !asset.disposedOn ? (
                          <>
                            <ImpairAssetForm assetId={asset.id} assetNumber={asset.assetNumber} netBookValueKobo={asset.netBookValueKobo} today={today} />
                            <TransferAssetForm
                              assetId={asset.id}
                              assetNumber={asset.assetNumber}
                              current={asset.costCentre}
                              costCentres={dimensions.costCentres}
                              today={today}
                            />
                          </>
                        ) : null}
                        {asset.status === 'POSTED' && !asset.disposedOn && !asset.pendingTransactionId ? (
                          <DisposeAssetForm
                            assetId={asset.id}
                            assetNumber={asset.assetNumber}
                            name={asset.name}
                            netBookValueKobo={asset.netBookValueKobo}
                            today={today}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </TableSearch>

      <Card>
        <p className="muted" style={{ fontSize: 14 }}>
          Capitalising an asset posts <strong>Dr Property, Plant &amp; Equipment / Cr Trade
          Payables</strong> once approved. Running depreciation posts one{' '}
          <strong>Dr Depreciation Expense / Cr Accumulated Depreciation</strong> line per asset
          (or, for a machine marked with a processing line, Dr that line&rsquo;s overhead),
          for whichever period is chosen — never more than once per asset per period.
        </p>
      </Card>
    </div>
  );
}
