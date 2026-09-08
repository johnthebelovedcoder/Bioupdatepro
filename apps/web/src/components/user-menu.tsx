'use client';

import { useEffect, useRef, useState } from 'react';
import { logout } from '@/app/login/actions';
import type { SessionUser } from '@/lib/session';
import { humanRole } from '@/lib/roles';
import { IconSignOut } from './icons';

/**
 * Who is signed in, and therefore who every action is recorded against.
 *
 * A dropdown, not a name next to a bare sign-out button — every SaaS product
 * this sits beside (Slack, Notion, Linear, Google) puts account actions
 * behind the avatar rather than as a permanent icon in the header, and a
 * standing "Sign out" button one misclick away from every other header
 * control was the one real inconsistency worth fixing here.
 */
export function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.fullName} — account menu`}
        onClick={() => setOpen((value) => !value)}
      >
        <div className="row hide-on-phone" style={{ gap: 'var(--sp-3)', minWidth: 0 }}>
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
            <div className="faint">{user.roles.map(humanRole).join(', ') || 'No role assigned'}</div>
          </div>
          <Avatar name={user.fullName} />
        </div>
        <div className="show-on-phone">
          <Avatar name={user.fullName} />
        </div>
      </button>

      {open ? (
        <div className="user-menu-dropdown" role="menu" aria-label="Account">
          <div className="user-menu-head">
            <Avatar name={user.fullName} size={40} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: 'var(--gray-900)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user.fullName}
              </div>
              <div
                className="faint"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {user.email}
              </div>
              <div className="faint">{user.roles.map(humanRole).join(', ') || 'No role assigned'}</div>
            </div>
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
            <button type="submit" role="menuitem" className="user-menu-option">
              <IconSignOut size={17} />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: 'var(--brand-50)',
        color: 'var(--brand-800)',
        display: 'grid',
        placeItems: 'center',
        fontSize: size <= 36 ? 13 : 15,
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
