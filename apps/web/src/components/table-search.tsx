'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconSearch } from './icons';

const QUERY_PARAM = 'q';

/**
 * A live search box beside a table, filtering the rows already on the page.
 *
 * These lists are short enough to render in full, so there is nothing to ask
 * the server for — filtering the rows already in the DOM by their own text is
 * both simpler and instant. `actions` (the button that creates a new row),
 * `filter` and the search box all sit in one row, not stacked — a page's
 * whole toolbar for one list belongs together rather than spread across
 * several lines above it.
 *
 * What's typed lives in the URL (`?q=`, debounced), not just component
 * state — the same reason `PeriodFilter` writes its own choice there. Plain
 * `useState` reset the moment you opened a row and used the browser's own
 * back button to return, which is the single most common way anyone leaves
 * one of these lists. The URL survives that, a reload, and is shareable.
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get(QUERY_PARAM) ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rows = ref.current?.querySelectorAll<HTMLElement>('tbody tr') ?? [];
    const q = query.trim().toLowerCase();
    rows.forEach((row) => {
      const text = row.textContent?.toLowerCase() ?? '';
      row.style.display = !q || text.includes(q) ? '' : 'none';
    });
  }, [query]);

  // Debounced so a fast typist rewrites the URL once, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      if (query) next.set(QUERY_PARAM, query);
      else next.delete(QUERY_PARAM);
      router.replace(`?${next.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
    // Only `query` should retrigger this — re-reading searchParams at fire
    // time (not as a dependency) is deliberate, the same way PeriodFilter
    // reads it fresh per click rather than re-running when unrelated params
    // (period, cycle) change underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
