import { Card } from './ui';
import { formatNaira } from '@/lib/money';

export interface Statement {
  columns: string[];
  rows: Array<{ key: string; label: string; amounts: string[] }>;
}

export interface SegmentReport {
  products: { snail: Statement; poultry: Statement };
  enterprise: Statement;
  internalFeedKobo: { snail: string; poultry: string };
  checks: Array<{ check: string; actual: string; expected: string; status: 'PASS' | 'FAIL'; meaning: string }>;
}

const TOTALS = new Set(['totalIncome', 'totalExpenses', 'profitBeforeTax', 'profitAfterTax']);

/**
 * The segment statements (S_/P_/ENTERPRISE_CONSOLIDATED_PL) and their release
 * checks. Rows that are nothing in every column are left out, so a farm
 * without a feed mill or processing is not shown a wall of dashes.
 */
export function SegmentStatements({ report, period }: { report: SegmentReport; period: string }) {
  return (
    <>
      <StatementCard
        title={`SnailPro — ${period}`}
        subtitle="Snailery, feed mill and processing; internal feed eliminated"
        statement={report.products.snail}
      />
      <StatementCard
        title={`PoultryPro — ${period}`}
        subtitle="Poultry farm, feed mill and processing; internal feed eliminated"
        statement={report.products.poultry}
      />
      <StatementCard
        title={`Enterprise — ${period}`}
        subtitle="Both products together; Shared holds what neither can claim, not spread by any key"
        statement={report.enterprise}
      />

      <Card title="Release checks" subtitle="SEGMENT_ABC_CHECKS — every one must pass" padded={false}>
        <div className="table-wrap">
          <table className="data wide">
            <thead>
              <tr>
                <th>Check</th>
                <th className="right" style={{ width: 150 }}>Actual</th>
                <th className="right" style={{ width: 150 }}>Expected</th>
                <th style={{ width: 90 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map((c) => (
                <tr key={c.check}>
                  <td style={{ textAlign: 'left' }}>
                    {c.check} <span className="faint">— {c.meaning}</span>
                  </td>
                  <td className="num right">{formatNaira(c.actual)}</td>
                  <td className="num right">{formatNaira(c.expected)}</td>
                  <td>
                    <span className={`badge ${c.status === 'PASS' ? 'badge-success' : 'badge-danger'}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-footer">
          <span className="faint">
            The feed the mill supplied is measured as milled feed issued on the rounds at its store value (snails{' '}
            {formatNaira(report.internalFeedKobo.snail)}, poultry {formatNaira(report.internalFeedKobo.poultry)}). It shows as mill
            revenue and farm cost, is taken back out of the farm&rsquo;s own lines, and is eliminated — the consolidated column is
            the statutory result.
          </span>
        </div>
      </Card>
    </>
  );
}

function StatementCard({ title, subtitle, statement }: { title: string; subtitle: string; statement: Statement }) {
  const rows = statement.rows.filter((r) => TOTALS.has(r.key) || r.amounts.some((a) => a !== '0'));
  return (
    <Card title={title} subtitle={subtitle} padded={false}>
      <div className="table-wrap">
        <table className="data wide">
          <thead>
            <tr>
              <th />
              {statement.columns.map((c) => (
                <th key={c} className="right" style={{ width: 130 }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const strong = TOTALS.has(r.key);
              const style = strong ? { fontWeight: 600 } : undefined;
              return (
                <tr key={r.key} style={r.key === 'profitBeforeTax' ? { borderTop: '2px solid var(--border-strong)' } : undefined}>
                  <td style={{ ...style, paddingLeft: strong ? undefined : 'var(--sp-4)' }}>{r.label}</td>
                  {r.amounts.map((a, i) => (
                    <td key={i} className="num right" style={style}>
                      {a === '0' && !strong ? <span className="faint">—</span> : formatNaira(a)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
