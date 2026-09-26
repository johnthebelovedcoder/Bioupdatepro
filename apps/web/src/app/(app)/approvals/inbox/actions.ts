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
