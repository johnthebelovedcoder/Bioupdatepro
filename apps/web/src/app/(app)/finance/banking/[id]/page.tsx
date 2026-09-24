import Link from 'next/link';
import { getReconciliation } from '@/lib/banking';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import {
  AutoMatchButton,
  ImportStatementForm,
  StatementLineActions,
} from '@/components/banking-forms';

export const metadata = { title: 'Bank reconciliation — BioAssetPro' };

const TONE: Record<string, string> = {
  MATCHED: 'badge-success',
  IGNORED: 'badge-warning',
  UNMATCHED: '',
};

/**
 * One bank account reconciled: the bank's closing balance against the
 * ledger's, with every reconciling item on either side named.
 */
export default async function BankReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await getReconciliation(id);

  if (!rec.ok) {
    return (
      <>
        <PageHeader
          title="Bank reconciliation"
          actions={
            <Link href="/finance/banking" className="btn btn-ghost">
              Back to banking
            </Link>
          }
        />
        <div className="notice notice-error">{rec.error}</div>
      </>
    );
  }
  const data = rec.data;
  const account = data.bankAccount;

  return (
    <>
      <PageHeader
        title={account.name}
        subtitle={`${account.bankName} ${account.accountNumberMasked} · ledger ${account.glAccount.accountNumber} ${account.glAccount.name}`}
        actions={
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <ImportStatementForm bankAccountId={account.id} />
            <Link href="/finance/banking" className="btn btn-ghost">
              Back
            </Link>
          </div>
        }
      />

      <div className="stack">
        {data.asOf === null ? (
          <Card>
            <p className="faint">
              No statement imported yet. Import one to see what the bank says against what the
              ledger says.
            </p>
          </Card>
        ) : (
          <>
            <div className="stat-grid">
              <Stat label={`Bank, ${formatDate(data.asOf)}`} value={formatNaira(data.statementClosingKobo)} money />
              <Stat label="Ledger, same date" value={formatNaira(data.ledgerBalanceKobo)} money />
              <Stat
                label="Difference"
                value={formatNaira(data.differenceKobo)}
                money
                goodWhen="down"
              />
            </div>

            <Card title={data.reconciled ? 'Reconciled' : 'Not yet reconciled'}>
              <table className="data">
                <tbody>
                  <tr>
                    <td style={{ textAlign: 'left' }}>Ledger balance</td>
                    <td className="num">{formatNaira(data.ledgerBalanceKobo)}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: 'left' }}>
                      Less: in the ledger, not yet on the bank ({data.uncleared.length})
                    </td>
                    <td className="num">{formatNaira((-toKobo(data.unclearedKobo)).toString())}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: 'left' }}>Add: on the bank, not in the ledger</td>
                    <td className="num">{formatNaira(data.notInLedgerKobo)}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>Should equal the bank&rsquo;s balance</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {formatNaira(
                        (toKobo(data.ledgerBalanceKobo) - toKobo(data.unclearedKobo) + toKobo(data.notInLedgerKobo)).toString(),
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
              {!data.reconciled ? (
                <p className="faint" style={{ marginTop: 'var(--sp-3)' }}>
                  A difference means something is missing on one side — most often a line still to
                  match, or a bank charge set aside but never journalled.
                </p>
              ) : null}
            </Card>
          </>
        )}

        {data.lines.length > 0 ? (
          <Card
            title="Statement lines"
            subtitle="Money in is positive, money out negative"
            action={<AutoMatchButton bankAccountId={account.id} />}
            padded={false}
          >
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Date</th>
                    <th>Description</th>
                    <th className="right" style={{ width: 140 }}>Amount</th>
                    <th style={{ width: 160 }}>Status</th>
                    <th style={{ width: 300 }} />
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line) => {
                    const candidates = data.uncleared.filter((u) => u.signedKobo === line.amountKobo);
                    return (
                      <tr key={line.id}>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {formatDate(line.valueDate)}
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          {line.description}
                          {line.reference ? <div className="faint">{line.reference}</div> : null}
                        </td>
                        <td className="num">{formatNaira(line.amountKobo)}</td>
                        <td>
                          <span className={`badge ${TONE[line.status] ?? ''}`}>
                            {line.status === 'MATCHED'
                              ? line.matchedJournal?.journalNumber ?? 'matched'
                              : line.status.toLowerCase()}
                          </span>
                          {line.ignoredReason ? <div className="faint">{line.ignoredReason}</div> : null}
                        </td>
                        <td>
                          <StatementLineActions bankAccountId={account.id} line={line} candidates={candidates} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {data.uncleared.length > 0 ? (
          <Card
            title="In the ledger, not yet on the bank"
            subtitle="Cheques not presented, deposits not credited — or entries the bank never made"
            padded={false}
          >
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Date</th>
                    <th style={{ width: 150 }}>Journal</th>
                    <th>Description</th>
                    <th className="right" style={{ width: 140 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.uncleared.map((line) => (
                    <tr key={line.id}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(line.journalDate)}
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        <Link href={`/ledger/journals?search=${encodeURIComponent(line.journalNumber)}`}>
                          {line.journalNumber}
                        </Link>
                      </td>
                      <td style={{ textAlign: 'left' }}>{line.description}</td>
                      <td className="num">{formatNaira(line.signedKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
