import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { getContext } from '@/lib/org';
import { Card, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'KPIs — BioAssetPro' };

interface Kpi {
  key: string;
  label: string;
  value: string | null;
  format: 'percent' | 'days' | 'currency';
  computable: boolean;
  reason: string | null;
}

/**
 * Where each KPI's own number is counted from — the story behind the
 * figure, not just the figure. Three keys are deliberately absent: yield,
 * cost variance and asset utilisation are never computable yet (see the
 * page's own note), so there is no source to send anyone to.
 */
const KPI_SOURCE: Record<string, string> = {
  survivalRate: '/agripro/biological-assets',
  mortalityRate: '/agripro/biological-assets',
  grossMargin: '/ledger/profit-loss',
  dso: '/ledger/ar-ageing',
  dpo: '/ledger/ap-ageing',
  payrollCostPerHead: '/finance/payroll/runs',
};

/**
 * The nine KPIs the client's user story names, each computed or explicitly
 * refused. Three of them — yield, cost variance, asset utilisation — always
 * come back not-yet-computable: they need a production order or a
 * usage-tracking model this chart doesn't carry yet, so the tile says so
 * rather than showing a number nobody could stand behind.
 */
interface KpiDefinition {
  key: string;
  label: string;
  numerator: string;
  denominator: string | null;
  formula: string;
  dimensions: string[];
}

export default async function KpisPage() {
  const context = await getContext();

  if (!context.company) {
    return (
      <div className="notice notice-warning">
        No company has been set up yet. Run <code>npm run db:seed</code> first.
      </div>
    );
  }

  let kpis: Kpi[] = [];
  let error: string | null = null;
  try {
    kpis = await api<Kpi[]>('/reporting/kpis');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the KPIs.';
  }
  // How each figure is computed, as governed rows — so "what does DSO mean
  // here" is answered on the screen rather than in the source code.
  const definitions = await api<KpiDefinition[]>('/reporting/kpi-definitions').catch(
    () => [] as KpiDefinition[],
  );

  return (
    <div className="stack">
      <PageHeader
        title="KPIs"
        subtitle="Nine measures management uses to make decisions, each computed or explicitly not"
      />

      <Tabs />

      {error ? <div className="notice notice-error">{error}</div> : null}

      <div className="stat-grid">
        {kpis.map((kpi) => (
          <Stat
            key={kpi.key}
            label={kpi.label}
            value={kpi.computable ? formatValue(kpi) : '—'}
            hint={kpi.computable ? undefined : `Not yet computable — ${kpi.reason}`}
            href={kpi.computable ? KPI_SOURCE[kpi.key] : undefined}
          />
        ))}
      </div>

      {definitions.length > 0 ? (
        <Card title="How each is computed" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 180 }}>Measure</th>
                  <th>Formula</th>
                  <th style={{ width: 200 }}>Numerator ÷ denominator</th>
                  <th style={{ width: 150 }}>Can be filtered by</th>
                </tr>
              </thead>
              <tbody>
                {definitions.map((definition) => (
                  <tr key={definition.key}>
                    <td style={{ textAlign: 'left' }}>{definition.label}</td>
                    <td className="faint" style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                      {definition.formula}
                    </td>
                    <td className="faint" style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                      {definition.numerator}
                      {definition.denominator ? ` ÷ ${definition.denominator}` : ''}
                    </td>
                    <td className="faint" style={{ textAlign: 'left' }}>
                      {definition.dimensions.length > 0
                        ? definition.dimensions.join(', ')
                        : 'company-wide only'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {kpis.length > 0 ? (
        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            Survival rate and mortality rate come from the population records directly — mortality
            counts confirmed deaths only, not sales or transfers. Gross margin, DSO and DPO are
            read against this financial year&rsquo;s Profit &amp; Loss and the same outstanding
            balances the AR/AP ageing reports show. Payroll cost per head is against the most
            recently posted payroll run&rsquo;s own headcount.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function formatValue(kpi: Kpi): string {
  if (kpi.value === null) return '—';
  switch (kpi.format) {
    case 'percent':
      return `${kpi.value}%`;
    case 'days':
      return `${kpi.value} days`;
    case 'currency':
      return formatNaira(kpi.value);
    default:
      return kpi.value;
  }
}
