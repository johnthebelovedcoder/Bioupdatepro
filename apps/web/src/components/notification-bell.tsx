'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  attentionItems,
  bellSummary,
  markNoticesRead,
  type AttentionItem,
  type BellNotice,
} from '@/app/(app)/approvals/inbox/actions';
import { IconBell } from './icons';
import { MenuOverlay } from './menu-overlay';

/** How each workflow event reads, and its colour. */
const EVENT: Record<string, { label: string; tone: string; mark: string }> = {
  SUBMISSION: { label: 'Waiting for your approval', tone: 'tone-warning', mark: '!' },
  REMINDER: { label: 'Reminder', tone: 'tone-warning', mark: '!' },
  ESCALATION: { label: 'Escalated to you', tone: 'tone-error', mark: '↑' },
  APPROVAL: { label: 'Approved', tone: 'tone-brand', mark: '✓' },
  POSTING: { label: 'Posted', tone: 'tone-brand', mark: '✓' },
  REJECTION: { label: 'Rejected', tone: 'tone-error', mark: '✕' },
  RETURN: { label: 'Sent back to you', tone: 'tone-warning', mark: '↩' },
  CANCELLATION: { label: 'Cancelled', tone: 'tone-neutral', mark: '–' },
};

const SEVERITY: Record<AttentionItem['severity'], { tone: string; mark: string }> = {
  critical: { tone: 'tone-error', mark: '!' },
  warning: { tone: 'tone-warning', mark: '!' },
  info: { tone: 'tone-neutral', mark: 'i' },
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
 * The top bar's bell. Two things live here:
 *   Needs attention — what the farm needs someone to act on now (the same
 *     list as Home: approvals waiting, feed running out, overdue vaccinations,
 *     a mortality spike…), each linking to where it is dealt with.
 *   Updates — what approvals have sent this person: something waiting for
 *     them, their document approved, rejected, sent back, posted.
 * The badge counts unread updates. Refreshes on every page change and each
 * minute while the tab is open; the attention list loads when the panel opens.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<BellNotice[]>([]);
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
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
    setOpen(false);
  }, [pathname, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    setAttention(null);
    void attentionItems().then(setAttention);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const openNotice = async (notice: BellNotice) => {
    setOpen(false);
    if (!notice.readAt) {
      await markNoticesRead([notice.id]);
      void refresh();
    }
    router.push(notice.event === 'SUBMISSION' || notice.event === 'REMINDER' || notice.event === 'ESCALATION' ? '/approvals' : '/approvals/inbox');
  };

  const markAll = async () => {
    await markNoticesRead();
    await refresh();
  };

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className="btn btn-icon bell-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
      >
        <IconBell size={18} />
        {unread > 0 ? <span className="bell-count">{unread > 99 ? '99+' : unread}</span> : null}
      </button>

      {open ? (
        <>
          <MenuOverlay onClose={() => setOpen(false)} />
          <div className="bell-panel" role="dialog" aria-label="Notifications">
            <div className="bell-head">
              <h2>
                Notifications
                {unread > 0 ? <span className="bell-pill">{unread} new</span> : null}
              </h2>
              {unread > 0 ? (
                <button type="button" className="bell-link" onClick={markAll}>
                  Mark all as read
                </button>
              ) : null}
            </div>

            <div className="bell-body">
              <div className="bell-section-title">Needs attention</div>
              {attention === null ? (
                <div className="bell-empty" style={{ padding: '12px 16px' }}>
                  Checking…
                </div>
              ) : attention.length === 0 ? (
                <div className="bell-empty" style={{ padding: '8px 16px 12px', textAlign: 'left' }}>
                  Nothing needs you right now.
                </div>
              ) : (
                attention.map((a) =>
                  a.href ? (
                    <Link key={a.id} href={a.href} className="bell-item" onClick={() => setOpen(false)}>
                      <span className={`bell-icon ${SEVERITY[a.severity].tone}`}>{SEVERITY[a.severity].mark}</span>
                      <span className="bell-text">
                        <span className="bell-title">{a.title}</span>
                        <span className="bell-meta">{a.detail}</span>
                      </span>
                    </Link>
                  ) : (
                    <div key={a.id} className="bell-item" style={{ cursor: 'default' }}>
                      <span className={`bell-icon ${SEVERITY[a.severity].tone}`}>{SEVERITY[a.severity].mark}</span>
                      <span className="bell-text">
                        <span className="bell-title">{a.title}</span>
                        <span className="bell-meta">{a.detail}</span>
                      </span>
                    </div>
                  ),
                )
              )}

              <div className="bell-section-title">Updates</div>
              {latest.length === 0 ? (
                <div className="bell-empty">
                  <div className="bell-empty-icon">
                    <IconBell size={18} />
                  </div>
                  No updates yet. When something is sent for your approval, or a document of yours is approved, rejected or sent back, it shows
                  here.
                </div>
              ) : (
                latest.map((n) => {
                  const kind = EVENT[n.event] ?? { label: n.event.toLowerCase(), tone: 'tone-neutral', mark: '•' };
                  return (
                    <button key={n.id} type="button" className={`bell-item${n.readAt ? '' : ' is-unread'}`} onClick={() => openNotice(n)}>
                      <span className={`bell-icon ${kind.tone}`}>{kind.mark}</span>
                      <span className="bell-text">
                        <span className="bell-title">{n.subject}</span>
                        <span className="bell-meta">
                          {kind.label} · {n.document} · {ago(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="bell-foot">
              <Link href="/approvals/inbox" className="bell-link" onClick={() => setOpen(false)}>
                See all notifications
              </Link>
              <Link href="/notifications" className="bell-link" onClick={() => setOpen(false)}>
                Settings
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
