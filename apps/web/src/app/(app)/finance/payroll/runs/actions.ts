'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { getContext, defaultYear } from '@/lib/org';
import { parseNairaToKobo } from '@/lib/money';

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

const BUCKETS = ['SALARY', 'PAYE', 'PENSION', 'NHF', 'NSITF', 'ITF'] as const;
const METHODS = ['BANK_TRANSFER', 'CASH', 'CHEQUE'] as const;

/**
 * Pay one of a posted run's six payables — net salaries, or a remittance to
 * the tax office, the pension fund administrator, NHF, NSITF or ITF — and send
 * it for approval in the same step.
 *
 * A draft payment has nothing on it a maker would stop to review before
 * submitting, the same reasoning as create-and-calculate above. The API
 * refuses anything over what is still outstanding for that payable, so a
 * double click cannot overpay.
 */
export async function recordPayrollPayment(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const runId = String(formData.get('runId') ?? '').trim();
  const runReference = String(formData.get('runReference') ?? '').trim();
  const bucket = String(formData.get('bucket') ?? '') as (typeof BUCKETS)[number];
  if (!BUCKETS.includes(bucket)) return { error: 'Choose what is being paid.', message: null };

  const method = String(formData.get('method') ?? 'BANK_TRANSFER') as (typeof METHODS)[number];
  if (!METHODS.includes(method)) return { error: 'Choose how it was paid.', message: null };

  const bankGlAccountId = String(formData.get('bankGlAccountId') ?? '');
  if (!bankGlAccountId) return { error: 'Choose which account this is paid from.', message: null };

  const amountKobo = parseNairaToKobo(String(formData.get('amount') ?? ''));
  if (amountKobo === null || amountKobo <= 0n) {
    return { error: 'Enter how much is being paid.', message: null };
  }

  const paymentDate =
    String(formData.get('paymentDate') ?? '').trim() || new Date().toISOString().slice(0, 10);
  const reference = String(formData.get('reference') ?? '').trim();

  const context = await getContext();
  if (!context.company) return { error: 'No company is set up yet.', message: null };
  const branch = context.branches[0];
  if (!branch) return { error: 'This company has no active branch.', message: null };

  // The period the money moves in, not the one the run accrued in — a March
  // run paid on 2 April clears its payable in April.
  const year = context.financialYears.find(
    (y) => y.startDate.slice(0, 10) <= paymentDate && y.endDate.slice(0, 10) >= paymentDate,
  );
  const period = year?.periods.find(
    (p) => p.startDate.slice(0, 10) <= paymentDate && p.endDate.slice(0, 10) >= paymentDate,
  );
  if (!year || !period) {
    return { error: `No financial period covers ${paymentDate}.`, message: null };
  }

  // Unique per company. Built from the run and the moment it was raised, so
  // two remittances against the same payable never collide.
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const paymentNumber = `${runReference || 'PR'}-${bucket}-${stamp}`;

  try {
    const payment = await api<{ id: string; paymentNumber: string }>('/payroll/payments', {
      method: 'POST',
      body: {
        payrollRunId: runId,
        paymentNumber,
        bucket,
        amountKobo: amountKobo.toString(),
        paymentDate: new Date(paymentDate).toISOString(),
        method,
        bankGlAccountId,
        reference: reference || null,
        branchId: branch.id,
        currencyId: context.company.currency.id,
        financialYearId: year.id,
        financialPeriodId: period.id,
      },
    });
    await api(`/payroll/payments/${payment.id}/submit`, { method: 'POST', body: {} });
    revalidatePath(`/finance/payroll/runs/${runId}`);
    return {
      error: null,
      message: `${payment.paymentNumber} raised and sent for approval. Nothing is settled until it is approved.`,
    };
  } catch (caught) {
    return fail(caught, 'Could not record that payment.');
  }
}

export interface SalaryCostState {
  error: string | null;
  result: {
    grossKobo: string;
    monthlyPayeKobo: string;
    employeePensionKobo: string;
    nhfKobo: string;
    netPayKobo: string;
    employerPensionKobo: string;
    nsitfKobo: string;
    itfKobo: string;
    totalEmployerCostKobo: string;
    effectiveRate: string;
    ruleVersion: string;
    minimumWageExempt: boolean;
    notes: string[];
  } | null;
}

/**
 * "What would this salary cost, and what would they take home?" — the same
 * PAYE and statutory engines a run uses, asked about one hypothetical
 * employee. Records nothing.
 */
export async function calculateSalaryCost(
  _previous: SalaryCostState,
  formData: FormData,
): Promise<SalaryCostState> {
  const gross = parseNairaToKobo(String(formData.get('gross') ?? ''));
  if (gross === null || gross <= 0n) {
    return { error: 'Enter a monthly gross salary.', result: null };
  }
  const pensionable = parseNairaToKobo(String(formData.get('pensionable') ?? '')) ?? gross;
  const basic = parseNairaToKobo(String(formData.get('basic') ?? '')) ?? pensionable;
  const pensionEnrolled = formData.get('pensionEnrolled') === 'on';
  const nhfEnrolled = formData.get('nhfEnrolled') === 'on';
  const employeeCount = Math.max(1, Number(formData.get('employeeCount') ?? 1) || 1);

  try {
    const statutory = await api<{
      employeePensionKobo: string;
      employerPensionKobo: string;
      nhfKobo: string;
      nsitfKobo: string;
      itfKobo: string;
      totalEmployerCostKobo: string;
      applicability: { pensionReason: string; nhfReason: string; itfReason: string };
    }>('/payroll/statutory/calculate', {
      method: 'POST',
      body: {
        grossPayKobo: gross.toString(),
        pensionableEmolumentsKobo: pensionable.toString(),
        nhfBaseKobo: basic.toString(),
        pensionEnrolled,
        nhfEnrolled,
        employeeCount,
      },
    });

    const paye = await api<{
      monthlyPayeKobo: string;
      effectiveRate: string;
      ruleVersion: string;
      minimumWageExempt: boolean;
      explanation: string;
    }>('/payroll/paye/calculate', {
      method: 'POST',
      body: {
        monthlyTaxableGrossKobo: gross.toString(),
        pensionableEmolumentsKobo: pensionable.toString(),
        pensionEnrolled,
        nhfAnnualKobo: (BigInt(statutory.nhfKobo) * 12n).toString(),
      },
    });

    const net =
      gross -
      BigInt(paye.monthlyPayeKobo) -
      BigInt(statutory.employeePensionKobo) -
      BigInt(statutory.nhfKobo);

    return {
      error: null,
      result: {
        grossKobo: gross.toString(),
        monthlyPayeKobo: paye.monthlyPayeKobo,
        employeePensionKobo: statutory.employeePensionKobo,
        nhfKobo: statutory.nhfKobo,
        netPayKobo: net.toString(),
        employerPensionKobo: statutory.employerPensionKobo,
        nsitfKobo: statutory.nsitfKobo,
        itfKobo: statutory.itfKobo,
        // The engine's figure is what the employer bears *beyond* gross pay;
        // the cost of the role is both together.
        totalEmployerCostKobo: (gross + BigInt(statutory.totalEmployerCostKobo)).toString(),
        effectiveRate: paye.effectiveRate,
        ruleVersion: paye.ruleVersion,
        minimumWageExempt: paye.minimumWageExempt,
        notes: [
          paye.explanation,
          statutory.applicability.pensionReason,
          statutory.applicability.nhfReason,
          statutory.applicability.itfReason,
        ].filter(Boolean),
      },
    };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not calculate that salary.',
      result: null,
    };
  }
}
