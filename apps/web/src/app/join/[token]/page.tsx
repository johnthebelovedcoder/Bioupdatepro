import Link from 'next/link';
import { JoinForm } from '@/components/join-form';
import { describeInvitation } from './actions';

export const metadata = { title: 'Join a farm — BioAssetPro' };

/** Role codes are not words. Show what the person will actually be able to do. */
function humanRole(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await describeInvitation(token);

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
            {invitation.ok ? `Join ${invitation.farmName}` : 'Invitation'}
          </div>
          {invitation.ok ? (
            <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
              {invitation.invitedBy} invited you as{' '}
              {invitation.roles.map(humanRole).join(', ')}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-body stack" style={{ gap: 'var(--sp-4)' }}>
            {invitation.ok ? (
              <JoinForm token={token} email={invitation.email} />
            ) : (
              <>
                {/*
                  One message covers expired, withdrawn and already-used, because
                  the person following the link can do nothing different in any
                  of those cases — and spelling out which it was tells anybody
                  who found the link more than it tells the invitee.
                */}
                <div className="notice notice-warning">{invitation.reason}</div>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  Ask whoever invited you to send a new link. Invitations stop working after
                  fourteen days.
                </p>
                <Link className="btn" href="/login">
                  Go to sign in
                </Link>
              </>
            )}
          </div>
        </div>

        {invitation.ok ? (
          <p className="faint" style={{ fontSize: 13, textAlign: 'center' }}>
            You are joining a farm that already exists. Everything you record is signed with
            your name.
          </p>
        ) : null}
      </div>
    </main>
  );
}
