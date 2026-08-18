/**
 * The outbox.
 *
 * A farm worker finishes a round in a pen with no signal. The round must not be
 * lost, must not be sent twice when the signal returns, and must not be
 * reported as saved until it actually is. That is what this queue is for.
 *
 * Four properties matter, in this order:
 *
 *   1. DURABLE. Items survive a reload, a crash and a dead battery, because the
 *      alternative is walking the round again.
 *   2. IDEMPOTENT. The key is generated ONCE, when the item is queued, and
 *      reused on every retry for as long as the item exists. Generating it at
 *      send time would defeat the entire purpose — a retry after a timeout
 *      whose request actually landed would post the round twice, and in a
 *      double-entry system that is a real, visible error in the accounts.
 *   3. ORDERED AND SERIAL. One item in flight at a time, oldest first. A burst
 *      of parallel posts is how duplicates and out-of-order postings happen.
 *   4. HONEST. Nothing is removed from the queue until the server has confirmed
 *      it. An item that cannot be sent stays visible and says why.
 *
 * Deliberately not a service worker with Background Sync: that adds a second
 * lifecycle to reason about, and this queue has to work when the page is open,
 * which is when a worker is actually using it. Background Sync is an addition
 * later, not the foundation.
 */

const STORAGE_KEY = 'bap.sync.queue';

export type QueueState =
  /** Waiting to be sent, or waiting out a backoff. */
  | 'pending'
  /** In flight right now. */
  | 'sending'
  /** Send failed for a reason that might pass — offline, timeout, server error. */
  | 'failed'
  /** Send failed for a reason retrying cannot fix. Needs a person. */
  | 'blocked';

export interface QueueItem {
  /**
   * The idempotency key AND the item's identity. Generated once at enqueue and
   * never regenerated — see property 2 above.
   */
  id: string;
  /**
   * What is waiting. The outbox is something a worker reads when a send is
   * stuck, so "sale" and "treatment" have to be distinguishable there — they
   * were all filed as daily rounds until each writer was given its own name.
   */
  kind:
    | 'daily-round'
    | 'sale'
    | 'purchase'
    | 'new-group'
    | 'treatment'
    | 'harvest'
    | 'stage-change';
  /** Human summary, so the queue is readable without decoding the payload. */
  label: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  state: QueueState;
  lastError?: string;
  /** Epoch milliseconds. Not attempted before this. */
  nextAttemptAt?: number;
}

export interface SendResult {
  ok: boolean;
  /** False means retrying will not help; the item is blocked for a person. */
  retryable?: boolean;
  message?: string;
}

/* -------------------------------------------------------------------------- */

type Listener = (items: QueueItem[]) => void;
const listeners = new Set<Listener>();

function read(): QueueItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  } catch {
    // A corrupt queue must not take the app down. Better an empty outbox the
    // user can see than a white screen.
    return [];
  }
}

function write(items: QueueItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded or private browsing. Nothing useful to do here, and
    // throwing would lose the caller's work as well as the backup.
  }
  for (const listener of listeners) listener(items);
}

/**
 * Read, change, write — re-reading inside the mutation rather than working from
 * a snapshot, so a second tab's writes are not silently clobbered.
 */
function mutate(change: (items: QueueItem[]) => QueueItem[]): QueueItem[] {
  const next = change(read());
  write(next);
  return next;
}

