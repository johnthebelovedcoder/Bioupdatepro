'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';

export async function signOffBioMasterChecks(formData: FormData) {
  await api('/operations/bio-master-checks/sign-off', {
    method: 'POST',
    body: {
      releaseLabel: String(formData.get('releaseLabel') ?? ''),
      exceptionsAcknowledged: String(formData.get('exceptionsAcknowledged') ?? ''),
    },
  });
  revalidatePath('/farm/bio-master-checks');
  redirect('/farm/bio-master-checks?signed=1');
}
