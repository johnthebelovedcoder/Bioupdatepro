import Link from 'next/link';
import { LoginForm } from './login-form';
import { SocialSignIn } from '@/components/social-sign-in';
import { availableProviders } from '@/app/signup/actions';

export const metadata = { title: 'Sign in — BioAssetPro' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const [{ expired }, providers] = await Promise.all([searchParams, availableProviders()]);

  return (
    <main className="login-page">
      <div className="login-panel">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 'var(--sp-6)',
          }}
        >
          <span className="brand-mark" style={{ width: 44, height: 44, fontSize: 17 }}>
            BA
          </span>
          <div
            style={{
              fontSize: 22,
              fontWeight: 650,
              letterSpacing: '-0.02em',
              marginTop: 'var(--sp-4)',
            }}
          >
            Sign in to BioAssetPro
          </div>
          {/*
            No module names here.

            Listing the species modules on the sign-in page advertises products
            the person may not have — and worse, it told a snail farmer they
            were logging into something called PoultryPro. What somebody is
            subscribed to is decided after they sign in, not on the door.
          */}
          <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
            Farm management, built for how farms actually work
          </div>
        </div>

        <div className="card">
          <div className="card-body stack" style={{ gap: 'var(--sp-4)' }}>
            {expired ? (
              <div className="notice notice-warning">
                Your session has ended. Please sign in again.
              </div>
            ) : null}
            <LoginForm />
            <SocialSignIn providers={providers} action="signin" />
            <p className="faint" style={{ fontSize: 13, margin: 0, textAlign: 'center' }}>
              New here? <Link href="/signup">Create your farm</Link>
            </p>
          </div>
        </div>

        <p
          className="faint"
          style={{ textAlign: 'center', marginTop: 'var(--sp-5)' }}
        >
          Every approval is recorded against the signed-in user.
        </p>
      </div>
    </main>
  );
}
