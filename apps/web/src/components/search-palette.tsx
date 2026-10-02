'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { allEntries, entryFor } from '@/lib/navigation';
import { applyOverrides, sectionsFor } from '@/lib/permissions';
import { useRoleSectionOverrides } from './roles-context';
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
  const roleSectionOverrides = useRoleSectionOverrides();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const recentLoaded = useRef(false);
  const wasOpen = useRef(false);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [shortcutLabel, setShortcutLabel] = useState('Ctrl K');

  useEffect(() => {
    setShortcutLabel(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K');
    try {
      const stored = JSON.parse(localStorage.getItem('bioassetpro.recentRoutes') ?? '[]');
      if (Array.isArray(stored)) setRecentPaths(stored.filter((path): path is string => typeof path === 'string').slice(0, 5));
    } catch {
      setRecentPaths([]);
    }
    recentLoaded.current = true;
  }, []);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      inputRef.current?.focus();
    } else {
      setQuery('');
      setRecords([]);
      setCursor(0);
      if (wasOpen.current) {
        wasOpen.current = false;
        triggerRef.current?.focus();
      }
    }
  }, [open]);

  const allowed = useMemo(
    () => applyOverrides(sectionsFor(roles), roles, roleSectionOverrides),
    [roles, roleSectionOverrides],
  );
  const allowedEntries = useMemo(
    () => allEntries().filter((entry) => allowed.has(entry.section.section)),
    [allowed],
  );
  const currentEntry = entryFor(pathname);

  useEffect(() => {
    if (!recentLoaded.current || !currentEntry || !allowed.has(currentEntry.section.section)) return;
    const route = currentEntry.entry.href;
    if (recentPaths[0] === route) return;
    const next = [route, ...recentPaths.filter((path) => path !== route)].slice(0, 5);
    try {
      localStorage.setItem('bioassetpro.recentRoutes', JSON.stringify(next));
    } catch {
      // Recent navigation is a convenience; private browsing may disable storage.
    }
    setRecentPaths(next);
  }, [pathname, currentEntry?.entry.href, allowed, recentPaths]);

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
    return allowedEntries
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
  }, [query, allowedEntries]);

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

  const recent = useMemo(
    () => recentPaths.flatMap((path) => {
      const entry = allowedEntries.find((candidate) => candidate.href === path);
      return entry ? [{
        type: 'Recent', title: entry.label, subtitle: entry.hint ?? entry.section.label,
        href: entry.hidden ? entry.section.href : entry.href, rank: -2,
      }] : [];
    }),
    [recentPaths, allowedEntries],
  );
  const suggestions = recent.length > 0 ? recent : allowedEntries.slice(0, 4).map((entry) => ({
    type: entry.section.label, title: entry.label, subtitle: entry.hint ?? null,
    href: entry.hidden ? entry.section.href : entry.href, rank: -2,
  }));
  const results = useMemo(
    () => query.trim() ? [...screens, ...records] : suggestions,
    [query, screens, records, suggestions],
  );

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
        ref={triggerRef}
        type="button"
        className="search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <IconSearch size={16} />
        <span className="search-trigger-label">Search anything</span>
        <kbd className="search-trigger-key">{shortcutLabel}</kbd>
      </button>

      {open ? (
        <div
          className="palette-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onKeyDownCapture={(event) => {
              if (event.key !== 'Tab') return;
              const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
                'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
              );
              if (!focusable?.length) return;
              const first = focusable[0]!;
              const last = focusable[focusable.length - 1]!;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
              }
            }}
          >
            <div className="palette-input">
              <IconSearch size={18} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                aria-autocomplete="list"
                aria-controls="search-results"
                aria-activedescendant={results[cursor] ? `search-hit-${cursor}` : undefined}
                placeholder="An order number, a vendor, an item, a page…"
                aria-label="Search"
                autoComplete="off"
              />
              {searching ? <span className="faint">searching…</span> : null}
            </div>

            <div className="palette-results" id="search-results" role="listbox" aria-label="Search suggestions">
              {query.trim().length > 0 && results.length === 0 && !searching ? (
                <p className="palette-empty">
                  Nothing matches “{query.trim()}”. Records you are not allowed to open are
                  never listed here, so it may exist and belong to somebody else.
                </p>
              ) : results.length > 0 ? (
                results.map((hit, index) => (
                  <button
                    type="button"
                    key={`${hit.href}:${hit.title}:${index}`}
                    id={`search-hit-${index}`}
                    role="option"
                    aria-selected={index === cursor}
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
              ) : (
                <p className="palette-empty">Type a document number, a name, or what you want to do.</p>
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
