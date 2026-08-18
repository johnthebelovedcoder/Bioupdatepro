'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sheet } from './sheet';

export interface RegisterFilterValues {
  status: string;
  house: string;
  purpose: string;
  stage: string;
  search: string;
}

/**
 * Register filters, behind a single button.
 *
 * The panel used to sit open above the list, where five stacked fields filled
 * the whole first screen on a phone and pushed the register itself below the
 * fold — the list is what the page is for. Now it is one button that reports
 * how many filters are applied, and a sheet that closes again.
 *
 * The values still live in the URL, not in component state, so a filtered view
 * stays something a manager can send to a colleague. The sheet only edits a
 * draft; nothing is applied until Apply is pressed, so half-set filters never
 * trigger a page load.
 */
export function RegisterFilters({
  groupNoun,
  houses,
  purposes,
  stages,
  selected,
}: {
  groupNoun: string;
  houses: string[];
  purposes: string[];
  stages: string[];
  selected: RegisterFilterValues;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RegisterFilterValues>(selected);

  // "Active only" is the default view, so it is not a filter the user applied.
  const appliedCount = [
    selected.status,
    selected.house,
    selected.purpose,
    selected.stage,
    selected.search,
  ].filter(Boolean).length;

  function openSheet() {
    setDraft(selected);
    setOpen(true);
  }

  function apply(values: RegisterFilterValues) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setOpen(false);
    router.push(next.toString() ? `?${next.toString()}` : '?');
  }

  return (
    <>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={openSheet}>
          <FilterIcon />
          Filters
          {appliedCount > 0 ? <span className="filter-count">{appliedCount}</span> : null}
        </button>
        {appliedCount > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              apply({ status: '', house: '', purpose: '', stage: '', search: '' })
            }
          >
            Clear
          </button>
        ) : null}
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setDraft({ status: '', house: '', purpose: '', stage: '', search: '' })
              }
            >
              Clear all
            </button>
            <button type="button" className="btn btn-primary" onClick={() => apply(draft)}>
              Apply
            </button>
          </>
        }
      >
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <label className="field">
            Status
            <select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
            >
              <option value="">Active only</option>
              <option value="ALL">All</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>

          <Picker
            label="Purpose"
            allLabel="All purposes"
            options={purposes}
            value={draft.purpose}
            onChange={(purpose) => setDraft({ ...draft, purpose })}
          />
          <Picker
            label="Stage"
            allLabel="All stages"
            options={stages}
            value={draft.stage}
            onChange={(stage) => setDraft({ ...draft, stage })}
          />
          <Picker
            label="Location"
            allLabel="All locations"
            options={houses}
            value={draft.house}
            onChange={(house) => setDraft({ ...draft, house })}
          />

          <label className="field">
            Search
            <input
              value={draft.search}
              onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              placeholder={`${groupNoun} code or breed`}
            />
          </label>
        </div>
      </Sheet>
    </>
  );
}

function Picker({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
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
