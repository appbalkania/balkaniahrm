self.addEventListener("install", event => event.waitUntil(caches.open("balkania-v1").then(cache => cache.addAll(["/", "/manifest.webmanifest", "/icon.png"]))));
self.addEventListener("fetch", event => event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request))));
