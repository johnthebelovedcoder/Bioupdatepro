import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { getContext } from '@/lib/org';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Balance sheet — BioAssetPro' };

interface Line {
  accountNumber: string;
  accountName: string;
  amountKobo: string;
}

interface BalanceSheet {
  assets: Line[];
  liabilities: Line[];
  equity: Line[];
  totalAssetsKobo: string;
  totalLiabilitiesKobo: string;
  currentYearEarningsKobo: string;
  totalEquityKobo: string;
  totalLiabilitiesAndEquityKobo: string;
  balanced: boolean;
}

/**
 * Assets, liabilities and equity, as at now.
 *
 * Permanent accounts carry their balance since the company began, so there
 * is no period to pick here — unlike the trial balance and profit & loss,
 * this is always a snapshot of right now.
 */
export default async function BalanceSheetPage() {
  const context = await getContext();

  if (!context.company) {
    return (
      <div className="notice notice-warning">
        No company has been set up yet. Run <code>npm run db:seed</code> first.
      </div>
    );
  }

  let report: BalanceSheet | null = null;
  let error: string | null = null;
  try {
    report = await api<BalanceSheet>('/reporting/balance-sheet');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the statement.';
  }

  return (
    <div className="stack">
      <PageHeader
        title="Balance sheet"
        subtitle="What the company owns, owes, and is worth, as at today"
      />

      <Tabs />

      {error ? <div className="notice notice-error">{error}</div> : null}

      {report ? (
        <Card
          title="As at today"
          padded={false}
          action={
            <span className={`badge ${report.balanced ? 'badge-success' : 'badge-danger'}`}>
              {report.balanced ? 'Balanced' : 'OUT OF BALANCE'}
            </span>
          }
        >
          <div className="table-wrap">
            <table className="data">
              <tbody>
                <SectionHeader label="Assets" />
                {report.assets.length === 0 ? (
                  <EmptyLine />
                ) : (
                  report.assets.map((line) => <LineRow key={line.accountNumber} line={line} />)
                )}
                <TotalRow label="Total assets" amountKobo={report.totalAssetsKobo} strong />

                <SectionHeader label="Liabilities" />
                {report.liabilities.length === 0 ? (
                  <EmptyLine />
                ) : (
                  report.liabilities.map((line) => <LineRow key={line.accountNumber} line={line} />)
                )}
                <TotalRow label="Total liabilities" amountKobo={report.totalLiabilitiesKobo} />

                <SectionHeader label="Equity" />
                {report.equity.length === 0 ? (
                  <EmptyLine />
                ) : (
                  report.equity.map((line) => <LineRow key={line.accountNumber} line={line} />)
                )}
                <LineRow
                  line={{
                    accountNumber: '',
                    accountName: 'Current year earnings (not yet closed)',
                    amountKobo: report.currentYearEarningsKobo,
                  }}
                />
                <TotalRow label="Total equity" amountKobo={report.totalEquityKobo} />

                <TotalRow
                  label="Total liabilities and equity"
                  amountKobo={report.totalLiabilitiesAndEquityKobo}
                  strong
                  final
                />
              </tbody>
            </table>
          </div>
          <div className="card-footer">
            <span className="faint">
              No current/non-current split — the chart carries nothing yet that needs one.
              &ldquo;Current year earnings&rdquo; is this year&rsquo;s profit-and-loss result,
              computed live rather than posted; it becomes part of Retained Earnings once the
              year is closed.
            </span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} className="faint" style={{ paddingTop: 'var(--sp-3)' }}>
        {label}
      </td>
    </tr>
  );
}

function EmptyLine() {
  return (
    <tr>
      <td colSpan={2} className="faint">
        Nothing posted
      </td>
    </tr>
  );
}

function LineRow({ line }: { line: Line }) {
  return (
    <tr>
      <td style={{ paddingLeft: 'var(--sp-4)' }}>
        {line.accountNumber ? <span className="faint num">{line.accountNumber}</span> : null}{' '}
        {line.accountName}
      </td>
      <td className="num right">{formatNaira(line.amountKobo)}</td>
    </tr>
  );
}

function TotalRow({
  label,
  amountKobo,
  strong = false,
  final = false,
}: {
  label: string;
  amountKobo: string;
  strong?: boolean;
  final?: boolean;
}) {
  return (
    <tr style={final ? { borderTop: '2px solid var(--border-strong)' } : undefined}>
      <td style={strong ? { fontWeight: 600 } : undefined}>{label}</td>
      <td className="num right" style={strong ? { fontWeight: 600 } : undefined}>
        {formatNaira(amountKobo)}
      </td>
    </tr>
  );
}
