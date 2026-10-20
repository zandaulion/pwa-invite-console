/* The console's shell, cached so it opens without waiting on the network.

   Nothing from the admin APIs is ever cached: a stale device list is worse
   than no list, and these responses carry invite codes. Static shell files
   and app icons are refreshed with each version. */
'use strict';
const VERSION = '__BUILD_VERSION__';
const CACHE = 'console-' + VERSION;
const SHELL = ['./', 'index.html', 'admin.css', 'console.css', 'console.js',
               'apps.json', 'manifest.webmanifest', 'pwa-update.js',
               'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

importScripts('sw-update.js');

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    const apps = await (await c.match('apps.json')).json();
    // An optional icon must not prevent the whole console from updating.
    await Promise.allSettled(apps.filter(app => app.icon?.startsWith('icons/'))
      .map(app => c.add(app.icon)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('console-') && k !== CACHE)
                          .map((k) => caches.delete(k)));
    await self.clients.claim();
    // Tell the open windows rather than reloading them from under whatever
    // the person was doing. Each page decides when it is safe.
    await announceUpdate();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Everything the console actually administers goes straight to the network.
  if (url.pathname.includes('/api/')) return;
  if (!url.href.startsWith(self.registration.scope)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('./') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
