/* The console's shell, cached so it opens without waiting on the network.

   Nothing from the admin APIs is ever cached: a stale device list is worse
   than no list, and these responses carry invite codes. Only the four static
   files are, and they are re-fetched on every activation. */
'use strict';
const VERSION = '__BUILD_VERSION__';
const CACHE = 'console-' + VERSION;
const SHELL = ['./', 'index.html', 'admin.css', 'console.css', 'console.js',
               'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('console-') && k !== CACHE)
                          .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Everything the console actually administers goes straight to the network.
  if (url.pathname.includes('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req) || await cache.match('./');
      if (hit) return hit;
      throw err;
    }
  })());
});
