import { getFinanceTrend } from '@/lib/trade';
import { formatNaira, toKobo } from '@/lib/money';
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
 *
 * There is no itemised expense register here — individual postings, with who
 * entered them and what they were charged to, live on the real Journal
 * entries page linked below. This page only ever shows what
 * `/reporting/profit-loss` can honestly give it: totals by account, by
 * period. A row-level table here would either duplicate that page or invent
 * detail the ledger was never asked to keep in this shape.
 */
export default async function FinancePage() {
  const trend = await getFinanceTrend();

  const latest = trend.points[trend.points.length - 1];
  const income = latest ? toKobo(latest.revenueKobo) : 0n;
  const spending = latest ? toKobo(latest.expenseKobo) : 0n;
  const net = income - spending;
  const totalExpense = trend.expenseByCategory.reduce(
    (sum, line) => sum + toKobo(line.amountKobo),
    0n,
  );
  const categories = [...trend.expenseByCategory].sort((a, b) =>
    toKobo(b.amountKobo) > toKobo(a.amountKobo) ? 1 : -1,
  );

  return (
    <>
      <PageHeader
        title="Income & expenses"
        subtitle="Money in, money out, and where it went"
      />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          <Stat
            label="Income this period"
            value={formatNaira(income)}
            money
            goodWhen="up"
            hint={latest?.label}
          />
          <Stat
            label="Spending this period"
            value={formatNaira(spending)}
            money
            goodWhen="down"
            hint={latest?.label}
          />
          <Stat label="Net" value={formatNaira(net)} money goodWhen="up" />
          <Stat label="Expense accounts" value={String(categories.length)} hint="with movement" />
        </div>

        <div className="two-col">
          <div className="stack">
            <Card title="Money in" subtitle={`Last ${trend.points.length || 0} periods`}>
              {/* Income and spending are separate charts rather than two lines
                  on one, for the same reason everywhere else in this product:
                  one axis, one measure. */}
              <TrendChart
                points={trend.points.map((point) => ({
                  date: point.date,
                  value: Number(toKobo(point.revenueKobo) / 100n),
                }))}
                valueLabel="naira"
                format="naira"
              />
            </Card>

            <Card title="Money out" subtitle={`Last ${trend.points.length || 0} periods`}>
              <TrendChart
                points={trend.points.map((point) => ({
                  date: point.date,
                  value: Number(toKobo(point.expenseKobo) / 100n),
                }))}
                kind="bar"
                tone="danger"
                valueLabel="naira"
                format="naira"
              />
            </Card>
          </div>

          <div className="stack">
            <Card title="Where it went" subtitle={latest?.label ? `${latest.label}, by account` : 'By account'}>
              <div className="stack" style={{ gap: 'var(--sp-4)' }}>
                {categories.length === 0 ? (
                  <p className="muted" style={{ fontSize: 14 }}>
                    Nothing posted to an expense account this period.
                  </p>
                ) : null}
                {categories.map((line) => {
                  const amount = toKobo(line.amountKobo);
                  const share = totalExpense > 0n ? Number((amount * 100n) / totalExpense) : 0;
                  return (
                    <div key={line.accountNumber}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 14 }}>{line.accountName}</span>
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
                  postings, without the accounting vocabulary. For individual entries, who
                  recorded them and what they were charged to, see the journal itself.
                </p>
                <CardLink href="/ledger/trial-balance">Trial balance</CardLink>
                <CardLink href="/ledger/journals">Journal entries</CardLink>
                <CardLink href="/ledger/audit">Audit trail</CardLink>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
