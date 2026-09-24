/*
 * The inbox.
 *
 * The outbox already holds work that cannot be sent. This is the other half:
 * being able to OPEN the app at all with no signal. Every page in this product
 * is server-rendered, so a navigation with no connection reaches nothing and
 * the worker gets a browser error page — they cannot even see which houses
 * exist, let alone record anything.
 *
 * Strategies, chosen per request type:
 *
 *   NAVIGATION  network first, falling back to the last copy of that page,
 *               then to /offline. Network first matters: a cached round
 *               showing yesterday's population would be worse than a slow one
 *               showing today's, so the cache is a fallback and never a
 *               shortcut. A saved copy is served straight away only when the
 *               phone reports no connection at all; with a connection the
 *               network gets a generous timeout, because a slow server is not
 *               an offline one. (The first version gave up after 3.5s, and on
 *               a free-tier server that routinely meant a months-old ledger
 *               page shown to someone who was online — 2026-09-24.) Every
 *               saved copy is served with a banner saying when it was saved.
 *
 *   BUILD ASSETS  cache first. Next fingerprints these filenames, so a given
 *               URL's content never changes and revalidating is wasted time on
 *               a bad connection.
 *
 *   THE API     never cached. Every call is authenticated or a write, and a
 *               stale authenticated response is a security problem rather than
 *               a convenience.
 *
 * A note on shared phones, which are common on farms: cached pages are cleared
 * on sign-out (see `clear-cache` below), because a cached page rendered for one
 * worker must never be served to the next person who picks up the handset.
 */

// v2: copies saved by v1 carry no saved-at time and may be a login page saved
// under another page's address, so they are dropped on activation.
const VERSION = 'bap-v2';
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;

/** Worth having available before it is needed. */
const PRECACHE = ['/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll(PRECACHE))
      // A failed precache must not block activation — the app still works
      // online, and the fallback simply will not be there.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  // Sent on sign-out. A shared handset must not show one worker's pages to the
  // next person who picks it up.
  if (event.data === 'clear-cache') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET is cacheable, and only our own origin.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch the API. Authenticated responses and writes both belong to the
  // network alone.
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSETS);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Try the network, then fall back to what we have.
 *
 * With no connection at all there is nothing to wait for, so the saved copy is
 * served at once. With one, the network gets up to 20s: a handset with one
 * bar should not sit on a white screen forever, but a server that takes a few
 * seconds to render must not be mistaken for no signal.
 */
async function networkFirst(request) {
  const cache = await caches.open(PAGES);

  try {
    if (self.navigator.onLine === false) throw new Error('offline');
    const response = await withTimeout(fetch(request), 20000);
    // A redirect (an expired session sent to /login) is not this page, and
    // saving it would show the sign-in screen as this page's offline copy.
    if (response.ok && !response.redirected) cache.put(request, await stamped(response.clone()));
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return labelled(cached);

    const offline = await cache.match('/offline');
    if (offline) return offline;

    return new Response('You are offline and this page has not been opened before.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Keep a copy of the page with the time it was saved. */
async function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set('x-bap-saved-at', new Date().toISOString());
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

/**
 * Serve a saved page with a banner across the top saying so, and when it was
 * saved. Figures on a saved page can be out of date; nobody should have to
 * guess whether what they are reading is live.
 */
async function labelled(cached) {
  const type = cached.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return cached;

  const savedAt = cached.headers.get('x-bap-saved-at');
  const when = savedAt
    ? new Date(savedAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
    : 'an earlier visit';
  const banner =
    '<div role="status" style="position:sticky;top:0;z-index:9999;padding:8px 16px;' +
    'background:#8a5a00;color:#fff;font:600 14px/1.4 system-ui,sans-serif;text-align:center">' +
    `No connection — this is a saved copy from ${when}. Figures may be out of date.</div>`;

  const html = await cached.text();
  const bodyOpen = /<body[^>]*>/i.exec(html);
  const body = bodyOpen
    ? html.slice(0, bodyOpen.index + bodyOpen[0].length) + banner + html.slice(bodyOpen.index + bodyOpen[0].length)
    : banner + html;
  const headers = new Headers(cached.headers);
  headers.delete('content-length');
  return new Response(body, { status: cached.status, statusText: cached.statusText, headers });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
