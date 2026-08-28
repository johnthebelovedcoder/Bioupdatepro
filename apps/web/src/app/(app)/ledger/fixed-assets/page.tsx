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
import { TableSearch } from '@/components/table-search';

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
  const [assets, context, dimensions] = await Promise.all([
    getFixedAssets(),
    getContext(),
    api<{ costCentres: Array<{ id: string; code: string; name: string }> }>(
      '/reporting/dimensions',
    ),
  ]);

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
          {awaiting.length} capitalisation{awaiting.length === 1 ? '' : 's'} waiting for approval.
          Nothing has posted for {awaiting.length === 1 ? 'it' : 'them'} yet —{' '}
          <Link href="/approvals">the approvals queue</Link> is where that happens.
        </div>
      ) : null}

      <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <CapitaliseAssetForm costCentres={dimensions.costCentres} today={today} />
        <RunDepreciationForm periods={year?.periods ?? []} />
      </div>

      <TableSearch placeholder="Search the register">
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
          <strong>Dr Depreciation Expense / Cr Accumulated Depreciation</strong> line per asset,
          for whichever period is chosen — never more than once per asset per period.
        </p>
      </Card>
    </div>
  );
}
