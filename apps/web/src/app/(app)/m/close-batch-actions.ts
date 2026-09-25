'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface CloseState {
  error: string | null;
  message: string | null;
}

/** Close a batch; with animals still recorded, write them off as a final loss first. */
export async function closeBatch(_previous: CloseState, formData: FormData): Promise<CloseState> {
  const code = String(formData.get('code') ?? '');
  const closedOn = String(formData.get('closedOn') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const writeOffRemaining = formData.get('writeOffRemaining') === 'on';
  if (!reason) return { error: 'Say why the batch is closing.', message: null };
  if (!closedOn) return { error: 'Choose the day it closes.', message: null };

  try {
    const result = await api<{ code: string; writtenOff: number; lossPosted: boolean; note?: string }>(
      `/operations/groups/${encodeURIComponent(code)}/close`,
      { method: 'POST', body: { closedOn, reason, writeOffRemaining } },
    );
    revalidatePath('/', 'layout');
    return {
      error: null,
      message:
        result.writtenOff > 0
          ? `Closed. ${result.writtenOff} animal${result.writtenOff === 1 ? ' was' : 's were'} written off as a loss${result.note ? ` (${result.note})` : ''}.`
          : 'Closed.',
    };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not close the batch.', message: null };
  }
}
