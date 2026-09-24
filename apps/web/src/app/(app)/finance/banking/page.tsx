import Link from 'next/link';
import { getBankAccounts } from '@/lib/banking';
import { getGlAccounts } from '@/lib/trade';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconWallet } from '@/components/icons';
import { AddBankAccountForm } from '@/components/banking-forms';

export const metadata = { title: 'Banking — BioAssetPro' };

/**
 * The farm's bank accounts, what the ledger says is in each, and whether the
 * bank agrees. Each account opens to its reconciliation.
 */
export default async function BankingPage() {
  const [accounts, gl] = await Promise.all([getBankAccounts(), getGlAccounts().catch(() => [])]);
  const assetAccounts = gl.filter((account) => account.accountType === 'ASSET');

  return (
    <>
      <PageHeader
        title="Banking"
        subtitle="Bank accounts, imported statements, and whether the ledger agrees with the bank"
        actions={accounts.ok ? <AddBankAccountForm ledgerAccounts={assetAccounts} /> : null}
      />

      <Tabs />

      <div className="stack">
        {!accounts.ok ? <div className="notice notice-error">{accounts.error}</div> : null}

        {accounts.ok && accounts.data.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconWallet size={22} />}
              title="No bank accounts yet"
              body="Add each bank account the farm uses, on the ledger account its payments post to. Then import a statement to reconcile it."
            />
          </Card>
        ) : null}

        {accounts.ok && accounts.data.length > 0 ? (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th style={{ width: 170 }}>Ledger account</th>
                    <th className="right" style={{ width: 150 }}>Ledger balance</th>
                    <th className="right" style={{ width: 170 }}>Last statement</th>
                    <th style={{ width: 130 }}>To reconcile</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.data.map((account) => (
                    <tr key={account.id}>
                      <td style={{ textAlign: 'left' }}>
                        <Link href={`/finance/banking/${account.id}`} className="strong">
                          {account.name}
                        </Link>
                        <div className="faint">
                          {account.bankName} {account.accountNumberMasked}
                        </div>
                      </td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {account.glAccount ? `${account.glAccount.accountNumber} ${account.glAccount.name}` : '—'}
                      </td>
                      <td className="num">{formatNaira(account.ledgerBalanceKobo)}</td>
                      <td className="num">
                        {account.latestStatement ? (
                          <>
                            {formatNaira(account.latestStatement.closingBalanceKobo)}
                            <div className="faint">to {formatDate(account.latestStatement.periodTo)}</div>
                          </>
                        ) : (
                          <span className="faint">none imported</span>
                        )}
                      </td>
                      <td>
                        {account.latestStatement === null ? (
                          <span className="badge">no statement</span>
                        ) : account.unmatchedLines > 0 ? (
                          <span className="badge badge-warning">
                            {account.unmatchedLines} line{account.unmatchedLines === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="badge badge-success">all settled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {accounts.ok && accounts.data.some((a) => toKobo(a.ledgerBalanceKobo) < 0n) ? (
          <div className="notice notice-warning">
            A bank account shows a negative ledger balance. Either it is overdrawn, or payments were
            posted to it that the bank never made — reconciling it will say which.
          </div>
        ) : null}
      </div>
    </>
  );
}
