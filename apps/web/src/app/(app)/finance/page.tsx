import Link from 'next/link';
import { getCashFlow, getExpenses } from '@/lib/demo-trade';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, CardLink, PageHeader, Stat } from '@/components/ui';
import { TrendChart } from '@/components/trend-chart';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Income & expenses — BioAssetPro' };

/**
 * The day-to-day money view.
 *
 * Deliberately a VIEW over the general ledger rather than a second set of
 * books. The original specification asked for simple operational finance for
 * the first release; building that separately would produce two sets of numbers
 * that disagree within a quarter. Everything here is the same ledger the trial
 * balance reads, presented in the words a farm manager uses.
 */
export default async function FinancePage() {
  const [expenses, cash] = await Promise.all([getExpenses(), getCashFlow()]);

  const totalExpense = expenses.reduce((sum, row) => sum + toKobo(row.amountKobo), 0n);

  const byCategory = new Map<string, bigint>();
  for (const row of expenses) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0n) + toKobo(row.amountKobo));
  }
  const categories = [...byCategory.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1));

  const latest = cash[cash.length - 1];
  const inflow = latest ? toKobo(latest.inKobo) : 0n;
  const outflow = latest ? toKobo(latest.outKobo) : 0n;
  const net = inflow - outflow;

  return (
    <>
      <PageHeader
        title="Income & expenses"
        subtitle="Money in, money out, and where it went"
      />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Income this month" value={formatNaira(inflow)} money goodWhen="up" />
          <Stat label="Spending this month" value={formatNaira(outflow)} money goodWhen="down" />
          <Stat label="Net" value={formatNaira(net)} money goodWhen="up" />
          <Stat
            label="Recorded expenses"
            value={String(expenses.length)}
            hint="last 15 days"
          />
        </div>

        <div className="two-col">
          <div className="stack">
            <Card title="Money in" subtitle="Last six months">
              {/* Income and spending are separate charts rather than two lines
                  on one, for the same reason everywhere else in this product:
                  one axis, one measure. */}
              <TrendChart
                points={cash.map((point) => ({
                  date: point.date,
                  value: Number(toKobo(point.inKobo) / 100n),
                }))}
                valueLabel="naira"
                format="naira"
              />
            </Card>

            <Card title="Money out" subtitle="Last six months">
              <TrendChart
                points={cash.map((point) => ({
                  date: point.date,
                  value: Number(toKobo(point.outKobo) / 100n),
                }))}
                kind="bar"
                tone="danger"
                valueLabel="naira"
                format="naira"
              />
            </Card>
          </div>

          <div className="stack">
            <Card title="Where it went" subtitle="By category">
              <div className="stack" style={{ gap: 'var(--sp-4)' }}>
                {categories.map(([category, amount]) => {
                  const share =
                    totalExpense > 0n ? Number((amount * 100n) / totalExpense) : 0;
                  return (
                    <div key={category}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 14 }}>{category}</span>
                        <span className="num" style={{ fontSize: 13 }}>
                          {formatNaira(amount)}
                        </span>
                      </div>
                      <div className="meter">
                        <div className="meter-fill" style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="The books">
              <div className="stack" style={{ gap: 'var(--sp-3)' }}>
                <p className="muted" style={{ fontSize: 14 }}>
                  These figures are a plain-language view of the general ledger — the same
                  postings, without the accounting vocabulary.
                </p>
                <CardLink href="/ledger/trial-balance">Trial balance</CardLink>
                <CardLink href="/ledger/journals">Journal entries</CardLink>
                <CardLink href="/ledger/audit">Audit trail</CardLink>
              </div>
            </Card>
          </div>
        </div>

        <Card title="Expenses" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th style={{ width: 130 }}>Category</th>
                  <th>Description</th>
                  <th style={{ width: 130 }}>Charged to</th>
                  <th style={{ width: 130 }}>Method</th>
                  <th className="right" style={{ width: 130 }}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((row) => (
                  <tr key={row.id}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(row.date)}
                    </td>
                    <td>{row.category}</td>
                    <td>
                      {row.description}
                      <div className="faint">Entered by {row.by}</div>
                    </td>
                    {/* The module comes from the row, not a guess. A snail
                        colony linked at /m/poultry/batches/ would 404. */}
                    <td className="faint">
                      {row.batch ? (
                        <Link
                          href={`/m/${row.batchModule ?? 'poultry'}/${
                            row.batchModule === 'snail' ? 'colonies' : 'batches'
                          }/${row.batch}`}
                        >
                          {row.batch}
                        </Link>
                      ) : (
                        row.farm
                      )}
                    </td>
                    <td className="faint">{row.method}</td>
                    <td className="num">{formatNaira(row.amountKobo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total</td>
                  <td className="num">{formatNaira(totalExpense)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="card-footer">
            <span className="faint">
              An expense charged to a batch lands on that batch&apos;s work-in-progress
              account, which is what makes batch profitability tie back to the profit and
              loss rather than approximate it.
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
