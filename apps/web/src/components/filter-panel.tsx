'use client';

import { useState } from 'react';
import { Sheet } from './sheet';

/**
 * A filter panel behind a button, not open above the list by default.
 *
 * Five fields sitting open at the top of the page pushed whatever they filter
 * below the fold on a phone — the list is what the page is for, the filters
 * are how you narrow it. This only owns the open/closed state; the fields
 * inside keep whatever URL-writing behaviour they already had (some apply as
 * soon as a select changes, some wait for their own Apply button), so wrapping
 * an existing filter form in this is a visibility change, not a behaviour one.
 */
export function FilterPanel({
  title = 'Filters',
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <FilterIcon />
        {title}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {children}
      </Sheet>
    </>
  );
}

function FilterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
    </svg>
  );
}
