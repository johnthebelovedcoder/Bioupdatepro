import 'server-only';
import { api, optional } from './api';
import type { RoleSectionOverride } from './permissions';

export type { RoleSectionOverride };

/**
 * The company's admin-set overrides on top of the hardcoded role→section map
 * (US-897-035).
 *
 * Read failure is swallowed on purpose: this stays the cosmetic layer
 * `permissions.ts` already documents itself as being — "nothing here is
 * relied upon for security" — and a farm that has never opened the admin
 * screen has zero override rows. An API hiccup fetching them should fall
 * back to the hardcoded defaults, not break the sidebar for everyone.
 */
export async function getRoleSectionOverrides(): Promise<RoleSectionOverride[]> {
  return optional('the role section overrides', () => api<RoleSectionOverride[]>('/auth/role-sections'), []);
}
