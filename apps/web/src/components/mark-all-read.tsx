'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markNoticesRead } from '@/app/(app)/approvals/inbox/actions';

export function MarkAllRead() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markNoticesRead();
          router.refresh();
        })
      }
    >
      {pending ? 'Marking…' : 'Mark all read'}
    </button>
  );
}
