// sw.js — offline service worker (network-first for app files so updates always
// load when online; cache-first only for the big static CDN model/wasm).
const CACHE = "okc-offline-v3";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));  // purge old cache
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // network-first: always try to get the latest app file; fall back to cache offline.
    // cache:"no-cache" makes the browser REVALIDATE (cheap 304 when unchanged) instead of trusting
    // its HTTP cache — GitHub Pages sends max-age=600, which otherwise kept stale files for 10 min.
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res.ok) { const cache = await caches.open(CACHE); cache.put(req, res.clone()); }
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        if (hit) return hit;
        throw err;
      }
    })());
  } else {
    // cache-first: large static CDN assets (MediaPipe wasm + pose model)
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        const again = await caches.match(req);
        if (again) return again;
        throw err;
      }
    })());
  }
});
