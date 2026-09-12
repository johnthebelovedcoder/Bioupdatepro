'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { getContext, defaultYear } from '@/lib/org';

export interface FlowState {
  error: string | null;
  message: string | null;
}

function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

/**
 * Create a run for one financial period and calculate it in the same step —
 * an empty, uncalculated run has nothing a maker would look at before
 * submitting, so there is no real intermediate state worth exposing here.
 */
export async function createPayrollRun(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const financialPeriodId = String(formData.get('financialPeriodId') ?? '').trim();
  if (!financialPeriodId) return { error: 'Choose a period.', message: null };

  const context = await getContext();
  if (!context.company) return { error: 'No company is set up yet.', message: null };
  const branch = context.branches[0];
  if (!branch) return { error: 'This company has no active branch.', message: null };

  const year = defaultYear(context);
  const period = year?.periods.find((p) => p.id === financialPeriodId);
  if (!year || !period) return { error: 'That period could not be found.', message: null };

  const periodStart = new Date(period.startDate);

  try {
    const run = await api<{ id: string; reference: string }>('/payroll/runs', {
      method: 'POST',
      body: {
        companyId: context.company.id,
        year: periodStart.getUTCFullYear(),
        month: periodStart.getUTCMonth() + 1,
        branchId: branch.id,
        financialYearId: year.id,
        financialPeriodId: period.id,
        currencyId: context.company.currency.id,
      },
    });

    await api(`/payroll/runs/${run.id}/calculate`, { method: 'POST', body: {} });

    revalidatePath('/finance/payroll/runs');
    return { error: null, message: `${run.reference} created and calculated.` };
  } catch (caught) {
    return fail(caught, 'Could not create that payroll run.');
  }
}

/** Send a calculated run for approval — the same maker-checker ladder every other document here uses. */
export async function submitPayrollRun(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const runId = String(formData.get('runId') ?? '').trim();
  if (!runId) return { error: 'No run selected.', message: null };

  try {
    await api(`/payroll/runs/${runId}/submit`, { method: 'POST', body: {} });
  } catch (caught) {
    return fail(caught, 'Could not submit that run for approval.');
  }

  revalidatePath('/finance/payroll/runs');
  return { error: null, message: 'Submitted for approval.' };
}
