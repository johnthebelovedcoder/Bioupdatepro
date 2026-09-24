import Link from 'next/link';
import { getMyDocuments } from '@/lib/workflow';
import { describeTransaction, waitedFor } from '@/lib/workflow-labels';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconCheckCircle } from '@/components/icons';
import { CancelDocumentButton } from '@/components/cancel-document-button';

export const metadata = { title: 'Sent by me — BioAssetPro' };

/**
 * The maker's side of the queue: what you raised that is still in flight,
 * and what has been sent back to you for correction.
 *
 * Withdrawing is yours alone — nobody else can cancel a document you raised —
 * and only until somebody has approved a step of it.
 */
export default async function MyDocumentsPage() {
  const documents = await getMyDocuments();
  const returned = documents.filter((d) => d.status === 'RETURNED');

  return (
    <>
      <PageHeader title="Sent by me" subtitle="What you raised that is still waiting, and what came back" />

      <Tabs />

      <div className="stack">
        {returned.length > 0 ? (
          <div className="notice notice-warning">
            {returned.length} document{returned.length === 1 ? ' was' : 's were'} sent back to you
            for correction. Its trail says why. Resubmitting picks up the same approval trail.
          </div>
        ) : null}

        <Card title={`${documents.length} in flight`} padded={false}>
          {documents.length === 0 ? (
            <EmptyState
              icon={<IconCheckCircle size={22} />}
              title="Nothing of yours is waiting"
              body="Documents you raise appear here until they are approved, rejected or withdrawn."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Document</th>
                    <th>What it is</th>
                    <th className="right" style={{ width: 140 }}>Value</th>
                    <th style={{ width: 140 }}>Status</th>
                    <th style={{ width: 120 }}>Sent</th>
                    <th style={{ width: 170 }} />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.transactionId}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        <Link href={`/approvals/history/${doc.transactionId}`}>
                          {doc.documentReference}
                        </Link>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {describeTransaction(doc.transactionType)}
                        <div className="faint">{doc.route}</div>
                      </td>
                      <td className="num">{formatNaira(doc.amountKobo)}</td>
                      <td>
                        <span className={`badge ${doc.status === 'RETURNED' ? 'badge-warning' : ''}`}>
                          {doc.status === 'RETURNED' ? 'sent back to you' : 'waiting'}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {doc.submittedAt ? `${waitedFor(doc.submittedAt)} ago` : '—'}
                      </td>
                      <td>
                        {doc.canCancel ? (
                          <CancelDocumentButton transactionId={doc.transactionId} />
                        ) : (
                          <Link href={`/approvals/history/${doc.transactionId}`}>Trail</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
