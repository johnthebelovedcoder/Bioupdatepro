'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { parseNairaToKobo } from '@/lib/money';

export interface FlowState {
  error: string | null;
  message: string | null;
}

function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

/** Generate one year of VAT or WHT filing periods from the company's cadence. */
export async function generateTaxPeriods(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const taxType = String(formData.get('taxType') ?? '');
  if (taxType !== 'VAT' && taxType !== 'WHT') {
    return { error: 'Choose VAT or WHT.', message: null };
  }
  const year = Number(formData.get('year') ?? 0);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: 'Enter a four-digit year.', message: null };
  }

  try {
    const result = await api<{ created: number }>('/tax/periods/generate', {
      method: 'POST',
      body: { taxType, year },
    });
    revalidatePath('/ledger/tax');
    return {
      error: null,
      message:
        result.created === 0
          ? `Every ${taxType} period for ${year} already existed — nothing new was created.`
          : `Created ${result.created} ${taxType} period${result.created === 1 ? '' : 's'} for ${year}.`,
    };
  } catch (caught) {
    return fail(caught, 'Could not generate those periods.');
  }
}

/**
 * Close a tax period. The API refuses unless the register agrees with the
 * ledger to the kobo, and that refusal names every disagreeing account — so it
 * is passed through verbatim.
 */
export async function closeTaxPeriod(taxPeriodId: string): Promise<FlowState> {
  try {
    await api(`/tax/periods/${taxPeriodId}/close`, { method: 'POST', body: {} });
  } catch (caught) {
    return fail(caught, 'Could not close this period.');
  }
  revalidatePath('/ledger/tax');
  revalidatePath(`/ledger/tax/${taxPeriodId}`);
  return { error: null, message: 'Closed.' };
}

/** Record that a closed period's return was filed with the authority. Terminal. */
export async function fileTaxPeriod(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const taxPeriodId = String(formData.get('taxPeriodId') ?? '');
  const filingReference = String(formData.get('filingReference') ?? '').trim();
  if (!filingReference) {
    return {
      error: 'Enter the reference the tax authority gave for this return.',
      message: null,
    };
  }

  try {
    await api(`/tax/periods/${taxPeriodId}/file`, {
      method: 'POST',
      body: { filingReference },
    });
  } catch (caught) {
    return fail(caught, 'Could not record this filing.');
  }
  revalidatePath('/ledger/tax');
  revalidatePath(`/ledger/tax/${taxPeriodId}`);
  return { error: null, message: `Recorded as filed, reference ${filingReference}.` };
}

export interface CalculationState {
  error: string | null;
  result: {
    kind: 'VAT' | 'WHT';
    taxCode: string;
    appliedRate: string;
    taxableBaseKobo: string;
    taxKobo: string;
    /** Gross for VAT; the net payable to the supplier for WHT. */
    totalKobo: string;
    explanation: string;
  } | null;
}

/**
 * Work out the tax on one amount, exactly as a posting would — same codes,
 * same rates, same rounding — without posting anything.
 */
export async function calculateTax(
  _previous: CalculationState,
  formData: FormData,
): Promise<CalculationState> {
  const kind = String(formData.get('kind') ?? '');
  const taxCode = String(formData.get('taxCode') ?? '');
  const amountKobo = parseNairaToKobo(String(formData.get('amount') ?? ''));
  const on = String(formData.get('on') ?? '').trim();

  if (!taxCode) return { error: 'Choose a tax code.', result: null };
  if (amountKobo === null || amountKobo <= 0n) {
    return { error: 'Enter an amount in naira.', result: null };
  }

  try {
    if (kind === 'WHT') {
      const vatKobo = parseNairaToKobo(String(formData.get('vatAmount') ?? ''));
      const result = await api<{
        taxCode: string;
        appliedRate: string;
        taxableBaseKobo: string;
        taxKobo: string;
        netPayableKobo: string;
        explanation: string;
      }>('/tax/wht/calculate', {
        method: 'POST',
        body: {
          taxCode,
          amountKobo: amountKobo.toString(),
          ...(vatKobo !== null ? { vatAmountKobo: vatKobo.toString() } : {}),
          ...(on ? { on } : {}),
        },
      });
      return {
        error: null,
        result: {
          kind: 'WHT',
          taxCode: result.taxCode,
          appliedRate: result.appliedRate,
          taxableBaseKobo: result.taxableBaseKobo,
          taxKobo: result.taxKobo,
          totalKobo: result.netPayableKobo,
          explanation: result.explanation,
        },
      };
    }

    const result = await api<{
      taxCode: string;
      appliedRate: string;
      taxableBaseKobo: string;
      taxKobo: string;
      grossKobo: string;
      explanation: string;
    }>('/tax/vat/calculate', {
      method: 'POST',
      body: { taxCode, amountKobo: amountKobo.toString(), ...(on ? { on } : {}) },
    });
    return {
      error: null,
      result: {
        kind: 'VAT',
        taxCode: result.taxCode,
        appliedRate: result.appliedRate,
        taxableBaseKobo: result.taxableBaseKobo,
        taxKobo: result.taxKobo,
        totalKobo: result.grossKobo,
        explanation: result.explanation,
      },
    };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not calculate that.',
      result: null,
    };
  }
}
