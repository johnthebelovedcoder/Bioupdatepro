'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { parseNairaToKobo } from '@/lib/money';

export interface BudgetState {
  error: string | null;
  message: string | null;
}

/** INT-002: set a cost centre's purchase budget for a year. */
export async function setBudget(_previous: BudgetState, formData: FormData): Promise<BudgetState> {
  const value = (key: string) => String(formData.get(key) ?? '').trim();
  const amount = parseNairaToKobo(value('amount'));
  if (!value('costCentreId')) return { error: 'Choose the cost centre.', message: null };
  if (amount === null || amount < 0n) return { error: 'Enter the budget in naira.', message: null };
  try {
    await api('/procurement/budgets', {
      method: 'POST',
      body: { financialYearId: value('financialYearId'), costCentreId: value('costCentreId'), amountKobo: amount.toString(), note: value('note') || undefined },
    });
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not set that budget.', message: null };
  }
  revalidatePath('/procurement/budgets');
  return { error: null, message: 'Budget set.' };
}
