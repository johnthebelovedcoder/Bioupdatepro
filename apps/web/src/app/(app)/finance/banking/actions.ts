'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

export async function createBankAccount(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const body = {
    glAccountId: String(formData.get('glAccountId') ?? ''),
    name: String(formData.get('name') ?? '').trim(),
    bankName: String(formData.get('bankName') ?? '').trim(),
    accountNumber: String(formData.get('accountNumber') ?? '').trim(),
  };
  if (!body.glAccountId) return { error: 'Choose the ledger account it sits on.', message: null };
  try {
    await api('/banking/accounts', { method: 'POST', body });
  } catch (caught) {
    return fail(caught, 'Could not add that bank account.');
  }
  revalidatePath('/finance/banking');
  return { error: null, message: `${body.name} added.` };
}

/**
 * Import a statement. The file is read in the browser and sent as text; the
 * API checks the lines add up to the balances before keeping any of it.
 */
export async function importStatement(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const bankAccountId = String(formData.get('bankAccountId') ?? '');
  const file = formData.get('file');
  const pasted = String(formData.get('csv') ?? '');
  const csv = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (!csv.trim()) return { error: 'Choose the statement file, or paste its contents.', message: null };
  if (csv.length > 2_000_000) return { error: 'That file is too large for one statement.', message: null };

  try {
    const result = await api<{ lines: number; autoMatched: number }>(
      `/banking/accounts/${bankAccountId}/statements`,
      {
        method: 'POST',
        body: {
          csv,
          openingBalance: String(formData.get('openingBalance') ?? ''),
          closingBalance: String(formData.get('closingBalance') ?? ''),
          fileName: file instanceof File ? file.name : null,
        },
      },
    );
    revalidatePath(`/finance/banking/${bankAccountId}`);
    revalidatePath('/finance/banking');
    return {
      error: null,
      message: `Imported ${result.lines} lines; ${result.autoMatched} matched to the ledger automatically.`,
    };
  } catch (caught) {
    return fail(caught, 'Could not import that statement.');
  }
}

export async function autoMatch(bankAccountId: string): Promise<FlowState> {
  try {
    const result = await api<{ matched: number }>(`/banking/accounts/${bankAccountId}/auto-match`, {
      method: 'POST',
      body: {},
    });
    revalidatePath(`/finance/banking/${bankAccountId}`);
    return { error: null, message: `${result.matched} more matched.` };
  } catch (caught) {
    return fail(caught, 'Could not match.');
  }
}

export async function matchLine(bankAccountId: string, lineId: string, journalLineId: string): Promise<FlowState> {
  try {
    await api(`/banking/lines/${lineId}/match`, { method: 'POST', body: { journalLineId } });
  } catch (caught) {
    return fail(caught, 'Could not match that line.');
  }
  revalidatePath(`/finance/banking/${bankAccountId}`);
  return { error: null, message: 'Matched.' };
}

export async function ignoreLine(bankAccountId: string, lineId: string, reason: string): Promise<FlowState> {
  try {
    await api(`/banking/lines/${lineId}/ignore`, { method: 'POST', body: { reason } });
  } catch (caught) {
    return fail(caught, 'Could not set that line aside.');
  }
  revalidatePath(`/finance/banking/${bankAccountId}`);
  return { error: null, message: 'Set aside.' };
}

export async function unsettleLine(bankAccountId: string, lineId: string): Promise<FlowState> {
  try {
    await api(`/banking/lines/${lineId}/unsettle`, { method: 'POST', body: {} });
  } catch (caught) {
    return fail(caught, 'Could not undo that.');
  }
  revalidatePath(`/finance/banking/${bankAccountId}`);
  return { error: null, message: 'Undone.' };
}
