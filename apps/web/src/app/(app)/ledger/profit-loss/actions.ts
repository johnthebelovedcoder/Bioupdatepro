'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface IncomeTaxProvision {
  periodName: string;
  ratePercent: string;
  profitBeforeTaxYtdKobo: string;
  taxDueYtdKobo: string;
  alreadyProvidedKobo: string;
  postedKobo: string;
  journalEntryId: string | null;
}

export async function previewIncomeTax(periodId: string): Promise<{ error: string | null; provision: IncomeTaxProvision | null }> {
  try {
    return { error: null, provision: await api<IncomeTaxProvision>(`/closing/period/${encodeURIComponent(periodId)}/income-tax`) };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not work out the tax.', provision: null };
  }
}

/** Provide for income tax on the year's profit to the end of the period (PCR-084). CFO only. */
export async function provideIncomeTax(periodId: string): Promise<{ error: string | null; provision: IncomeTaxProvision | null }> {
  try {
    const provision = await api<IncomeTaxProvision>(`/closing/period/${encodeURIComponent(periodId)}/income-tax`, { method: 'POST', body: {} });
    revalidatePath('/ledger/profit-loss');
    revalidatePath('/ledger/balance-sheet');
    return { error: null, provision };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not provide for the tax.', provision: null };
  }
}

export async function setIncomeTaxRate(ratePercent: number): Promise<{ error: string | null }> {
  try {
    await api('/closing/income-tax-rate', { method: 'POST', body: { ratePercent } });
    revalidatePath('/ledger/profit-loss');
    return { error: null };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not change the rate.' };
  }
}
