import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { getToken, type SessionUser } from '@/lib/session';
import { getActiveModule } from '@/lib/active-module';
import { getFarmConfig } from '@/lib/farm-config.server';
import { getContext } from '@/lib/org';
import { getRoleSectionOverrides } from '@/lib/role-sections';
import { applyOverrides, sectionForPath, sectionsFor } from '@/lib/permissions';
import { AppShell } from '@/components/app-shell';

/**
 * Every page under this layout requires a valid session.
 *
 * The check is a real call to the API rather than "is there a cookie", because
 * a cookie proves nothing — the token could be expired, or belong to a user who
 * has since been deactivated. Roles come back from the API too, so the
 * navigation reflects current authority rather than whatever the token said
 * when it was issued.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getToken())) redirect('/login');

  /*
   * Only the API saying "this session is not valid" (401) ends a session.
   * Anything else — the API restarting during a deploy, waking from sleep on
   * the free tier, a database blip — used to be treated the same way, and
   * signed people out mid-work for something that had nothing to do with
   * them (seen twice on 2026-09-24). Those are retried briefly, and if the
   * API is still unreachable the page says so, with the session left intact.
   */
  let user: SessionUser | null = null;
  for (let attempt = 1; attempt <= 4 && !user; attempt += 1) {
    try {
      user = await api<SessionUser>('/auth/me', { redirectOnUnauthorised: false });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) redirect('/login?expired=1');
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  if (!user) return <ServerUnavailable />;

  const [activeModule, config, context, roleSectionOverrides] = await Promise.all([
    getActiveModule(),
    getFarmConfig(),
    /*
     * The company's real name, from the ledger.
     *
     * `config.organisation.name` is a local default — it says "Kajola Farms" to
     * everybody, including a farmer who just signed up and named their farm
     * something else. The name shown has to be the company the token belongs
     * to, or the interface is telling the user they are somewhere they are not.
     */
    getContext().catch(() => null),
    getRoleSectionOverrides(),
  ]);

  const organisationName = context?.company?.name ?? config.organisation.name;

  /*
   * The role gate, done here rather than in Edge middleware.
   *
   * Middleware only ever had the JWT's roles claim to check against the
   * hardcoded role→section table — it had no way to see this company's
   * admin-set overrides (`RoleSectionAccess`, US-897-035) without a second
   * network round trip on every navigation. This layout already makes that
   * round trip (`getRoleSectionOverrides()`, fetched above for the sidebar),
   * so this is the first place the check can actually be right: a role an
   * admin has GIVEN a page back gets in, and a role an admin has TUCKED a
   * page away from is turned away, not just whichever the hardcoded table
   * alone would have said.
   *
   * The page that explains the refusal must never refuse entry to itself.
   */
  const pathname = (await headers()).get('x-pathname') ?? '/';
  if (!pathname.startsWith('/no-access')) {
    const allowed = applyOverrides(sectionsFor(user.roles), user.roles, roleSectionOverrides);
    if (!allowed.has(sectionForPath(pathname))) {
      redirect(`/no-access?from=${encodeURIComponent(pathname)}`);
    }
  }

  return (
    <AppShell
      user={user}
      activeModule={activeModule?.key ?? null}
      workerLanguage={config.organisation.workerLanguage}
      organisationName={organisationName}
      roleSectionOverrides={roleSectionOverrides}
    >
      {children}
    </AppShell>
  );
}

/**
 * Shown when the API cannot be reached for a while — not a sign-out. The
 * session cookie is untouched, so "Try again" picks up exactly where the
 * person was once the server is back.
 */
async function ServerUnavailable() {
  const path = (await headers()).get('x-pathname') ?? '/';
  return (
    <main style={{ maxWidth: 480, margin: '15vh auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>The server is not answering</h1>
      <p style={{ color: '#555', lineHeight: 1.5 }}>
        BioAssetPro could not reach its server just now — it may be restarting after an update, or
        waking up. You are still signed in, and nothing you saved is lost.
      </p>
      <p style={{ marginTop: 20 }}>
        <a href={path} style={{ fontWeight: 600 }}>Try again</a>
      </p>
    </main>
  );
}
