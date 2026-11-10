'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface PostingGroupActionState {
  error: string | null;
  message: string | null;
}

export async function assignPostingGroup(_previous: PostingGroupActionState, formData: FormData): Promise<PostingGroupActionState> {
  const [application, postingGroup, masterType] = String(formData.get('group') ?? '').split('|');
  const masterId = String(formData.get('masterId') ?? '').trim();
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  const effectiveTo = String(formData.get('effectiveTo') ?? '').trim();
  if (!application || !postingGroup || !masterType || !masterId || !effectiveFrom) {
    return { error: 'Choose a workbook group, enter its master record ID or key, and set a start date.', message: null };
  }
  try {
    await api('/posting-control/group-assignments', {
      method: 'POST',
      body: { application, postingGroup, masterType, masterId, effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}) },
    });
    revalidatePath('/admin/posting-groups');
    return { error: null, message: `${postingGroup} assigned to ${masterType} ${masterId}.` };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not assign that posting group.', message: null };
  }
}

export async function endPostingGroupAssignment(_previous: PostingGroupActionState, formData: FormData): Promise<PostingGroupActionState> {
  const id = String(formData.get('assignmentId') ?? '').trim();
  const effectiveTo = String(formData.get('effectiveTo') ?? '').trim();
  if (!id || !effectiveTo) return { error: 'Choose an end date.', message: null };
  try {
    await api(`/posting-control/group-assignments/${id}/end`, { method: 'POST', body: { effectiveTo } });
    revalidatePath('/admin/posting-groups');
    return { error: null, message: 'Assignment end date saved.' };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not end that posting group assignment.', message: null };
  }
}
