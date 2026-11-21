'use client';

import { useEffect } from 'react';

// Registers the small service worker (public/sw.js) that only shows
// /offline.html when a page cannot be loaded (R59). Only in a production
// build, so a development server never serves anything from a worker.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // The app works the same without it.
      });
  }, []);

  return null;
}
