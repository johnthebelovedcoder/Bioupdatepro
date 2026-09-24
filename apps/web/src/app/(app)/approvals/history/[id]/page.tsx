import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getHistory } from '@/lib/workflow';
import { formatDateTime } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'Approval trail — BioAssetPro' };

/**
 * Who did what to one document, in order: raised, approved at which level,
 * returned and why, resubmitted, and anyone acting on somebody else's behalf.
 */
export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const history = await getHistory(id);
  if (!history) notFound();

  return (
    <>
      <PageHeader
        title="Approval trail"
        subtitle="Every step this document has taken, oldest first"
        actions={
          <Link href="/approvals" className="btn btn-ghost">
            Back to approvals
          </Link>
        }
      />

      <Card padded={false}>
        {history.length === 0 ? (
          <p className="faint" style={{ padding: 'var(--sp-5)' }}>
            Nothing has happened to this document yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>When</th>
                  <th style={{ width: 130 }}>What</th>
                  <th style={{ width: 200 }}>Status</th>
                  <th style={{ width: 70 }}>Level</th>
                  <th>Who</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, index) => (
                  <tr key={`${entry.occurredAt}-${index}`}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDateTime(entry.occurredAt)}
                    </td>
                    <td>{entry.action.toLowerCase().replace(/_/g, ' ')}</td>
                    <td className="faint">
                      {entry.fromStatus && entry.toStatus
                        ? `${entry.fromStatus.toLowerCase().replace(/_/g, ' ')} → ${entry.toStatus.toLowerCase().replace(/_/g, ' ')}`
                        : (entry.toStatus?.toLowerCase().replace(/_/g, ' ') ?? '—')}
                    </td>
                    <td className="num">{entry.level ?? '—'}</td>
                    <td style={{ textAlign: 'left' }}>
                      {entry.user}
                      {entry.onBehalfOf ? (
                        <div className="faint">on behalf of {entry.onBehalfOf}</div>
                      ) : null}
                    </td>
                    <td className="faint" style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                      {entry.comments ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
