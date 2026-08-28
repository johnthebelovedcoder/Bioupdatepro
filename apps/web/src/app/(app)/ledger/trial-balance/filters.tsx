'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { FinancialYear } from '@/lib/org';
import { FilterPanel } from '@/components/filter-panel';

interface Named {
  id: string;
  code: string;
  name: string;
}

/**
 * Filters live in the URL, not in component state.
 *
 * A trial balance someone is querying about is a trial balance they need to be
 * able to send to a colleague. Putting the dimension selection in the query
 * string makes every view addressable, bookmarkable and reproducible — which
 * for a figure someone is about to sign off on is the point.
 */
export function TrialBalanceFilters({
  years,
  branches,
  costCentres,
  farms,
  selected,
}: {
  years: FinancialYear[];
  branches: Named[];
  costCentres: Named[];
  farms: Named[];
  selected: {
    financialYearId: string;
    financialPeriodId: string;
    branchId: string;
    costCentreId: string;
    farmId: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing the year invalidates the period chosen inside the old one.
    if (key === 'financialYearId') next.delete('financialPeriodId');
    router.push(`?${next.toString()}`);
  }

  const periods = years.find((year) => year.id === selected.financialYearId)?.periods ?? [];

  return (
    <FilterPanel>
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        <label className="field">
          Financial year
          <select
            value={selected.financialYearId}
            onChange={(event) => update('financialYearId', event.target.value)}
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
            onChange={(event) => update('financialPeriodId', event.target.value)}
          >
            <option value="">Whole year</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </label>

        <Picker
          label="Branch"
          allLabel="All branches"
          options={branches}
          value={selected.branchId}
          onChange={(value) => update('branchId', value)}
        />
        <Picker
          label="Cost centre"
          allLabel="All cost centres"
          options={costCentres}
          value={selected.costCentreId}
          onChange={(value) => update('costCentreId', value)}
        />
        <Picker
          label="Farm"
          allLabel="All farms"
          options={farms}
          value={selected.farmId}
          onChange={(value) => update('farmId', value)}
        />
      </div>
    </FilterPanel>
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
  options: Named[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.code} — {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
