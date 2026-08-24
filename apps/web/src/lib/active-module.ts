import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_MODULE, getModule, subscribedModules, type SpeciesModule } from './modules';
import { getFarmConfig } from './farm-config.server';

/**
 * Which species module the user is currently working in.
 *
 * Held in a cookie rather than client state so the server render already knows
 * it — the sidebar, page titles and terminology are all server-rendered, and a
 * client-side selection would mean every page flashed the wrong vocabulary
 * before correcting itself.
 *
 * Not httpOnly: this is a view preference, not a credential, and there is no
 * harm in the client reading it. Authority still comes from the subscription
 * check below, never from the cookie's value.
 */

export const MODULE_COOKIE = 'bap_module';

/**
 * Null when the organisation has no species module, which is a valid state.
 *
 * This used to throw. That made a claim the specification explicitly denies:
 * §60 describes AgriPro as a core ERP platform with SnailPro and PoultryPro as
 * optional extensions, so a farm that buys the platform on its own — books,
 * buying, selling, payroll, no livestock — is an ordinary customer, and this
 * function crashed their entire application on the first page load.
 *
 * Returning null instead means "AgriPro Core, nothing on top", and every
 * consumer already had to handle the shape of a missing module for the case
 * where a cookie names one the farm does not have.
 */
export async function getActiveModule(): Promise<SpeciesModule | null> {
  const [store, config] = await Promise.all([cookies(), getFarmConfig()]);
  const enabled = config.modules;
  const has = (module: SpeciesModule | null) =>
    Boolean(module?.subscribed && (enabled.length === 0 || enabled.includes(module.key)));

  const requested = getModule(store.get(MODULE_COOKIE)?.value);

  // A cookie naming a module the organisation does not have must not grant
  // access to it. Fall back rather than trust the value.
  if (has(requested)) return requested!;

  const fallback = getModule(DEFAULT_MODULE);
  if (has(fallback)) return fallback!;

  return subscribedModules(enabled)[0] ?? null;
}
