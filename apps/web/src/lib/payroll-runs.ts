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
