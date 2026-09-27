import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconChart } from '@/components/icons';

export const metadata = { title: 'Yield and profitability — BioAssetPro' };

type Cycle = 'SNAILPRO' | 'POULTRYPRO';

interface Row {
  orderId: string;
  orderNumber: string;
  cycle: Cycle;
  completedOn: string | null;
  settled: boolean;
  source: string | null;
  inputKg: string | null;
  mainKg: string;
  byProductKg: string;
  lossKg: string | null;
  yieldPercent: string | null;
  standardConversionKobo: string;
  actualConversionKobo: string;
  varianceKobo: string;
  finishedGoodsCostKobo: string;
  salesValueKobo: string | null;
  marginKobo: string | null;
}

interface Totals {
  cycle: Cycle;
  orders: number;
  yieldPercent: string | null;
  varianceKobo: string;
  finishedGoodsCostKobo: string;
}

const CYCLES: Array<{ key: Cycle; label: string; main: string }> = [
  { key: 'SNAILPRO', label: 'Snails', main: 'Meat' },
  { key: 'POULTRYPRO', label: 'Poultry', main: 'Dressed' },
];

const kg = (value: string | null) => (value === null ? '—' : `${Number(value).toLocaleString('en-NG', { maximumFractionDigits: 3 })} kg`);

/**
 * Processing yield and order profitability (REPORT_KPI_CATALOG SNL-009/010,
 * PLY-010/011): each completed order's mass balance and its money. Worth is
 * at the approved selling prices the order was costed from — sales are not
 * matched back to orders, so this is what the output is worth, not what it
 * fetched.
 */
export default async function ProcessingResultsPage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const { cycle: asked } = await searchParams;
  const cycle = CYCLES.find((c) => c.key === asked) ?? CYCLES[1]!;
  let rows: Row[] = [];
  let totals: Totals[] = [];
  let error: string | null = null;
  try {
    ({ rows, totals } = await api<{ rows: Row[]; totals: Totals[] }>(`/production-orders/results?cycle=${cycle.key}`));
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load the results.';
  }
  const total = totals.find((t) => t.cycle === cycle.key);

  return (
    <>
      <PageHeader title="Yield and profitability" subtitle="What each processing order turned live weight into, what it cost, and what its output is worth" />
      <Tabs />

      <div className="chip-row" role="group" aria-label="Species" style={{ marginBottom: 'var(--sp-4)' }}>
        {CYCLES.map((c) => (
          <Link key={c.key} href={`/production/results?cycle=${c.key}`} className="chip" aria-pressed={c.key === cycle.key}>
            {c.label}
          </Link>
        ))}
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <Card
        title={`${cycle.label}: ${rows.length} completed order${rows.length === 1 ? '' : 's'}`}
        subtitle={total?.yieldPercent ? `${cycle.main} yield ${total.yieldPercent}% overall · variance ${formatNaira(total.varianceKobo)}` : undefined}
        padded={false}
      >
        {rows.length === 0 ? (
          <EmptyState icon={<IconChart size={22} />} title="Nothing completed yet" body="A processing order appears here once its output is received." />
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Order</th>
                  <th className="num">Live in</th>
                  <th className="num">{cycle.main}</th>
                  <th className="num">By-products</th>
                  <th className="num">Loss</th>
                  <th className="num">Yield</th>
                  <th className="num">Conversion variance</th>
                  <th className="num">Cost of output</th>
                  <th className="num">Worth at approved prices</th>
                  <th className="num">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.orderId}>
                    <td>
                      <Link href={`/production/${r.orderId}`}>{r.orderNumber}</Link>
                      <div className="faint">
                        {r.source ?? '—'} · {r.completedOn ?? ''}
                        {r.settled ? '' : ' · not settled'}
                      </div>
                    </td>
                    <td className="num">{kg(r.inputKg)}</td>
                    <td className="num">{kg(r.mainKg)}</td>
                    <td className="num">{kg(r.byProductKg)}</td>
                    <td className="num">{kg(r.lossKg)}</td>
                    <td className="num strong">{r.yieldPercent ? `${r.yieldPercent}%` : '—'}</td>
                    <td className="num">{formatNaira(r.varianceKobo)}</td>
                    <td className="num">{formatNaira(r.finishedGoodsCostKobo)}</td>
                    <td className="num">{r.salesValueKobo ? formatNaira(r.salesValueKobo) : '—'}</td>
                    <td className="num strong">{r.marginKobo ? formatNaira(r.marginKobo) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="faint" style={{ marginTop: 'var(--sp-3)', fontSize: 13 }}>
        Worth is the output at the approved selling prices, less further costs, that the order was costed from. What each order’s output actually sold for is not matched back to the order. A positive variance means conversion cost more than standard.
      </p>
    </>
  );
}
