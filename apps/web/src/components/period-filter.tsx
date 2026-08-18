'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { PERIODS, type PeriodKey } from '@/lib/period';

/**
 * Picks the time window for everything on the page.
 *
 * A segmented row rather than a dropdown: there are only four choices, they are
 * the ones people switch between constantly, and one tap beats open-then-tap.
 * It scrolls sideways on a narrow phone rather than wrapping.
 */
export function PeriodFilter({ active }: { active: PeriodKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function choose(key: PeriodKey) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('period', key);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="segmented" role="group" aria-label="Time period">
      {PERIODS.map((period) => (
        <button
          key={period.key}
          type="button"
          className="segmented-option"
          aria-pressed={period.key === active}
          onClick={() => choose(period.key)}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
