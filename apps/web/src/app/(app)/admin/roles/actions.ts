'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

/**
 * One cell of the matrix, toggled. The API re-checks the actor's own role
 * (`CFO`, `FARM_MANAGER`, `SYSTEM_ADMIN`) independently — this does not, so a
 * viewer without write access sees a refusal from the API rather than a
 * silent no-op, which is the same shape every other action on this page uses.
 */
export async function setRoleSectionAccess(
  role: string,
  section: string,
  enabled: boolean,
): Promise<void> {
  await api('/auth/role-sections', { method: 'POST', body: { role, section, enabled } });
  revalidatePath('/admin/roles');
}
