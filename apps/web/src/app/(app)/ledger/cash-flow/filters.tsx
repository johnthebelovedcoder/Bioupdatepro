'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FilterPanel } from '@/components/filter-panel';

export interface CashFlowPeriodOption {
  id: string;
  label: string;
}

/**
 * Cash flow only ever runs for one period — there is no branch, cost centre
 * or farm dimension on it, unlike the trial balance's family of reports — so
 * this is a single select rather than a reuse of `TrialBalanceFilters`.
 */
export function CashFlowFilters({
  periods,
  selected,
}: {
  periods: CashFlowPeriodOption[];
  selected: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set('financialPeriodId', value);
    else next.delete('financialPeriodId');
    router.push(next.toString() ? `?${next.toString()}` : '?');
  }

  return (
    <FilterPanel title="Period">
      <label className="field">
        Period
        <select value={selected} onChange={(event) => update(event.target.value)}>
          <option value="">Current period</option>
          {periods.map((period) => (
            <option key={period.id} value={period.id}>
              {period.label}
            </option>
          ))}
        </select>
      </label>
    </FilterPanel>
  );
}
