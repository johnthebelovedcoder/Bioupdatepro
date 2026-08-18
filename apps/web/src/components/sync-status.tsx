'use client';

import { useEffect, useState } from 'react';
import {
  blockedCount,
  flush,
  list,
  remove,
  retryNow,
  subscribe,
  type QueueItem,
} from '@/lib/sync-queue';
import { Sheet } from './sheet';

/**
 * The outbox indicator, and the outbox itself.
 *
 * Sits in the header because "has my work been saved?" is a question a worker
 * asks constantly on a bad connection, and answering it should never require
 * navigating anywhere. It shows nothing at all when the queue is empty and
 * the device is online — the quiet state is the common one.
 */
export function SyncStatus() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Read after mount: the server has no localStorage, and seeding state from it
  // during render would hydrate to different markup.
  useEffect(() => {
    setItems(list());
    setOnline(navigator.onLine);
    return subscribe(setItems);
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Try on load, and periodically for items sitting out a backoff. Thirty
    // seconds is frequent enough to feel prompt and rare enough not to drain a
    // handset that is out of range all morning.
    void flush();
    const timer = window.setInterval(() => void flush(), 30_000);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(timer);
    };
  }, []);

  const blocked = blockedCount(items);
  const waiting = items.length - blocked;

  // Nothing to say when everything is sent and the device is connected.
  if (items.length === 0 && online) return null;

  const tone = blocked > 0 ? 'danger' : !online ? 'warning' : 'accent';

  return (
    <>
      <button
        type="button"
        className={`sync-pill sync-pill-${tone}`}
        onClick={() => setOpen(true)}
        title="Outbox"
      >
        <span className="sync-dot" aria-hidden="true" />
        <span className="hide-on-phone">
          {blocked > 0
            ? `${blocked} not sent`
            : !online
              ? items.length > 0
                ? `Offline · ${items.length} waiting`
                : 'Offline'
              : `${waiting} sending`}
        </span>
        <span className="show-on-phone">{items.length || ''}</span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Outbox"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || items.length === 0}
              onClick={async () => {
                setBusy(true);
                for (const item of items) retryNow(item.id);
                await flush();
                setBusy(false);
              }}
            >
              {busy ? 'Trying…' : 'Try all now'}
            </button>
          </>
        }
      >
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div className={`notice notice-${online ? 'info' : 'warning'}`}>
            {online
              ? 'Connected. Anything waiting will be sent automatically.'
              : 'No connection. Work is held here and sent when the signal returns.'}
          </div>

          {items.length === 0 ? (
            <p className="muted">Nothing waiting. Everything has been sent.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="outbox-item">
                <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="list-title">{item.label}</div>
                    <div className="faint">
                      Queued{' '}
                      {new Date(item.createdAt).toLocaleTimeString('en-NG', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {item.attempts > 0
                        ? ` · ${item.attempts} attempt${item.attempts === 1 ? '' : 's'}`
                        : ''}
                    </div>
                  </div>
                  <span
                    className={`badge ${
                      item.state === 'blocked'
                        ? 'badge-danger'
                        : item.state === 'sending'
                          ? 'badge-accent'
                          : 'badge-warning'
                    }`}
                  >
                    {item.state === 'blocked' ? 'not sent' : item.state}
                  </span>
                </div>

                {item.lastError ? (
                  <p className="faint" style={{ marginTop: 6 }}>
                    {item.lastError}
                  </p>
                ) : null}

                <div className="row" style={{ marginTop: 10, gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      retryNow(item.id);
                      await flush();
                    }}
                  >
                    Retry now
                  </button>
                  {/*
                    Discard is deliberately plain rather than prominent, and
                    named for what it does. It throws away a worker's round;
                    it should never be the easy button.
                  */}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Discard this entry? It has not been saved anywhere and cannot be recovered.',
                        )
                      ) {
                        remove(item.id);
                      }
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Sheet>
    </>
  );
}
