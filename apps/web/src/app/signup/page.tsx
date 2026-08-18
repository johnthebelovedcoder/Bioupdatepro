import { SignupForm } from '@/components/signup-form';
import { SocialSignIn } from '@/components/social-sign-in';
import { availableProviders } from './actions';

export const metadata = { title: 'Create your farm — BioAssetPro' };

export default async function SignupPage() {
  const providers = await availableProviders();

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
            Create your farm
          </div>
          <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
            A few minutes now, and your books are set up for the year
          </div>
        </div>

        <div className="card">
          <div className="card-body stack" style={{ gap: 'var(--sp-4)' }}>
            <SignupForm />
            <SocialSignIn providers={providers} action="signup" />
          </div>
        </div>

        {/*
          Said before they commit, not after.

          Signing up builds a real set of books — a chart of accounts, cost
          centres and twelve open periods. Somebody should know that is what
          the button does, and that the parts requiring their accountant are
          not being guessed at on their behalf.
        */}
        <p className="faint" style={{ fontSize: 13, textAlign: 'center' }}>
          Your chart of accounts and financial calendar are set up automatically.
          Tax rates and approval limits are left for you and your accountant.
        </p>
      </div>
    </main>
  );
}
