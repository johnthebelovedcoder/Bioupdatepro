import { api } from '@/lib/api';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { DownloadPaymentFile, IssuePaymentFile, type PendingPayment } from '@/components/payment-file-forms';

export const metadata = { title: 'Bank payment files — BioAssetPro' };

interface PaymentFileRow {
  id: string;
  reference: string;
  kind: 'SUPPLIER' | 'SALARY';
  rowCount: number;
  totalKobo: string;
  sha256: string;
  createdAt: string;
}

/**
 * Bank payment files (SOP-P2P-05, handbook §37): posted bank transfers
 * gathered into one CSV for the bank's bulk-upload channel. Supplier
 * transfers go only to verified accounts; salaries one row per employee.
 */
export default async function PaymentFilesPage() {
  const [suppliers, salaries, files] = await Promise.all([
    api<PendingPayment[]>('/banking/payment-files/pending?kind=SUPPLIER'),
    api<PendingPayment[]>('/banking/payment-files/pending?kind=SALARY'),
    api<PaymentFileRow[]>('/banking/payment-files'),
  ]);
  return (
    <>
      <PageHeader title="Bank payment files" subtitle="Posted transfers, ready for the bank's bulk upload" />
      <Tabs />
      <div className="stack">
        <Card title="Supplier transfers" subtitle="Only to bank accounts verified by someone other than whoever entered them">
          <IssuePaymentFile kind="SUPPLIER" payments={suppliers} />
        </Card>
        <Card title="Salaries" subtitle="One row per employee paid in the run">
          <IssuePaymentFile kind="SALARY" payments={salaries} />
        </Card>
        <Card title="Files issued" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 170 }}>File</th>
                  <th style={{ width: 110 }}>For</th>
                  <th className="right" style={{ width: 90 }}>Rows</th>
                  <th className="right" style={{ width: 150 }}>Total</th>
                  <th>SHA-256</th>
                  <th style={{ width: 200 }} />
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="faint">
                      None yet.
                    </td>
                  </tr>
                ) : (
                  files.map((f) => (
                    <tr key={f.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {f.reference}
                        <div className="faint">{formatDate(f.createdAt)}</div>
                      </td>
                      <td>{f.kind === 'SUPPLIER' ? 'Suppliers' : 'Salaries'}</td>
                      <td className="num right">{f.rowCount}</td>
                      <td className="num right">{formatNaira(f.totalKobo)}</td>
                      <td className="num faint" style={{ fontSize: 12 }}>
                        {f.sha256.slice(0, 24)}…
                      </td>
                      <td>
                        <DownloadPaymentFile id={f.id} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
