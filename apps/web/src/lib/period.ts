/**
 * The time window a page is showing.
 *
 * One definition, used by every chart and every figure on a page, so the
 * heading, the chart and the totals can never be describing different spans of
 * time. Held in the URL so a view someone is looking at can be sent to someone
 * else and be the same view.
 */

export type PeriodKey = 'week' | 'month' | 'quarter' | 'year';

export interface Period {
  key: PeriodKey;
  /** What a farmer would call it. */
  label: string;
  /** Days of history, for the daily charts. */
  days: number;
  /** How the span reads in a subtitle. */
  caption: string;
}

export const PERIODS: Period[] = [
  { key: 'week', label: 'This week', days: 7, caption: 'last 7 days' },
  { key: 'month', label: 'This month', days: 30, caption: 'last 30 days' },
  { key: 'quarter', label: 'Last 3 months', days: 90, caption: 'last 3 months' },
  { key: 'year', label: 'This year', days: 365, caption: 'last 12 months' },
];

export const DEFAULT_PERIOD: PeriodKey = 'month';

export function resolvePeriod(
  value: string | undefined | null,
  financialYearStartMonth = 1,
): Period {
  const chosen =
    PERIODS.find((period) => period.key === value) ??
    PERIODS.find((period) => period.key === DEFAULT_PERIOD)!;

  // "This year" is the only window whose length is a question about the
  // business rather than a fixed count of days.
  return chosen.key === 'year' ? financialYearToDate(financialYearStartMonth) : chosen;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * "This year" means the financial year so far, not the last 365 days.
 *
 * The two are different for most of the year and the difference is not
 * cosmetic: a farm whose year starts in April and is looking at figures in May
 * wants six weeks of trading, not six weeks plus the ten months belonging to a
 * year it has already closed. A rolling window would quietly mix the two and
 * disagree with every report the accountant produces.
 *
 * This is also the only thing the financial-year-start setting does, so it is
 * the thing that makes changing it visible.
 */
function financialYearToDate(startMonth: number): Period {
  const month = Math.min(12, Math.max(1, Math.round(startMonth) || 1));
  const now = new Date();
  const calendarYear = now.getUTCFullYear();

  // The year currently running began this calendar year if we have reached its
  // starting month, and last calendar year otherwise.
  const startYear = now.getUTCMonth() + 1 >= month ? calendarYear : calendarYear - 1;

  const start = Date.UTC(startYear, month - 1, 1);
  const today = Date.UTC(calendarYear, now.getUTCMonth(), now.getUTCDate());
  const days = Math.max(1, Math.round((today - start) / 86_400_000) + 1);

  return {
    key: 'year',
    label: 'This year',
    days,
    caption: `financial year to date, from ${MONTH_NAMES[month - 1]} ${startYear}`,
  };
}

/**
 * How many points to plot for a window.
 *
 * A year of daily points is 365 marks in a chart a few hundred pixels wide —
 * unreadable, and slow. Longer windows are summarised into weeks or months, so
 * the shape stays legible whatever span is chosen.
 */
export function bucketsFor(period: Period): { count: number; everyDays: number; unit: string } {
  switch (period.key) {
    case 'week':
      return { count: 7, everyDays: 1, unit: 'day' };
    case 'month':
      return { count: 30, everyDays: 1, unit: 'day' };
    case 'quarter':
      return { count: 13, everyDays: 7, unit: 'week' };
    case 'year':
    default: {
      // Monthly buckets across however much of the financial year has actually
      // run — a fixed twelve would plot months the year has not reached.
      const count = Math.max(1, Math.round(period.days / 30));
      return { count, everyDays: 30, unit: 'month' };
    }
  }
}
