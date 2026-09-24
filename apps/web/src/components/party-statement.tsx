import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { PrintButton } from '@/components/print-button';

interface Statement {
  partyType: 'CUSTOMER' | 'SUPPLIER';
  partyCode: string;
  partyName: string;
  from: string;
  to: string;
  openingBalanceKobo: string;
  closingBalanceKobo: string;
  totalDebitKobo: string;
  totalCreditKobo: string;
  lines: Array<{
    journalDate: string;
    journalNumber: string;
    narration: string;
    description: string;
    sourceModule: string;
    debitKobo: string;
    creditKobo: string;
    runningBalanceKobo: string;
  }>;
}

/**
 * A customer's or supplier's statement for a date range, read straight off
 * the ledger lines that carry them — the document you send a customer who
 * disputes what they owe, or reconcile against a supplier's own statement.
 */
export async function PartyStatement({
  kind,
  id,
  from,
  to,
}: {
  kind: 'customer' | 'supplier';
  id: string;
  from?: string;
  to?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const start =
    from ?? new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
  const end = to ?? today;
  const listHref = kind === 'customer' ? '/customers' : '/suppliers';

  let statement: Statement | null = null;
  let error: string | null = null;
  try {
    const query = new URLSearchParams({ [`${kind}Id`]: id, from: start, to: end });
    statement = await api<Statement>(`/journal/${kind}-adjustments?${query}`);
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the statement.';
  }

  // The API already presents each side as a positive debt — what a customer
  // owes us, or what we owe a supplier — so the balance is shown as given.
  const owedLabel = kind === 'customer' ? 'Owed to us' : 'We owe them';

  return (
    <>
      <PageHeader
        title={statement ? `${statement.partyName} — statement` : 'Statement'}
        subtitle={`${formatDate(start)} to ${formatDate(end)}`}
        actions={
          <div className="row no-print" style={{ gap: 'var(--sp-2)' }}>
            <PrintButton />
            <Link href={listHref} className="btn btn-ghost">
              Back
            </Link>
          </div>
        }
      />

      <div className="stack">
        <form className="row no-print" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field">
            From
            <input type="date" name="from" defaultValue={start} />
          </label>
          <label className="field">
            To
            <input type="date" name="to" defaultValue={end} max={today} />
          </label>
          <button type="submit" className="btn">
            Show
          </button>
        </form>

        {error ? <div className="notice notice-error">{error}</div> : null}

        {statement ? (
          <>
            <div className="stat-grid">
              <Stat label="Opening balance" value={formatNaira(statement.openingBalanceKobo)} money />
              <Stat label="Charged" value={formatNaira(statement.totalDebitKobo)} money />
              <Stat label="Paid / credited" value={formatNaira(statement.totalCreditKobo)} money />
              <Stat
                label={owedLabel}
                value={formatNaira(statement.closingBalanceKobo)}
                money
              />
            </div>

            <Card padded={false}>
              {statement.lines.length === 0 ? (
                <p className="faint" style={{ padding: 'var(--sp-5)' }}>
                  Nothing posted against {statement.partyName} in these dates.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data wide">
                    <thead>
                      <tr>
                        <th style={{ width: 110 }}>Date</th>
                        <th style={{ width: 140 }}>Journal</th>
                        <th>Detail</th>
                        <th className="right" style={{ width: 130 }}>Debit</th>
                        <th className="right" style={{ width: 130 }}>Credit</th>
                        <th className="right" style={{ width: 140 }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.lines.map((line, index) => (
                        <tr key={`${line.journalNumber}-${index}`}>
                          <td className="num" style={{ textAlign: 'left' }}>
                            {formatDate(line.journalDate)}
                          </td>
                          <td className="num" style={{ textAlign: 'left' }}>
                            {line.journalNumber}
                          </td>
                          <td style={{ textAlign: 'left' }}>
                            {line.description || line.narration}
                            <div className="faint">{line.sourceModule.toLowerCase()}</div>
                          </td>
                          <td className="num">
                            {toKobo(line.debitKobo) > 0n ? formatNaira(line.debitKobo) : ''}
                          </td>
                          <td className="num">
                            {toKobo(line.creditKobo) > 0n ? formatNaira(line.creditKobo) : ''}
                          </td>
                          <td className="num">{formatNaira(line.runningBalanceKobo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
