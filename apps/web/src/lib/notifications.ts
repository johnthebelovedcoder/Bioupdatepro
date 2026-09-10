import 'server-only';
import { api } from './api';

/** One in-app notification — the row itself is the delivery, per NotificationService's own doc comment. */
export interface InboxNotification {
  id: string;
  event: string;
  subject: string;
  body: string;
  createdAt: string;
  document: string;
  documentStatus: string;
}

/** The signed-in user's own notifications. The API scopes it to them. */
export async function getInbox(): Promise<InboxNotification[]> {
  try {
    return await api<InboxNotification[]>('/workflow/inbox');
  } catch {
    return [];
  }
}
