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
        <div className="card">
          <div className="card-body stack">
            <h1>Verify it’s you</h1>
            <p className="faint">
              Enter the six-digit code from your authenticator app. You can use a recovery code instead.
            </p>
            <VerifyMfaForm />
            <Link href="/login" className="faint">Return to sign in</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
