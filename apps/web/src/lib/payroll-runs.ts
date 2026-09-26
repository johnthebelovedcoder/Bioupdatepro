import 'server-only';
import { api } from './api';

export interface PayrollRunRow {
  id: string;
  reference: string;
  year: number;
  month: number;
  status: string;
  employeeCount: number;
  totalGrossKobo: string;
  totalNetPayKobo: string;
  calculatedAt: string | null;
  postedAt: string | null;
  pendingTransactionId: string | null;
}

export async function getPayrollRuns(): Promise<PayrollRunRow[]> {
  try {
    return await api<PayrollRunRow[]>('/payroll/runs');
  } catch {
    return [];
  }
}

/* --- One run, in detail ------------------------------------------------- */

export interface PayrollValidation {
  ready: boolean;
  eligible: number;
  blocked: Array<{ employeeNumber: string; blockers: string[] }>;
}

export interface PayeByState {
  taxState: string;
  employeeCount: number;
  monthlyPayeKobo: string;
  annualPayeKobo: string;
}

export interface BankScheduleLine {
  employeeId: string;
  employeeNumber: string;
  name: string;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  netPayKobo: string;
}

export type PayrollBucket = 'SALARY' | 'PAYE' | 'PENSION' | 'NHF' | 'NSITF' | 'ITF';

export interface OutstandingBucket {
  bucket: PayrollBucket;
  label: string;
  totalKobo: string;
  settledKobo: string;
  outstandingKobo: string;
}

export interface Payslip {
  run: string;
  payrollDate: string;
  ruleVersion: string | null;
  employeeNumber: string;
  name: string;
  grossKobo: string;
  /** Pay not earned for unpaid leave this month, already out of gross. */
  leaveDeductionKobo?: string;
  payeKobo: string;
  employeePensionKobo: string;
  nhfKobo: string;
  netPayKobo: string;
  employerPensionKobo: string;
  nsitfKobo: string;
  itfKobo: string;
  minimumWageExempt: boolean;
  calculation: unknown;
}

export interface PayeBand {
  bandOrder: number;
  lowerLimitKobo: string;
  upperLimitKobo: string | null;
  rate: string;
  effectiveFrom: string;
  sourceReference: string | null;
}

/** Null when the run cannot be read — the caller renders its own not-found. */
async function maybe<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch {
    return null;
  }
}

export function validatePayrollRun(runId: string) {
  return maybe<PayrollValidation>(`/payroll/runs/${runId}/validate`);
}

export async function getPayeByState(runId: string): Promise<PayeByState[]> {
  return (await maybe<PayeByState[]>(`/payroll/runs/${runId}/paye-by-state`)) ?? [];
}

export async function getBankSchedule(runId: string): Promise<BankScheduleLine[]> {
  return (await maybe<BankScheduleLine[]>(`/payroll/runs/${runId}/bank-schedule`)) ?? [];
}

export async function getOutstanding(runId: string): Promise<OutstandingBucket[]> {
  return (await maybe<OutstandingBucket[]>(`/payroll/runs/${runId}/outstanding`)) ?? [];
}

export function getPayslip(runId: string, employeeId: string) {
  return maybe<Payslip>(`/payroll/runs/${runId}/payslip/${employeeId}`);
}

export async function getPayeBands(): Promise<PayeBand[]> {
  return (await maybe<PayeBand[]>('/payroll/paye/bands')) ?? [];
}
