'use client';

import { useEffect, useRef, useState } from 'react';
import { IconSearch } from './icons';

/**
 * A live search box beside a table, filtering the rows already on the page.
 *
 * These lists are short enough to render in full, so there is nothing to ask
 * the server for — filtering the rows already in the DOM by their own text is
 * both simpler and instant. `actions` (the button that creates a new row),
 * `filter` and the search box all sit in one row, not stacked — a page's
 * whole toolbar for one list belongs together rather than spread across
 * several lines above it.
 */
export function TableSearch({
  placeholder = 'Search this list',
  actions,
  filter,
  children,
}: {
  placeholder?: string;
  actions?: React.ReactNode;
  filter?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rows = ref.current?.querySelectorAll<HTMLElement>('tbody tr') ?? [];
    const q = query.trim().toLowerCase();
    rows.forEach((row) => {
      const text = row.textContent?.toLowerCase() ?? '';
      row.style.display = !q || text.includes(q) ? '' : 'none';
    });
  }, [query]);

  return (
    <>
      <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        {actions}
        {filter}
        <label className="table-search">
          <IconSearch size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
          />
        </label>
      </div>
      <div ref={ref}>{children}</div>
    </>
  );
}
