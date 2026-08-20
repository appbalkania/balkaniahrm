const CACHE_NAME = "balkania-v3";
const PRECACHE_URLS = ["/", "/manifest.webmanifest", "/icon.png", "/icon-white.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for same-origin GETs: always try the latest deploy first, and
// only fall back to the cached copy when offline. Cross-origin requests (the
// Supabase API) and non-GET requests (RPC calls, auth) are left untouched —
// the Cache API can't store non-GET responses, and these should never be
// served stale anyway.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
