'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface FileResult {
  error: string | null;
  reference?: string;
  csv?: string;
  sha256?: string;
  matchesIssued?: boolean;
}

/** Issue a bank payment file for the chosen posted transfers. */
export async function issuePaymentFile(kind: 'SUPPLIER' | 'SALARY', paymentIds: string[]): Promise<FileResult> {
  try {
    const file = await api<{ reference: string; csv: string; sha256: string }>('/banking/payment-files', {
      method: 'POST',
      body: { kind, paymentIds },
    });
    revalidatePath('/finance/payment-files');
    return { error: null, ...file };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not issue that file.' };
  }
}

/** The same file again. */
export async function downloadPaymentFile(id: string): Promise<FileResult> {
  try {
    const file = await api<{ reference: string; csv: string; sha256: string; matchesIssued: boolean }>(`/banking/payment-files/${id}/download`);
    return { error: null, ...file };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not download that file.' };
  }
}
