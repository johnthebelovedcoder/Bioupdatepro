import 'server-only';
import { api } from './api';

/**
 * Whether payroll has been switched on for this company — §7.2.
 *
 * The statutory engine refuses to calculate anything without a
 * `StatutoryConfiguration` row rather than assume rates, which is correct,
 * but left no way for a company signed up through the real onboarding flow
 * to ever get one: only `seed.ts`'s dev fixtures created it by hand.
 */
export interface PayrollSetupStatus {
  active: boolean;
  payeBandCount: number;
  ruleVersion: string | null;
  nhfCompanyParticipation: boolean | null;
  effectiveFrom: string | null;
}

export async function getPayrollSetupStatus(): Promise<PayrollSetupStatus> {
  return api<PayrollSetupStatus>('/payroll/setup');
}
