'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface ReverseState {
  error: string | null;
  message: string | null;
}

/**
 * Raise the mirror-image reversal of a posted journal (Rule 2). The original
 * is never touched — a correction is always a new document, never an edit.
 */
export async function reverseJournal(journalId: string): Promise<ReverseState> {
  try {
    const result = await api<{ journalNumber: string }>(`/reporting/journals/${journalId}/reverse`, {
      method: 'POST',
    });
    revalidatePath('/ledger/journals');
    return { error: null, message: `Reversed as ${result.journalNumber}.` };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not reverse that journal.',
      message: null,
    };
  }
}
