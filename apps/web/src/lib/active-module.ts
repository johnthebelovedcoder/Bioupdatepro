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

export async function getActiveModule(): Promise<SpeciesModule> {
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

  const first = subscribedModules(enabled)[0];
  if (!first) {
    throw new Error('This organisation has no subscribed species modules.');
  }
  return first;
}
