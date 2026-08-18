/**
 * Money formatting. Kobo in, naira out.
 *
 * The API sends every monetary value as a decimal string of KOBO, because JSON
 * has no integer type wide enough to be trusted and a float would defeat the
 * entire point of storing integers in the first place. Nothing on this side
 * converts kobo to a JavaScript number before formatting — the arithmetic is
 * done on BigInt and only the final digits become text.
 */

const KOBO_PER_NAIRA = 100n;

export type KoboString = string;

export function toKobo(value: KoboString | bigint | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  return typeof value === 'bigint' ? value : BigInt(value);
}

/** ₦1,234,567.89 — grouped, always two decimals, negatives in parentheses. */
export function formatNaira(
  value: KoboString | bigint | null | undefined,
  options: { symbol?: boolean; parenthesiseNegative?: boolean } = {},
): string {
  const { symbol = true, parenthesiseNegative = true } = options;
  const kobo = toKobo(value);
  const negative = kobo < 0n;
  const absolute = negative ? -kobo : kobo;

  const naira = absolute / KOBO_PER_NAIRA;
  const remainder = absolute % KOBO_PER_NAIRA;

  const whole = group(naira.toString());
  const fraction = remainder.toString().padStart(2, '0');
  const body = `${symbol ? '₦' : ''}${whole}.${fraction}`;

  if (!negative) return body;
  // Accounting convention: parentheses, not a minus sign, which is easy to miss
  // in a column of figures.
  return parenthesiseNegative ? `(${body})` : `-${body}`;
}

/** Naira typed by a human ("1,250.50") to kobo, exactly, with no float step. */
export function parseNairaToKobo(input: string): bigint | null {
  const cleaned = input.replace(/[\s,₦]/g, '').trim();
  if (cleaned === '') return null;

  const match = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return null;

  const kobo =
    BigInt(whole === '' ? '0' : whole) * KOBO_PER_NAIRA +
    BigInt(fraction.padEnd(2, '0') || '0');

  return sign === '-' ? -kobo : kobo;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Quantities arrive as decimal strings from Prisma; show them as given. */
export function formatQuantity(value: string | null | undefined, dp = 3): string {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString('en-NG', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(date)} ${date.toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
