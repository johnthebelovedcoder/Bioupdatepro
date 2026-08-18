'use client';

import { logout } from '@/app/login/actions';
import type { SessionUser } from '@/lib/session';
import { IconSignOut } from './icons';

/**
 * Who is signed in, and therefore who every action is recorded against.
 *
 * On a phone the role line drops and the button becomes an icon — the name is
 * what identifies the session, and the header must leave room for the page.
 */
export function UserMenu({ user }: { user: SessionUser }) {
  return (
    <div className="row" style={{ gap: 'var(--sp-3)', minWidth: 0 }}>
      <div
        className="row hide-on-phone"
        style={{ gap: 'var(--sp-3)', minWidth: 0, justifyContent: 'flex-end' }}
      >
        <div style={{ textAlign: 'right', lineHeight: 1.3, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 500,
              fontSize: 14,
              color: 'var(--gray-900)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.fullName}
          </div>
          <div className="faint">
            {user.roles.map(humanRole).join(', ') || 'No role assigned'}
          </div>
        </div>
        <Avatar name={user.fullName} />
      </div>

      <div className="show-on-phone">
        <Avatar name={user.fullName} />
      </div>

      <form
        action={logout}
        onSubmit={() => {
          /*
           * A cached page rendered for this worker must not be served to the
           * next person who picks up the phone. Handsets get shared.
           */
          navigator.serviceWorker?.controller?.postMessage('clear-cache');
        }}
      >
        <button type="submit" className="btn btn-icon" title="Sign out">
          <IconSignOut size={17} />
          <span className="sr-only">Sign out</span>
        </button>
      </form>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        flexShrink: 0,
        borderRadius: '50%',
        background: 'var(--brand-50)',
        color: 'var(--brand-800)',
        display: 'grid',
        placeItems: 'center',
        fontSize: 13,
        fontWeight: 600,
        border: '1px solid var(--brand-100)',
      }}
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function humanRole(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
