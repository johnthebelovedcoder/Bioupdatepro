'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

/**
 * Set a GL account's FS category (US-897-002) — where it sits within a
 * statement, not just its accountType. One field, one immediate save: this
 * is a classification utility, not a multi-step form.
 */
export async function classifyAccount(formData: FormData): Promise<void> {
  const accountId = String(formData.get('accountId') ?? '');
  const fsCategory = String(formData.get('fsCategory') ?? '');
  if (!accountId || !fsCategory) return;

  await api(`/masters/gl-accounts/${accountId}/classify`, {
    method: 'POST',
    body: { fsCategory },
  });

  revalidatePath('/admin/accounts');
}
