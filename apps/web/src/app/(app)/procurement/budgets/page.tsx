import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { getContext } from '@/lib/org';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { BudgetForm } from '@/components/budget-form';

export const metadata = { title: 'Purchase budgets — BioAssetPro' };

interface Budgets {
  financialYear: string;
  budgets: Array<{ id: string; costCentre: string; amountKobo: string; committedKobo: string; remainingKobo: string; note: string | null }>;
}

/**
 * Purchase budgets (INT-002): what each cost centre may commit on purchase
 * orders in a year. An order that would take its cost centre past its budget
 * is refused when it is submitted.
 */
export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ financialYearId?: string }> }) {
  const { financialYearId } = await searchParams;
  const context = await getContext();
  const today = new Date().toISOString().slice(0, 10);
  const years = context.financialYears;
  const year =
    years.find((y) => y.id === financialYearId) ??
    years.find((y) => y.periods.some((p) => p.startDate <= today && today <= p.endDate)) ??
    years[0];

  let data: Budgets | null = null;
  let error: string | null = null;
  let costCentres: Array<{ id: string; code: string; name: string }> = [];
  if (year) {
    try {
      [data, costCentres] = await Promise.all([
        api<Budgets>(`/procurement/budgets?financialYearId=${year.id}`),
        api<Array<{ id: string; code: string; name: string }>>('/masters/cost-centres'),
      ]);
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : 'Could not load the budgets.';
    }
  }

  return (
    <>
      <PageHeader title="Purchase budgets" subtitle="What each cost centre may commit on purchase orders in the year" />
      <Tabs />
      <div className="stack">
        {years.length > 1 ? (
          <form method="get" className="row" style={{ gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
            <label className="field">
              Year
              <select name="financialYearId" defaultValue={year?.id}>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.code}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn">
              Show
            </button>
          </form>
        ) : null}
        {error ? <div className="notice notice-error">{error}</div> : null}

        {data ? (
          <Card
            title={`${data.financialYear} budgets`}
            subtitle="Committed is every purchase order submitted or beyond and not cancelled, at its value before VAT. A cost centre with no budget is not controlled."
            padded={false}
          >
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Cost centre</th>
                    <th className="right" style={{ width: 150 }}>Budget</th>
                    <th className="right" style={{ width: 150 }}>Committed</th>
                    <th className="right" style={{ width: 150 }}>Remaining</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.budgets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="faint">
                        No budgets for this year. Orders are not checked against a budget until one is set.
                      </td>
                    </tr>
                  ) : (
                    data.budgets.map((b) => (
                      <tr key={b.id}>
                        <td style={{ textAlign: 'left' }}>{b.costCentre}</td>
                        <td className="num right">{formatNaira(b.amountKobo)}</td>
                        <td className="num right">{formatNaira(b.committedKobo)}</td>
                        <td className="num right" style={BigInt(b.remainingKobo) < 0n ? { color: 'var(--error-700)' } : undefined}>
                          <strong>{formatNaira(b.remainingKobo)}</strong>
                        </td>
                        <td className="faint" style={{ textAlign: 'left' }}>
                          {b.note ?? ''}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {year ? (
          <Card title="Set a budget" subtitle="Setting one for any cost centre means every order this year must name its cost centre">
            <BudgetForm financialYearId={year.id} costCentres={costCentres.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
