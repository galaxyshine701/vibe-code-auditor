// Service worker of Vibe Code Auditor. It does ONE thing: when a page cannot be
// loaded because the network is gone, it shows /offline.html.
//
// It never caches a response of the network. It does not touch the API, any
// script or style, any request to another address, or any request that is not
// a page navigation (GET). So no access code, key, audit or finding can end up
// in a cache, and an old deploy can never be served from here.
//
// Redeploy: this file is served with "no-cache", so the browser looks at it on
// every visit. When its bytes change, the new worker installs, takes over at
// once (skipWaiting and clients.claim) and deletes every older cache of this
// kind in "activate". Change CACHE (v1 -> v2) whenever offline.html changes.
// To remove the worker for good, deploy a sw.js that calls
// self.registration.unregister().

const CACHE = 'vca-offline-v1';
const PREFIX = 'vca-offline-';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // the only thing that is ever stored: one static page, fetched fresh
      .then((cache) =>
        cache.add(new Request(OFFLINE_URL, { cache: 'reload', credentials: 'omit' })),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only a page of this site. Everything else goes to the network untouched.
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request).catch(() =>
      caches
        .open(CACHE)
        .then((cache) => cache.match(OFFLINE_URL))
        .then((page) => page || Response.error()),
    ),
  );
});
