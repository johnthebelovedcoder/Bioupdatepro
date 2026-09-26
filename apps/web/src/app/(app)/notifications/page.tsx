import { api } from '@/lib/api';
import type { SessionUser } from '@/lib/session';
import { Card, PageHeader } from '@/components/ui';
import { NotificationPolicyForm, WhatsAppSettings, type MyNotifications } from '@/components/notification-forms';

export const metadata = { title: 'My notifications — BioAssetPro' };

interface Policy {
  events: string[];
  emailEvents: string[];
  whatsappEvents: string[];
  whatsappAvailable: boolean;
}

/**
 * External notifications (AC-015): each person's WhatsApp number, verified by
 * a code, and their consent; and the events the farm sends by email and by
 * WhatsApp. Nothing goes to an unverified number, without consent, or for an
 * event that is not approved — a blocked message is recorded, not sent.
 */
export default async function NotificationsPage() {
  const [mine, policy, me] = await Promise.all([
    api<MyNotifications>('/notifications/mine'),
    api<Policy>('/notifications/policy'),
    api<SessionUser>('/auth/me'),
  ]);
  const canEdit = me.roles.some((r) => r === 'ADMINISTRATOR' || r === 'CFO');

  return (
    <>
      <PageHeader title="My notifications" subtitle="How you hear about approvals: in the app, by email, and on WhatsApp if you choose" />
      <div className="stack">
        <Card title="WhatsApp" subtitle="Only to a number you have verified, and only while you agree">
          <WhatsAppSettings mine={mine} />
        </Card>
        <Card title="What goes out, and how" subtitle="Everything also appears in the app. These are the events the farm sends outside it.">
          <NotificationPolicyForm events={policy.events} emailEvents={policy.emailEvents} whatsappEvents={policy.whatsappEvents} canEdit={canEdit} />
        </Card>
      </div>
    </>
  );
}
