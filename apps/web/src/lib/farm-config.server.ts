import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_CONFIG, type FarmConfig } from './farm-config';

/**
 * The farm's configuration, with this farm's overrides applied.
 *
 * Overrides are held in a cookie rather than client state for one reason: every
 * screen in this product is server-rendered, so a setting kept in the browser
 * would not reach the code that needs it. A cookie is readable during the
 * render that has to honour it.
 *
 * Only the DIFFERENCE from the defaults is stored. A cookie is capped around
 * 4KB and the breed standards alone would blow that; storing deltas keeps it to
 * a few hundred bytes and means a farm that changes nothing carries nothing.
 *
 * This is a stand-in for the organisation's settings record. When tenancy
 * exists it becomes a database read, and every caller is unchanged.
 */

export const CONFIG_COOKIE = 'bap_config';

export async function getFarmConfig(): Promise<FarmConfig> {
  const store = await cookies();
  const raw = store.get(CONFIG_COOKIE)?.value;
  if (!raw) return DEFAULT_CONFIG;

  try {
    const overrides = JSON.parse(decodeURIComponent(raw)) as DeepPartial<FarmConfig>;
    return merge(DEFAULT_CONFIG, overrides);
  } catch {
    // A malformed cookie must not take the farm's whole app down. Fall back to
    // defaults rather than throwing on every page.
    return DEFAULT_CONFIG;
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
