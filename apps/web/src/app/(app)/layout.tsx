import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
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

  let user: SessionUser;
  try {
    user = await api<SessionUser>('/auth/me', { redirectOnUnauthorised: false });
  } catch {
    redirect('/login?expired=1');
  }

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
