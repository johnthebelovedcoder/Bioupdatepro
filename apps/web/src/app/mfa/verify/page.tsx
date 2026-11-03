import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMfaChallenge } from '@/lib/session';
import { VerifyMfaForm } from './verify-form';

export const metadata = { title: 'Verify sign-in — BioAssetPro' };

export default async function VerifyMfaPage() {
  if (!(await getMfaChallenge())) redirect('/login');
  return (
    <main className="login-page">
      <div className="login-panel">
        <div style={{ textAlign: 'center' }}>
          <span className="brand-mark" aria-hidden="true">
            BA
          </span>
          <h1 style={{ marginTop: 'var(--sp-4)' }}>Verify it’s you</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: 14 }}>
            Enter your authenticator or recovery code to finish signing in
          </p>
        </div>
        <div className="card">
          <div className="card-body stack">
            <VerifyMfaForm />
            <Link href="/login" className="faint">Return to sign in</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
