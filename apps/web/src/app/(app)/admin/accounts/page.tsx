import { getGlAccounts } from '@/lib/trade';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';
import { ClassifyAccountSelect } from '@/components/classify-account-select';

export const metadata = { title: 'GL accounts — BioAssetPro' };

/**
 * Where each account sits within a statement (US-897-002) — distinct from
 * its accountType (asset/liability/equity/revenue/expense), which only says
 * which side of the ledger it's on, not current-vs-non-current or cost of
 * sales vs operating expense. P&L and Balance Sheet now use this classification
 * and identify active accounts that still need a finance decision.
 */
export default async function GlAccountsPage() {
  const accounts = await getGlAccounts();

  return (
    <div className="stack">
      <PageHeader
        title="GL accounts"
        subtitle="Where each account sits on the balance sheet or profit & loss"
      />

      <Tabs />

      <TableSearch placeholder="Search accounts">
        <Card title={`${accounts.length} accounts`} padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Account</th>
                  <th>Name</th>
                  <th style={{ width: 120 }}>Type</th>
                  <th style={{ width: 220 }}>FS category</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {account.accountNumber}
                    </td>
                    <td>{account.name}</td>
                    <td className="faint">{account.accountType.toLowerCase()}</td>
                    <td>
                      <ClassifyAccountSelect
                        accountId={account.id}
                        fsCategory={account.fsCategory}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </TableSearch>
    </div>
  );
}
