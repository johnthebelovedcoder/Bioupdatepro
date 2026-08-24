'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { allEntries } from '@/lib/navigation';
import { canSee } from '@/lib/permissions';
import { IconSearch } from './icons';

/**
 * One box for finding anything.
 *
 * A menu answers "where do I go to do a thing". It cannot answer the question
 * people in this kind of application actually ask, which is "where is
 * PO-20260821-478615" — that is a record, and no arrangement of menus reaches
 * it. Both halves are here: screens resolve instantly from the navigation tree
 * in memory, and records come from the API as you type.
 *
 * Screens appear first and without waiting, because the most common use of a
 * box like this is as a faster menu. Records arrive a moment later and push in
 * below them, so the list never goes blank while a request is in flight —
 * results that vanish and reappear on every keystroke are the thing that makes
 * these feel broken.
 */

interface Hit {
  type: string;
  title: string;
  subtitle: string | null;
  href: string;
  rank: number;
}

export function SearchPalette({ roles = [] }: { roles?: readonly string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Ctrl-K / Cmd-K anywhere, Escape to leave. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((was) => !was);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery('');
      setRecords([]);
      setCursor(0);
    }
  }, [open]);

  /*
   * Screens, matched in memory against everything the role can reach.
   *
   * Filtered by permission for the same reason the sidebar is: offering a
   * destination that answers with "ask an administrator" is worse than not
   * offering it.
   */
  const screens = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 1) return [];
    return allEntries()
      .filter((entry) => canSee(roles, entry.section.section))
      .map((entry) => {
        const haystack = [
          entry.label,
          entry.section.label,
          entry.hint ?? '',
          ...(entry.keywords ?? []),
        ]
          .join(' ')
          .toLowerCase();
        const at = haystack.indexOf(term);
        return { entry, at };
      })
      .filter(({ at }) => at >= 0)
      .sort((a, b) => a.at - b.at)
      .slice(0, 5)
      .map(({ entry }) => ({
        type: entry.section.label,
        title: entry.label,
        subtitle: entry.hint ?? null,
        // A hidden entry names a route that needs a record id, so it stands in
        // for its section's list rather than sending anybody to a 404.
        href: entry.hidden ? entry.section.href : entry.href,
        rank: -1,
      }));
  }, [query, roles]);

  /* Records, debounced so a fast typist makes one request rather than nine. */
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setRecords([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const cancelled = { current: false };
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const body = (await response.json()) as { results?: Hit[] };
        if (!cancelled.current) setRecords(body.results ?? []);
      } catch {
        if (!cancelled.current) setRecords([]);
      } finally {
        if (!cancelled.current) setSearching(false);
      }
    }, 180);

    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(() => [...screens, ...records], [screens, records]);

  useEffect(() => setCursor(0), [query]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((at) => Math.min(at + 1, results.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((at) => Math.max(at - 1, 0));
    }
    if (event.key === 'Enter' && results[cursor]) {
      event.preventDefault();
      go(results[cursor]!.href);
    }
  };

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <IconSearch size={16} />
        <span className="search-trigger-label">Search anything</span>
        <kbd className="search-trigger-key">Ctrl K</kbd>
      </button>

      {open ? (
        <div
          className="palette-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
            <div className="palette-input">
              <IconSearch size={18} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="An order number, a vendor, an item, a page…"
                aria-label="Search"
                autoComplete="off"
              />
              {searching ? <span className="faint">searching…</span> : null}
            </div>

            <div className="palette-results">
              {query.trim().length === 0 ? (
                <p className="palette-empty">
                  Type a document number, a name, or what you want to do.
                </p>
              ) : results.length === 0 && !searching ? (
                <p className="palette-empty">
                  Nothing matches “{query.trim()}”. Records you are not allowed to open are
                  never listed here, so it may exist and belong to somebody else.
                </p>
              ) : (
                results.map((hit, index) => (
                  <button
                    type="button"
                    key={`${hit.href}:${hit.title}:${index}`}
                    className={`palette-hit${index === cursor ? ' is-active' : ''}`}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(hit.href)}
                  >
                    <span className="palette-hit-body">
                      <span className="palette-hit-title">{hit.title}</span>
                      {hit.subtitle ? (
                        <span className="palette-hit-subtitle">{hit.subtitle}</span>
                      ) : null}
                    </span>
                    <span className="badge">{hit.type}</span>
                  </button>
                ))
              )}
            </div>

            <div className="palette-footer faint">
              <span>↑↓ to move · ↵ to open · Esc to close</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
