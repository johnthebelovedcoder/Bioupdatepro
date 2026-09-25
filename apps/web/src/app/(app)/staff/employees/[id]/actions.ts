'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface StepState {
  error: string | null;
  message: string | null;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim();

function refresh(employeeId: string) {
  revalidatePath(`/staff/employees/${employeeId}`);
  revalidatePath('/staff/employees');
}

function failed(caught: unknown, fallback: string): StepState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

const DETAIL_KEYS = [
  'title', 'firstName', 'middleName', 'surname', 'gender', 'nationality', 'stateOfOrigin', 'address', 'email', 'phone',
  'bankName', 'accountNumber', 'accountName',
  'tin', 'nhfNumber', 'pensionRsaNumber', 'pensionAdministrator', 'taxState',
  'nextOfKinName', 'nextOfKinRelationship', 'nextOfKinPhone', 'nextOfKinAddress',
];

/** Step 1 — personal, bank and statutory details. */
export async function saveDetails(_previous: StepState, formData: FormData): Promise<StepState> {
  const employeeId = text(formData, 'employeeId');
  const body: Record<string, string | boolean | null> = {};
  for (const key of DETAIL_KEYS) body[key] = text(formData, key) || null;
  body.dateOfBirth = text(formData, 'dateOfBirth') || null;
  body.pensionEnrolled = formData.get('pensionEnrolled') === 'on';
  body.nhfEnrolled = formData.get('nhfEnrolled') === 'on';
  try {
    await api(`/masters/employees/${employeeId}/details`, { method: 'POST', body });
  } catch (caught) {
    return failed(caught, 'Could not save those details.');
  }
  refresh(employeeId);
  return { error: null, message: 'Saved. A changed bank account, TIN, RSA or NHF number needs verifying again.' };
}

/** Step 2 — a job change from a date. */
export async function recordJobChange(_previous: StepState, formData: FormData): Promise<StepState> {
  const employeeId = text(formData, 'employeeId');
  const body = {
    effectiveFrom: text(formData, 'effectiveFrom'),
    employmentStatus: text(formData, 'employmentStatus'),
    employmentType: text(formData, 'employmentType'),
    departmentId: text(formData, 'departmentId') || null,
    costCentreId: text(formData, 'costCentreId') || null,
    branchId: text(formData, 'branchId') || null,
    farmId: text(formData, 'farmId') || null,
    designation: text(formData, 'designation') || null,
    grade: text(formData, 'grade') || null,
    reportingManagerId: text(formData, 'reportingManagerId') || null,
    shift: text(formData, 'shift') || null,
    reason: text(formData, 'reason'),
  };
  if (!body.effectiveFrom) return { error: 'Say when it takes effect.', message: null };
  if (!body.reason) return { error: 'Say why — promotion, transfer, confirmation, exit.', message: null };
  try {
    await api(`/masters/employees/${employeeId}/assignments`, { method: 'POST', body });
  } catch (caught) {
    return failed(caught, 'Could not record that change.');
  }
  refresh(employeeId);
  return { error: null, message: `Recorded from ${body.effectiveFrom}.` };
}

/** Step 3 — approve or reject a proposed pay change. */
export async function decidePay(employeeId: string, rowId: string, approve: boolean, reason?: string): Promise<StepState> {
  try {
    await api(`/masters/salary-changes/${rowId}/decide`, { method: 'POST', body: { approve, reason } });
  } catch (caught) {
    return failed(caught, 'Could not record that decision.');
  }
  refresh(employeeId);
  return { error: null, message: approve ? 'Approved.' : 'Rejected.' };
}

/** Step 4 — one check in the document pack. */
export async function recordCheck(_previous: StepState, formData: FormData): Promise<StepState> {
  const employeeId = text(formData, 'employeeId');
  const body = {
    checkType: text(formData, 'checkType'),
    status: text(formData, 'status'),
    reference: text(formData, 'reference') || null,
    note: text(formData, 'note') || null,
  };
  try {
    await api(`/masters/employees/${employeeId}/verifications`, { method: 'POST', body });
  } catch (caught) {
    return failed(caught, 'Could not record that check.');
  }
  refresh(employeeId);
  return { error: null, message: 'Recorded.' };
}
