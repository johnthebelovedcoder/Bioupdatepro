import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/forgot-password-form';
import { emailAvailable } from './actions';

export const metadata = { title: 'Forgot password — BioAssetPro' };

/**
 * A real form when one can actually do something, an honest fallback when it can't.
 *
 * Same "ask before offering" rule the Google/Facebook sign-in buttons already
 * follow: this used to always show the fallback, because no email transport
 * existed at all. Now that Resend is wired in (see `EmailService`), the page
 * asks the API which is true rather than assuming.
 */
export default async function ForgotPasswordPage() {
  const hasEmail = await emailAvailable();

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
            Forgot your password?
          </div>
        </div>

        <div className="card">
          <div className="card-body stack" style={{ gap: 'var(--sp-4)' }}>
            {hasEmail ? (
              <>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  Tell us the email you sign in with, and we&rsquo;ll send you a link to set a
                  new password.
                </p>
                <ForgotPasswordForm />
              </>
            ) : (
              <>
                <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0 }}>
                  Ask your farm&rsquo;s administrator, farm manager or CFO to reset it for you.
                  They can do this from <strong>Staff &amp; roles</strong> — find your name,
                  choose <strong>Reset password</strong>, and they will send you a fresh
                  sign-in link directly.
                </p>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  This farm hasn&rsquo;t set up automatic email yet, so there is no reset link
                  to send you directly.
                </p>
              </>
            )}
            <Link className="btn" href="/login">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
