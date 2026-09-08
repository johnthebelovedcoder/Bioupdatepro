import 'server-only';
import { api } from './api';
import { DEFAULT_CONFIG, type FarmConfig } from './farm-config';

/**
 * The farm's configuration, with this farm's overrides applied.
 *
 * Reads a real per-company record now — see `CompanyConfig`'s own schema
 * comment for why this used to be a browser cookie and why that was wrong:
 * every other setting in this product is shared across whoever signs into
 * the farm, and this one silently wasn't. Everything downstream of this
 * function is unchanged; only where the override object comes from moved.
 *
 * Only the DIFFERENCE from the defaults is stored, same discipline the
 * cookie already had — a farm that changes nothing still stores nothing.
 */
export async function getFarmConfig(): Promise<FarmConfig> {
  try {
    const { overrides } = await api<{ overrides: DeepPartial<FarmConfig> | null }>(
      '/company-config',
    );
    if (!overrides) return DEFAULT_CONFIG;
    return merge(DEFAULT_CONFIG, overrides);
  } catch {
    // A farm's whole app must not go down because settings could not be
    // read — every page that renders reads this. Fall back to defaults, the
    // same way a malformed cookie used to.
    return DEFAULT_CONFIG;
  }
}

/** Whether this company has ever saved a setting — distinct from `getFarmConfig()`, which always returns something usable either way. */
export async function hasSavedSettings(): Promise<boolean> {
  try {
    const { overrides } = await api<{ overrides: unknown }>('/company-config');
    return overrides !== null && overrides !== undefined;
  } catch {
    return false;
  }
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Deep merge, with arrays REPLACED rather than concatenated.
 *
 * Merging arrays element-wise would be wrong here: turning off one alert rule
 * has to remove it, not blend it with the default at the same index. Anything
 * a farm overrides, it overrides completely.
 */
function merge<T>(base: T, override: DeepPartial<T>): T {
  if (override === null || override === undefined) return base;
  if (Array.isArray(base)) return (override as unknown as T) ?? base;
  if (typeof base !== 'object') return (override as unknown as T) ?? base;

  const result = { ...(base as object) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(override as object)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    result[key] =
      current && typeof current === 'object' && !Array.isArray(current)
        ? merge(current, value as never)
        : value;
  }
  return result as T;
}
