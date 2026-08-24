import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { getToken, type SessionUser } from '@/lib/session';
import { getActiveModule } from '@/lib/active-module';
import { getFarmConfig } from '@/lib/farm-config.server';
import { getContext } from '@/lib/org';
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

  const [activeModule, config, context] = await Promise.all([
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
  ]);

  const organisationName = context?.company?.name ?? config.organisation.name;

  return (
    <AppShell
      user={user}
      activeModule={activeModule?.key ?? null}
      workerLanguage={config.organisation.workerLanguage}
      organisationName={organisationName}
    >
      {children}
    </AppShell>
  );
}
