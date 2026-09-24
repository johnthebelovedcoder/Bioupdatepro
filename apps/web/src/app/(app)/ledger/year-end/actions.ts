'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

/**
 * Close a financial year: sweep revenue and expense into retained earnings,
 * record closing balances, and — unless told not to — open the next year with
 * the balance-sheet balances carried in.
 *
 * Posts immediately. The API re-runs every blocking check first, so a stale
 * screen cannot close a year that has since stopped qualifying.
 */
export async function closeFinancialYear(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const financialYearId = String(formData.get('financialYearId') ?? '');
  const yearCode = String(formData.get('yearCode') ?? '');
  const confirm = String(formData.get('confirm') ?? '').trim();
  if (!financialYearId) return { error: 'Choose a year.', message: null };
  if (confirm !== yearCode) {
    return {
      error: `Type ${yearCode} to confirm. Closing a year cannot be undone from this screen.`,
      message: null,
    };
  }

  const rollForward = formData.get('rollForward') === 'on';
  const nextYearCode = String(formData.get('nextYearCode') ?? '').trim();
  const retainedEarningsGlAccountId = String(formData.get('retainedEarningsGlAccountId') ?? '');

  try {
    const result = await api<{
      yearCode: string;
      retainedEarningsKobo: string;
      balancesCarried: number;
      nextYearCode: string | null;
    }>('/year-end/close', {
      method: 'POST',
      body: {
        financialYearId,
        rollForward,
        ...(nextYearCode ? { nextYearCode } : {}),
        ...(retainedEarningsGlAccountId ? { retainedEarningsGlAccountId } : {}),
      },
    });
    revalidatePath('/ledger/year-end');
    revalidatePath('/ledger/period-close');
    return {
      error: null,
      message:
        `${result.yearCode} closed.` +
        (result.nextYearCode
          ? ` ${result.balancesCarried} balance${result.balancesCarried === 1 ? '' : 's'} carried into ${result.nextYearCode}.`
          : ''),
    };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not close this year.',
      message: null,
    };
  }
}
