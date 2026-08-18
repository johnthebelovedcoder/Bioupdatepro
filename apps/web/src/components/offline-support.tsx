'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Registers the service worker, and tells the user when they are reading a
 * cached page rather than a live one.
 *
 * The banner is the honest half. A page served from cache with no signal looks
 * exactly like a live one, and a worker acting on a population count from
 * yesterday morning would be making a decision on a figure the product let them
 * believe was current.
 */
export function OfflineSupport() {
  const [offline, setOffline] = useState(false);
  const banner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Dev builds change on every edit, and a cached shell would serve stale
    // code back. Only register where the pages are stable.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // No service worker means no offline reads. The app still works; it
        // just needs a connection, which is the behaviour without this file.
      });
    }

    setOffline(!navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  /*
   * The banner is fixed, so the sticky header has to be pushed clear of it by
   * exactly its height. That height is not a constant: it wraps to three lines
   * on a phone and to one on a desktop, and the translated copy is longer again
   * in Hausa. Measuring it is the only version of this that stays correct.
   */
  useEffect(() => {
    const el = banner.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty('--offline-banner-h');
      return;
    }

    const observer = new ResizeObserver(() => {
      root.style.setProperty('--offline-banner-h', `${el.offsetHeight}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--offline-banner-h');
    };
  }, [offline]);

  if (!offline) return null;

  return (
    <div className="offline-banner" role="status" ref={banner}>
      No signal — this is a saved copy, so figures may have changed. What you record is
      kept on this phone and sent when the signal returns.
    </div>
  );
}
