/**
 * Module keys and their subscription state, with no React imports.
 *
 * Separate from `modules.ts` because middleware runs in the edge runtime and
 * cannot pull in the icon components that the full registry references. This
 * file is the single source of truth for which keys exist; `modules.ts` builds
 * its richer entries on top of it.
 */

export const MODULE_KEYS = [
  'poultry',
  'snail',
  'fish',
  'dairy',
  'pig',
  'goat',
  'rabbit',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Which modules this organisation has. Hard-coded until the subscription lives
 * on the organisation record; kept in one place so the middleware, the
 * switcher and the route guard cannot drift apart.
 */
export const SUBSCRIBED: Record<ModuleKey, boolean> = {
  poultry: true,
  snail: true,
  fish: false,
  dairy: false,
  pig: false,
  goat: false,
  rabbit: false,
};

export function isSubscribedKey(value: string | undefined | null): value is ModuleKey {
  return !!value && (MODULE_KEYS as readonly string[]).includes(value) && SUBSCRIBED[value as ModuleKey];
}
