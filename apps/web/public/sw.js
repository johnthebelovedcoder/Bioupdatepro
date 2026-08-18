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
 *   NAVIGATION  network first with a short timeout, falling back to the last
 *               copy of that page, then to /offline. Network first matters: a
 *               cached round showing yesterday's population would be worse than
 *               a slow one showing today's, so the cache is a fallback and
 *               never a shortcut.
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

const VERSION = 'bap-v1';
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
 * Try the network, briefly, then fall back to what we have.
 *
 * The timeout is the important part. Without it a handset with one bar sits on
 * a white screen until the request eventually fails, which is worse than
 * showing a page from an hour ago — a worker standing in a pen would rather
 * have the form than a spinner.
 */
async function networkFirst(request) {
  const cache = await caches.open(PAGES);

  try {
    const response = await withTimeout(fetch(request), 3500);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    const offline = await cache.match('/offline');
    if (offline) return offline;

    return new Response('You are offline and this page has not been opened before.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
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
