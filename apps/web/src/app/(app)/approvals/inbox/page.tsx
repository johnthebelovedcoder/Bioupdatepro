import { getInbox } from '@/lib/notifications';
import { formatDate } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconBell } from '@/components/icons';

export const metadata = { title: 'Notifications — BioAssetPro' };

/**
 * Every notification a workflow event has queued for the signed-in user —
 * a submission awaiting their level, an approval that moved a document on,
 * a rejection or return sent back to them. `NotificationService.queue()` has
 * written these rows all along; this is the first screen that reads them.
 *
 * Read-only, on purpose. There is no read/unread state anywhere in the
 * `WorkflowNotification` model this reads from, so nothing here invents one —
 * the same "quantity real, status computed" discipline the rest of the app
 * uses rather than fabricate a concept the data does not carry.
 */
export default async function InboxPage() {
  const notifications = await getInbox();

  return (
    <>
      <PageHeader title="Notifications" subtitle="What workflow events have sent you, newest first" />

      <Tabs />

      <Card title={`${notifications.length} notification${notifications.length === 1 ? '' : 's'}`} padded={false}>
        {notifications.length === 0 ? (
          <EmptyState
            icon={<IconBell size={22} />}
            title="Nothing yet"
            body="A submission, approval, rejection or return sends one here — to everyone who could act on it, or to the maker once somebody has."
          />
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>When</th>
                  <th style={{ width: 130 }}>Event</th>
                  <th>Notification</th>
                  <th style={{ width: 150 }}>Document</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((n) => (
                  <tr key={n.id}>
                    <td className="faint">{formatDate(n.createdAt)}</td>
                    <td>
                      <span className="badge">{describeEvent(n.event)}</span>
                    </td>
                    <td>
                      <div className="list-title">{n.subject}</div>
                      <div className="faint">{n.body}</div>
                    </td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {n.document}
                      <div className="faint">{n.documentStatus.toLowerCase().replace('_', ' ')}</div>
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

function describeEvent(event: string): string {
  const known: Record<string, string> = {
    SUBMISSION: 'submitted',
    APPROVAL: 'approved',
    REJECTION: 'rejected',
    RETURN: 'returned',
    POSTING: 'posted',
  };
  return known[event] ?? event.toLowerCase();
}
