'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { GlossaryEntry, GlossaryGroup } from '@/lib/glossary';

const GROUPS: Array<GlossaryGroup | 'All'> = ['All', 'Both', 'Snails', 'Poultry', 'Accounting'];
const GROUP_LABEL: Record<GlossaryGroup | 'All', string> = {
  All: 'All',
  Both: 'Snails and poultry',
  Snails: 'Snails',
  Poultry: 'Poultry',
  Accounting: 'Accounting',
};

/** The glossary, searchable by term or meaning, filtered by section. */
export function GlossaryList({ entries }: { entries: GlossaryEntry[] }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GlossaryGroup | 'All'>('All');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => group === 'All' || e.group === group)
      .filter((e) => !q || e.term.toLowerCase().includes(q) || e.meaning.toLowerCase().includes(q));
  }, [entries, query, group]);

  return (
    <div className="stack">
      <label className="field">
        Find a term
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="FCR, withdrawal, recovery…" />
      </label>
      <div className="chip-row" role="group" aria-label="Section">
        {GROUPS.map((g) => (
          <button key={g} type="button" className="chip" aria-pressed={group === g} onClick={() => setGroup(g)}>
            {GROUP_LABEL[g]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="faint">No term matches “{query}”.</p>
      ) : (
        <dl className="glossary">
          {shown.map((e) => (
            <div key={e.term} className="glossary-entry">
              <dt>
                {e.term}
                <span className="badge" style={{ marginLeft: 8 }}>
                  {GROUP_LABEL[e.group]}
                </span>
              </dt>
              <dd>
                <p>{e.meaning}</p>
                <p className="faint">
                  <strong>In the app: </strong>
                  {e.rule}
                  {e.where ? (
                    <>
                      {' '}
                      <Link href={e.where.href}>{e.where.label} →</Link>
                    </>
                  ) : null}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
