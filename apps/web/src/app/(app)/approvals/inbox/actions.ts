'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

export interface BellNotice {
  id: string;
  event: string;
  subject: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  document: string;
}

/** The bell: how many are unread, and the latest few. */
export async function bellSummary(): Promise<{ unread: number; latest: BellNotice[] }> {
  try {
    return await api<{ unread: number; latest: BellNotice[] }>('/workflow/inbox/summary', { redirectOnUnauthorised: false });
  } catch {
    return { unread: 0, latest: [] };
  }
}

/** Mark notices read — the ones named, or all of them. */
export async function markNoticesRead(ids?: string[]): Promise<void> {
  try {
    await api('/workflow/inbox/read', { method: 'POST', body: ids ? { ids } : {} });
  } catch {
    // Reading a notice is not worth an error on screen.
  }
  revalidatePath('/approvals/inbox');
}

export interface AttentionItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  href: string | null;
}

/** What needs attention now — the same list as Home's "Needs attention", for the bell. */
export async function attentionItems(): Promise<AttentionItem[]> {
  try {
    const me = await api<{ roles: string[] }>('/auth/me', { redirectOnUnauthorised: false });
    const { getAlerts } = await import('@/lib/alerts');
    const alerts = await getAlerts(me.roles);
    return alerts.slice(0, 6).map((a) => ({ id: a.id, severity: a.severity, title: a.title, detail: a.detail, href: a.action?.href ?? null }));
  } catch {
    return [];
  }
}
