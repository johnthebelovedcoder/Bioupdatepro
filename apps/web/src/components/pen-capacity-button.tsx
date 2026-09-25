'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPenCapacity } from '@/app/(app)/pens/actions';

/** Change how many animals a pen holds. It cannot go below what is in it now — the API says so. */
export function PenCapacityButton({ penId, name, capacity }: { penId: string; name: string; capacity: number | null }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      disabled={pending}
      onClick={() => {
        const answer = window.prompt(`How many animals does ${name} hold? Leave blank for no limit.`, capacity ? String(capacity) : '');
        if (answer === null) return;
        const value = answer.trim() === '' ? null : Number(answer.trim());
        if (value !== null && (!Number.isInteger(value) || value < 1)) {
          window.alert('Capacity is a whole number of animals, or blank for no limit.');
          return;
        }
        startTransition(async () => {
          const outcome = await setPenCapacity(penId, value);
          if (outcome.error) window.alert(outcome.error);
          else router.refresh();
        });
      }}
    >
      {pending ? '…' : 'Change'}
    </button>
  );
}
