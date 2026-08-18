'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { FinancialYear } from '@/lib/org';

export function JournalFilters({
  years,
  selected,
}: {
  years: FinancialYear[];
  selected: {
    financialYearId: string;
    financialPeriodId: string;
    status: string;
    search: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if ('financialYearId' in changes) next.delete('financialPeriodId');
    // Any change to the filter invalidates the page you were on.
    next.delete('page');
    router.push(`?${next.toString()}`);
  }

  const periods = years.find((year) => year.id === selected.financialYearId)?.periods ?? [];

  return (
    <div className="card">
      <form
        className="card-body grid-auto"
        style={{ alignItems: 'end' }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          update({ search: String(data.get('search') ?? '') });
        }}
      >
        <label className="field">
          Financial year
          <select
            value={selected.financialYearId}
            onChange={(event) => update({ financialYearId: event.target.value })}
          >
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.code}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Period
          <select
            value={selected.financialPeriodId}
            onChange={(event) => update({ financialPeriodId: event.target.value })}
          >
            <option value="">Whole year</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Status
          <select
            value={selected.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">All</option>
            <option value="POSTED">Posted</option>
            <option value="DRAFT">Draft</option>
            <option value="REVERSED">Reversed</option>
          </select>
        </label>

        <label className="field">
          Search
          <input
            name="search"
            defaultValue={selected.search}
            placeholder="Journal number or narration"
          />
        </label>

        <button type="submit" className="btn">
          Apply
        </button>
      </form>
    </div>
  );
}
