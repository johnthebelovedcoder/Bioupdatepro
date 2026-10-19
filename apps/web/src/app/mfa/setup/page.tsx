import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { getToken, type SessionUser } from '@/lib/session';
import { logout } from '@/app/login/actions';
import { SetupMfaForm } from './setup-form';

export const metadata = { title: 'Set up authenticator — BioAssetPro' };

export default async function MfaSetupPage() {
  if (!(await getToken())) redirect('/login');
  const user = await api<SessionUser>('/auth/me');
  if (user.mfaEnabled) redirect('/login?mfa=enabled');

  /*
   * Enrolment needs MFA_ENCRYPTION_KEY, which the authenticator secret is
   * encrypted with before it is stored. It is entered by hand on the server
   * (render.yaml carries `sync: false`), so a deployment can come up healthy
   * with it missing — and then this one route answers 500. Letting that throw
   * put every administrator, finance and farm-manager account, on the very
   * first screen after their first sign-in, in front of a blank page reading
   * "Application error: a server-side exception has occurred", with no way
   * back and nothing naming the cause.
   *
   * Every one of those accounts must enrol before they can use the app, so
   * this is not a corner: it is the whole farm's first morning. The page now
   * says what is wrong, who can fix it, and offers the way out.
   */
  let setup: { secret: string; otpauthUri: string };
  try {
    setup = await api<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', {
      method: 'POST',
      body: {},
    });
  } catch (caught) {
    if (isNavigation(caught)) throw caught;
    console.error('Could not begin authenticator enrollment', caught);
    return <EnrollmentUnavailable reason={reasonFor(caught)} />;
  }

  return (
    <main className="login-page">
      <div className="login-panel">
        <div className="card">
          <div className="card-body stack">
            <h1>Secure your account</h1>
            <p>
              Your role needs an authenticator app: it is required for finance, approval, farm management, supervisor and administrator roles.
              Add BioAssetPro to your authenticator, then enter its current six-digit code.
            </p>
            <ol className="stack">
              <li>Open your authenticator app and choose to add an account manually.</li>
              <li>Account name: <strong>BioAssetPro</strong>. Enter this setup key:</li>
            </ol>
            <p className="notice notice-warning" style={{ overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
              {setup.secret}
            </p>
            <details>
              <summary className="link" style={{ cursor: 'pointer' }}>Show the authenticator setup URI</summary>
              <code style={{ display: 'block', marginTop: 'var(--sp-2)', overflowWrap: 'anywhere' }}>
                {setup.otpauthUri}
              </code>
            </details>
            <SetupMfaForm />
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * What to tell someone whose enrolment could not start.
 *
 * The API's own message names the setting an administrator has to put right;
 * anything else (it was still waking up, it is down) gets the general wording,
 * because a stack trace or an HTML error page is not an explanation.
 */
function reasonFor(caught: unknown): string {
  if (caught instanceof ApiError && /MFA_ENCRYPTION_KEY/.test(caught.message)) {
    return 'BioAssetPro is missing the key it encrypts authenticator secrets with, so enrolment cannot start. Whoever administers the server needs to set MFA_ENCRYPTION_KEY on the API service and restart it.';
  }
  return 'BioAssetPro could not start authenticator setup. It may still be waking up — wait a few seconds and reload. If it keeps happening, tell whoever administers the server.';
}

function EnrollmentUnavailable({ reason }: { reason: string }) {
  return (
    <main className="login-page">
      <div className="login-panel">
        <div className="card">
          <div className="card-body stack">
            <h1>Authenticator setup is unavailable</h1>
            <p className="notice notice-error">{reason}</p>
            <p>
              Your sign-in worked. Your role needs an authenticator app before you can go any
              further, so there is nothing to do here until this is put right.
            </p>
            <form action={logout}>
              <button type="submit" className="btn btn-ghost">Sign out</button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Next.js signals redirect and not-found by throwing; those must pass through. */
function isNavigation(caught: unknown): boolean {
  const digest = (caught as { digest?: unknown } | null | undefined)?.digest;
  return typeof digest === 'string' && (digest === 'NEXT_NOT_FOUND' || digest.startsWith('NEXT_REDIRECT'));
}
