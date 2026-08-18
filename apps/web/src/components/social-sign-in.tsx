import Link from 'next/link';

/**
 * Google and Facebook, shown only when they are actually configured.
 *
 * The seam is here and the wiring is not, and that distinction is the whole
 * point of this file. Both providers need an application registered under the
 * farm's own developer account — a client id, a secret, and an authorised
 * redirect URI — and none of those can be invented. Until they exist in the
 * API's environment, `/auth/providers` reports the provider as unavailable and
 * these buttons do not render at all.
 *
 * Rendering them anyway would be the worst option available. A Google button
 * that opens a broken consent screen tells the user nothing about whose fault
 * it is, and they cannot find out; they conclude the product is broken and
 * leave. A button that is absent asks no questions.
 *
 * To turn them on, set in the API environment:
 *
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
 *
 * and add the OAuth callback routes. Everything on this side is ready for them.
 */
export function SocialSignIn({
  providers,
  action,
}: {
  providers: { google: boolean; facebook: boolean };
  action: 'signin' | 'signup';
}) {
  if (!providers.google && !providers.facebook) return null;

  const verb = action === 'signup' ? 'Sign up' : 'Continue';

  return (
    <>
      <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
        <span style={{ flex: 1, height: 1, background: 'var(--gray-200)' }} />
        <span className="faint">or</span>
        <span style={{ flex: 1, height: 1, background: 'var(--gray-200)' }} />
      </div>

      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {providers.google ? (
          <Link className="btn" href="/api/auth/google" prefetch={false}>
            {verb} with Google
          </Link>
        ) : null}
        {providers.facebook ? (
          <Link className="btn" href="/api/auth/facebook" prefetch={false}>
            {verb} with Facebook
          </Link>
        ) : null}
      </div>
    </>
  );
}
