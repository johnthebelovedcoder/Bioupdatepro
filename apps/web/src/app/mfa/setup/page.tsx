import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { getToken, type SessionUser } from '@/lib/session';
import { SetupMfaForm } from './setup-form';

export const metadata = { title: 'Set up authenticator — BioAssetPro' };

export default async function MfaSetupPage() {
  if (!(await getToken())) redirect('/login');
  const user = await api<SessionUser>('/auth/me');
  if (user.mfaEnabled) redirect('/login?mfa=enabled');
  const setup = await api<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', {
    method: 'POST',
    body: {},
  });

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
