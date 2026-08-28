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
 * The nine KPIs the client's user story names, each computed or explicitly
 * refused. Three of them — yield, cost variance, asset utilisation — always
 * come back not-yet-computable: they need a production order or a
 * usage-tracking model this chart doesn't carry yet, so the tile says so
 * rather than showing a number nobody could stand behind.
 */
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
          />
        ))}
      </div>

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
