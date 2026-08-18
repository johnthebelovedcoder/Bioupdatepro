'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function Pagination({
  page,
  pageCount,
  total,
  noun,
}: {
  page: number;
  pageCount: number;
  total: number;
  noun: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(to: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('page', String(to));
    router.push(`?${next.toString()}`);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 18px',
        borderTop: '1px solid var(--border)',
      }}
    >
      <span className="faint">
        {total.toLocaleString('en-NG')} {noun}
        {total === 1 ? '' : 's'} · page {page} of {pageCount}
      </span>
      <div className="row">
        <button className="btn" disabled={page <= 1} onClick={() => go(page - 1)}>
          Previous
        </button>
        <button className="btn" disabled={page >= pageCount} onClick={() => go(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
