'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import type { MasterState } from '../../admin/actions';

function fail(caught: unknown, fallback: string, values: Record<string, string>): MasterState {
  return {
    error: caught instanceof ApiError ? caught.message : fallback,
    created: null,
    values,
  };
}

/**
 * Create an employee, and — when a basic pay figure is given — assign it as
 * their salary in the same step.
 *
 * Payroll can only run against someone who is Active-for-payroll (§7), which
 * itself requires a branch, a cost centre, bank details, a tax state, and at
 * least one salary component already in force. Asking for all of it in one
 * form beats a person clicking "Add employee" and then discovering, one
 * blocker at a time, that payroll still refuses them — the same way `MasterForm`
 * already asks an item for its GL account up front rather than after the fact.
 */
export async function createEmployee(
  _previous: MasterState,
  formData: FormData,
): Promise<MasterState> {
  const value = (key: string) => String(formData.get(key) ?? '').trim();

  const employeeNumber = value('employeeNumber').toUpperCase();
  const firstName = value('firstName');
  const surname = value('surname');
  const employmentDate = value('employmentDate');
  const branchId = value('branchId');
  const costCentreId = value('costCentreId');

  const kept = {
    employeeNumber,
    firstName,
    surname,
    employmentDate,
    branchId,
    costCentreId,
    designation: value('designation'),
    bankName: value('bankName'),
    accountNumber: value('accountNumber'),
    accountName: value('accountName'),
    taxState: value('taxState'),
    tin: value('tin'),
    pensionRsaNumber: value('pensionRsaNumber'),
    pensionAdministrator: value('pensionAdministrator'),
    nhfNumber: value('nhfNumber'),
    basicPay: value('basicPay'),
  };

  if (!employeeNumber) return { error: 'Give the employee a number.', created: null, values: kept };
  if (!firstName || !surname) {
    return { error: "Enter the employee's first name and surname.", created: null, values: kept };
  }
  if (!employmentDate) return { error: 'Give the date they started.', created: null, values: kept };
  if (!branchId) return { error: 'Choose which branch they work from.', created: null, values: kept };
  if (!costCentreId) {
    return {
      error: 'Choose a cost centre — payroll will not post without one.',
      created: null,
      values: kept,
    };
  }
  if (!kept.bankName || !kept.accountNumber) {
    return { error: 'Bank details are required — payroll cannot pay without them.', created: null, values: kept };
  }
  if (!kept.taxState) {
    return { error: 'Choose a tax state — PAYE is remitted per state of residence.', created: null, values: kept };
  }

  const pensionEnrolled = formData.get('pensionEnrolled') === 'on';
  const nhfEnrolled = formData.get('nhfEnrolled') === 'on';
  if (pensionEnrolled && !kept.pensionRsaNumber) {
    return { error: 'Enrolled in pension needs an RSA number.', created: null, values: kept };
  }
  if (nhfEnrolled && !kept.nhfNumber) {
    return { error: 'Enrolled in NHF needs an NHF number.', created: null, values: kept };
  }

  const basicPayKobo = kept.basicPay ? Math.round(Number(kept.basicPay) * 100) : null;
  if (kept.basicPay && !Number.isFinite(basicPayKobo)) {
    return { error: 'That basic pay is not a number I can read.', created: null, values: kept };
  }

  let employeeId: string;
  try {
    const employee = await api<{ id: string }>('/masters/employees', {
      method: 'POST',
      body: {
        employeeNumber,
        firstName,
        surname,
        employmentDate,
        branchId,
        costCentreId,
        designation: kept.designation || null,
        bankName: kept.bankName,
        accountNumber: kept.accountNumber,
        accountName: kept.accountName || null,
        taxState: kept.taxState,
        tin: kept.tin || null,
        pensionEnrolled,
        pensionRsaNumber: kept.pensionRsaNumber || null,
        pensionAdministrator: kept.pensionAdministrator || null,
        nhfEnrolled,
        nhfNumber: kept.nhfNumber || null,
      },
    });
    employeeId = employee.id;
  } catch (caught) {
    return fail(caught, 'Could not save that employee.', kept);
  }

  if (basicPayKobo !== null && basicPayKobo > 0) {
    try {
      await api(`/masters/employees/${employeeId}/salary-component`, {
        method: 'POST',
        body: {
          componentCode: 'BASIC',
          amountKobo: String(basicPayKobo),
          effectiveFrom: employmentDate,
        },
      });
    } catch (caught) {
      // The employee record stands either way — only the pay assignment
      // failed, and retrying that shouldn't mean re-entering everything else.
      revalidatePath('/staff/employees');
      return fail(
        caught,
        `${firstName} ${surname} was saved as ${employeeNumber}, but setting basic pay failed. ` +
          `Activate for payroll once pay is set.`,
        {},
      );
    }
  }

  revalidatePath('/staff/employees');
  return { error: null, created: `${firstName} ${surname}` };
}

export interface FlowState {
  error: string | null;
  message: string | null;
}

/** Turn on payroll for an employee who already clears every §7 blocker. */
export async function activateEmployeePayroll(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const employeeId = String(formData.get('employeeId') ?? '');
  if (!employeeId) return { error: 'No employee was named.', message: null };

  try {
    await api(`/masters/employees/${employeeId}/activate-payroll`, {
      method: 'POST',
      body: {},
    });
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not activate payroll for them.',
      message: null,
    };
  }

  revalidatePath('/staff/employees');
  return { error: null, message: 'Activated for payroll.' };
}
