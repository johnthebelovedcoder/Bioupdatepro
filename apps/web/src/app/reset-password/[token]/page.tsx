import Link from 'next/link';
import { ResetPasswordForm } from '@/components/reset-password-form';
import { describeReset } from './actions';

export const metadata = { title: 'Reset password — BioAssetPro' };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const reset = await describeReset(token);

  return (
    <main className="login-page">
      <div className="login-panel">
        <div style={{ textAlign: 'center' }}>
          <span className="brand-mark" aria-hidden="true">
            BA
          </span>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              marginTop: 'var(--sp-4)',
            }}
          >
            Set a new password
          </div>
        </div>

        <div className="card">
          <div className="card-body stack" style={{ gap: 'var(--sp-4)' }}>
            {reset.ok ? (
              <ResetPasswordForm token={token} email={reset.email} />
            ) : (
              <>
                {/*
                  One message covers expired, used and superseded, the same way
                  JoinPage covers expired/withdrawn/used for an invitation — the
                  person holding the link can do nothing different in any of
                  those cases.
                */}
                <div className="notice notice-warning">{reset.reason}</div>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  Ask your administrator for a fresh link from Staff &amp; roles. Reset links
                  last one hour.
                </p>
                <Link className="btn" href="/login">
                  Go to sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
