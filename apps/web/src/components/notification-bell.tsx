'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bellSummary, markNoticesRead, type BellNotice } from '@/app/(app)/approvals/inbox/actions';
import { IconBell } from './icons';

const EVENT: Record<string, string> = {
  SUBMISSION: 'Waiting for you',
  APPROVAL: 'Approved',
  REJECTION: 'Rejected',
  RETURN: 'Sent back',
  ESCALATION: 'Escalated',
  REMINDER: 'Reminder',
  CANCELLATION: 'Cancelled',
  POSTING: 'Posted',
};

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * The top bar's bell: unread in-app notices, the latest few, and the way to
 * all of them and to notification settings. Refreshes on each page change
 * and every minute while the tab is open.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<BellNotice[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const refresh = useCallback(async () => {
    const summary = await bellSummary();
    setUnread(summary.unread);
    setLatest(summary.latest);
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

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

  const openNotice = async (notice: BellNotice) => {
    setOpen(false);
    if (!notice.readAt) {
      await markNoticesRead([notice.id]);
      await refresh();
    }
    router.push(notice.event === 'SUBMISSION' ? '/approvals' : '/approvals/inbox');
  };

  const markAll = async () => {
    await markNoticesRead();
    await refresh();
  };

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className="btn btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
        style={{ position: 'relative' }}
      >
        <IconBell size={18} />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: 'var(--danger-600, #dc2626)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              lineHeight: '16px',
              textAlign: 'center',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="user-menu-dropdown" role="menu" aria-label="Notifications" style={{ width: 340, maxWidth: 'calc(100vw - 24px)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: 'var(--sp-3) var(--sp-4)' }}>
            <strong style={{ fontSize: 14 }}>Notifications</strong>
            {unread > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={markAll}>
                Mark all read
              </button>
            ) : null}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {latest.length === 0 ? (
              <p className="faint" style={{ padding: '0 var(--sp-4) var(--sp-4)', margin: 0 }}>
                Nothing yet. Approvals and documents that need you show up here.
              </p>
            ) : (
              latest.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  className="user-menu-option"
                  onClick={() => openNotice(n)}
                  style={{ alignItems: 'flex-start', textAlign: 'left', gap: 'var(--sp-2)' }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      marginTop: 6,
                      flexShrink: 0,
                      borderRadius: '50%',
                      background: n.readAt ? 'transparent' : 'var(--brand-600, #16a34a)',
                    }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: n.readAt ? 400 : 600, fontSize: 13 }}>{n.subject}</span>
                    <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                      {EVENT[n.event] ?? n.event.toLowerCase()} · {n.document} · {ago(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', padding: 'var(--sp-3) var(--sp-4)', borderTop: '1px solid var(--border, #e5e7eb)' }}>
            <Link href="/approvals/inbox" onClick={() => setOpen(false)} style={{ fontSize: 13 }}>
              See all
            </Link>
            <Link href="/notifications" onClick={() => setOpen(false)} style={{ fontSize: 13 }}>
              Notification settings
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
