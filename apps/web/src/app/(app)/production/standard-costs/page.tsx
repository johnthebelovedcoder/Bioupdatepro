import { api } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { DecideStandard, PolicyForm, PrepareStandardForm } from '@/components/standard-cost-forms';

export const metadata = { title: 'Standard costs — BioAssetPro' };

interface RollUpLine {
  kind: string;
  reference: string;
  description: string;
  quantity: string;
  unit: string;
  rateKobo: string;
  costKobo: string;
}

interface StandardCosts {
  policies: Array<{
    financialYearId: string;
    code: string;
    startDate: string;
    endDate: string;
    policy: { method: string; varianceDisposition: string; varianceTolerancePercent: string; configuredAt: string; lockedAt: string | null } | null;
  }>;
  versions: Array<{
    id: string;
    item: string;
    recipe: string;
    financialYear: string;
    versionNumber: number;
    effectiveFrom: string;
    outputQuantity: string;
    materialKobo: string;
    packagingKobo: string;
    labourKobo: string;
    machineKobo: string;
    overheadKobo: string;
    depreciationKobo: string;
    totalKobo: string;
    unitCostKobo: string;
    previousUnitCostKobo: string | null;
    lines: RollUpLine[];
    status: string;
    preparedBy: string | null;
    approvedBy: string | null;
    rejectionReason: string | null;
  }>;
  recipeVersions: Array<{ id: string; label: string }>;
}

const TONE: Record<string, string> = { RELEASED: 'badge-success', PENDING: 'badge-warning', REJECTED: 'badge-danger', SUPERSEDED: '' };

/**
 * The Standard Cost Workbench (POL-001/003, SOP-049/050): each year's
 * costing policy — standard cost only, locked by the year's first production
 * posting — and every product's standard, rolled up from recipe and routing,
 * prepared by one person and released by another.
 */
export default async function StandardCostsPage() {
  const data = await api<StandardCosts>('/production-orders/standard-costs');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Standard costs" subtitle="What production is valued at, and the policy that fixes it for the year" />
      <Tabs />
      <div className="stack">
        <Card title="Costing policy" subtitle="Standard cost only; actual cost is compared, never posted as an alternative (POL-001, POL-004)" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Year</th>
                  <th>Method</th>
                  <th style={{ width: 150 }}>Variances go to</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.policies.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="faint">
                      No financial years yet.
                    </td>
                  </tr>
                ) : (
                  data.policies.map((year) => (
                    <tr key={year.financialYearId}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {year.code}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {year.policy ? (
                          <>
                            Standard cost · tolerance {Number(year.policy.varianceTolerancePercent)}%
                          </>
                        ) : (
                          <span className="faint">Not configured — production cannot post in this year until it is.</span>
                        )}
                      </td>
                      <td>{year.policy ? 'Cost of sales' : '—'}</td>
                      <td style={{ textAlign: 'left' }}>
                        {year.policy?.lockedAt ? (
                          <span className="badge badge-success">locked {year.policy.lockedAt.slice(0, 10)}</span>
                        ) : (
                          <PolicyForm financialYearId={year.financialYearId} tolerance={year.policy?.varianceTolerancePercent ?? '20'} />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Prepare a standard" subtitle="POL-003: material + packaging + labour + machine + overhead + depreciation">
          <PrepareStandardForm recipeVersions={data.recipeVersions} today={today} />
        </Card>

        <Card title="Standards" subtitle="A released standard is fixed; a revision is a new version from a later date" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ width: 90 }}>Version</th>
                  <th style={{ width: 110 }}>From</th>
                  <th className="right" style={{ width: 120 }}>Material</th>
                  <th className="right" style={{ width: 120 }}>Packaging</th>
                  <th className="right" style={{ width: 120 }}>Labour</th>
                  <th className="right" style={{ width: 120 }}>Machine</th>
                  <th className="right" style={{ width: 120 }}>Overhead</th>
                  <th className="right" style={{ width: 120 }}>Depreciation</th>
                  <th className="right" style={{ width: 140 }}>A unit</th>
                  <th style={{ width: 210 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.versions.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="faint">
                      No standards yet. A feed-mill order&rsquo;s output cannot be received until its product has a released standard.
                    </td>
                  </tr>
                ) : (
                  data.versions.map((v) => {
                    const change =
                      v.previousUnitCostKobo !== null && BigInt(v.previousUnitCostKobo) > 0n
                        ? ((Number(v.unitCostKobo) - Number(v.previousUnitCostKobo)) / Number(v.previousUnitCostKobo)) * 100
                        : null;
                    return (
                      <tr key={v.id}>
                        <td style={{ textAlign: 'left' }}>
                          {v.item}
                          <details>
                            <summary className="faint" style={{ cursor: 'pointer' }}>
                              {v.recipe} · batch {Number(v.outputQuantity).toLocaleString()} · {v.lines.length} lines
                            </summary>
                            <table className="data" style={{ marginTop: 'var(--sp-2)' }}>
                              <tbody>
                                {v.lines.map((line) => (
                                  <tr key={`${line.kind}-${line.reference}`}>
                                    <td style={{ textAlign: 'left' }}>
                                      {line.reference} <span className="faint">{line.description}</span>
                                    </td>
                                    <td className="num">
                                      {Number(line.quantity).toLocaleString()} {line.unit} × {formatNaira(line.rateKobo)}
                                    </td>
                                    <td className="num">{formatNaira(line.costKobo)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        </td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {v.financialYear} v{v.versionNumber}
                        </td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {v.effectiveFrom}
                        </td>
                        <td className="num right">{formatNaira(v.materialKobo)}</td>
                        <td className="num right">{formatNaira(v.packagingKobo)}</td>
                        <td className="num right">{formatNaira(v.labourKobo)}</td>
                        <td className="num right">{formatNaira(v.machineKobo)}</td>
                        <td className="num right">{formatNaira(v.overheadKobo)}</td>
                        <td className="num right">{formatNaira(v.depreciationKobo)}</td>
                        <td className="num right">
                          <strong>{formatNaira(v.unitCostKobo)}</strong>
                          {change !== null ? (
                            <div className="faint">
                              was {formatNaira(v.previousUnitCostKobo!)} ({change >= 0 ? '+' : ''}
                              {change.toFixed(1)}%)
                            </div>
                          ) : null}
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          {v.status === 'PENDING' ? (
                            <>
                              <div className="faint" style={{ marginBottom: 4 }}>
                                prepared by {v.preparedBy}
                              </div>
                              <DecideStandard versionId={v.id} />
                            </>
                          ) : (
                            <span className={`badge ${TONE[v.status] ?? ''}`} title={v.rejectionReason ?? undefined}>
                              {v.status.toLowerCase()}
                              {v.approvedBy ? ` · ${v.approvedBy}` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
