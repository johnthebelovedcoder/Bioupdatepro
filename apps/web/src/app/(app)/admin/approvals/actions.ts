'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

/** Turn self-approval on or off. CFO or administrator only; the API refuses anyone else. */
export async function setSelfApproval(formData: FormData): Promise<void> {
  const allow = String(formData.get('allow') ?? '') === 'true';
  try {
    await api('/workflow/settings/self-approval', { method: 'POST', body: { allow } });
  } catch (caught) {
    const message = caught instanceof ApiError ? caught.message : 'Could not change the setting.';
    redirect(`/admin/approvals?error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/admin/approvals');
  revalidatePath('/approvals');
}
