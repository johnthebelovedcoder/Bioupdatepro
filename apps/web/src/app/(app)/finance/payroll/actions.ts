'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface ActivatePayrollState {
  error: string | null;
  message: string | null;
}

/**
 * Turn payroll on — one confirm, not a rates form. See
 * `payroll-setup.service.ts` on the API side for why: PAYE bands and the
 * pension/NHF/NSITF/ITF rates are statutory figures, already verified
 * against the client's workbook, not something a screen should let anyone
 * retype. `nhfCompanyParticipation` is the one real decision here — NHF is
 * opt-in for the private sector.
 */
export async function activatePayroll(
  _previous: ActivatePayrollState,
  formData: FormData,
): Promise<ActivatePayrollState> {
  const nhfCompanyParticipation = formData.get('nhfCompanyParticipation') === 'on';

  try {
    await api('/payroll/setup', {
      method: 'POST',
      body: { nhfCompanyParticipation },
    });
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not activate payroll.',
      message: null,
    };
  }

  revalidatePath('/finance/payroll');
  return { error: null, message: 'Payroll is active — NTA-2025-2026.01 rates are now in force.' };
}