export function list(): QueueItem[] {
  return read();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Another tab writing to the same key fires `storage` here, so two open tabs
  // agree about what is still waiting to go.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener(read());
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function enqueue(input: {
  kind: QueueItem['kind'];
  label: string;
  payload: unknown;
}): QueueItem {
  const item: QueueItem = {
    id: newKey(),
    kind: input.kind,
    label: input.label,
    payload: input.payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    state: 'pending',
  };
  mutate((items) => [...items, item]);
  return item;
}

export function remove(id: string): void {
  mutate((items) => items.filter((item) => item.id !== id));
}

/** Clears a backoff and un-blocks an item, so "Retry now" means now. */
export function retryNow(id: string): void {
  mutate((items) =>
    items.map((item) =>
      item.id === id
        ? { ...item, state: 'pending', nextAttemptAt: undefined, lastError: undefined }
        : item,
    ),
  );
}

export function pendingCount(items: QueueItem[] = read()): number {
  return items.filter((item) => item.state !== 'blocked').length;
}

export function blockedCount(items: QueueItem[] = read()): number {
  return items.filter((item) => item.state === 'blocked').length;
}

/* -------------------------------------------------------------------------- */

let flushing = false;

/**
 * Send what is due, oldest first, one at a time.
 *
 * Stops at the first retryable failure rather than working through the rest:
 * if the connection is down, every remaining item would fail too, and burning
 * their attempt counters would push them all into long backoffs for no reason.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  flushing = true;
  try {
    for (;;) {
      const now = Date.now();
      const next = read().find(
        (item) =>
          (item.state === 'pending' || item.state === 'failed') &&
          (item.nextAttemptAt ?? 0) <= now,
      );
      if (!next) return;

      mutate((items) =>
        items.map((item) => (item.id === next.id ? { ...item, state: 'sending' } : item)),
      );

      const result = await send(next);

      if (result.ok) {
        // Only now is it safe to forget. Removing on send rather than on
        // confirmation is how queues lose data.
        mutate((items) => items.filter((item) => item.id !== next.id));
        continue;
      }

      const attempts = next.attempts + 1;
      const retryable = result.retryable !== false;

      mutate((items) =>
        items.map((item) =>
          item.id === next.id
            ? {
                ...item,
                attempts,
                state: retryable ? 'failed' : 'blocked',
                ...(result.message ? { lastError: result.message } : {}),
                ...(retryable ? { nextAttemptAt: Date.now() + backoffMs(attempts) } : {}),
              }
            : item,
        ),
      );

      if (retryable) return;
      // A blocked item needs a person; carry on with the rest of the queue.
    }
  } finally {
    flushing = false;
  }
}

/**
 * Exponential backoff with jitter, capped at fifteen minutes.
 *
 * The jitter matters on a farm: several handsets regain signal at the same
 * moment when someone walks back into range, and without it they would all
 * retry in the same instant.
 */
function backoffMs(attempts: number): number {
  const base = Math.min(5_000 * 2 ** (attempts - 1), 15 * 60_000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Older WebViews are common on the handsets this is aimed at.
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* -------------------------------------------------------------------------- */

/**
 * The transport.
 *
 * Posts to this app's own /api/sync rather than to the API directly, and it has
 * to: the session token is an httpOnly cookie that script cannot read, so a
 * browser fetch to the API on another origin would carry no credential at all.
 * Same-origin means the cookie rides along, and the route handler on the other
 * side attaches the bearer and forwards. See app/api/sync/route.ts.
 *
 * The `kind` goes in the body because the route maps it to an endpoint from a
 * fixed list — the client does not get to name the path it is proxied to.
 */
async function send(item: QueueItem): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The server uses this to reject a replay. Same key on every attempt.
        'idempotency-key': item.id,
      },
      body: JSON.stringify({ kind: item.kind, payload: item.payload }),
    });
  } catch {
    return { ok: false, retryable: true, message: 'No connection' };
  }

  // A duplicate is a success: it means an earlier attempt landed and only the
  // response was lost. Treating it as an error would strand the item forever.
  if (response.ok || response.status === 409) return { ok: true };

  if (response.status === 404 || response.status === 501) {
    return {
      ok: false,
      retryable: false,
      message: 'Nothing on the server accepts this yet. It has not been saved.',
    };
  }

  /*
   * The session expired while this sat in the queue. Worth retrying rather than
   * discarding: the worker did the round, and someone will sign in again on
   * this handset. Throwing it away would lose real work over an expiry.
   */
  if (response.status === 401) {
    return { ok: false, retryable: true, message: 'Signed out — sign in to send this' };
  }

  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return { ok: false, retryable: true, message: `Server returned ${response.status}` };
  }

  /*
   * Any other 4xx is the submission's own fault; sending it again unchanged
   * cannot fix it. The API's refusals are the most useful thing it produces —
   * "B-2026-007 already has a round recorded for 2026-08-14" tells the worker
   * what happened, where a bare "Rejected by the server (422)" leaves them
   * staring at a stuck item with nothing to act on.
   */
  return {
    ok: false,
    retryable: false,
    message: (await messageFrom(response)) ?? `Rejected by the server (${response.status})`,
  };
}

/** The message the API sent, if it sent one we can read. */
async function messageFrom(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (Array.isArray(body.message)) return body.message.join(' ');
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
  } catch {
    // Not JSON, or already consumed. The status-based fallback stands.
  }
  return null;
}
