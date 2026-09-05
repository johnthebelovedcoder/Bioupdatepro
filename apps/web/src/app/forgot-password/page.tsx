import Link from 'next/link';

export const metadata = { title: 'Forgot password — BioAssetPro' };

/**
 * Honest rather than a form that goes nowhere.
 *
 * There is no mail transport in this product (see `PasswordResetToken`'s own
 * schema comment), so a "type your email, get a reset link" form here would
 * either silently do nothing or need to lie about what happens next. The
 * true answer is simpler and just as fast on a small farm: an administrator
 * — Farm Manager, CFO or System Admin — can generate a reset link from
 * Staff & roles and hand it to whoever needs it directly.
 */
export default function ForgotPasswordPage() {
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
            <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0 }}>
              Ask your farm&rsquo;s administrator, farm manager or CFO to reset it for you. They
              can do this from <strong>Staff &amp; roles</strong> — find your name, choose{' '}
              <strong>Reset password</strong>, and they will send you a fresh sign-in link
              directly.
            </p>
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              This product does not send email yet, so there is no automatic reset link — the
              same reason a new teammate is invited by a link someone hands them, not an
              automatic email.
            </p>
            <Link className="btn" href="/login">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
