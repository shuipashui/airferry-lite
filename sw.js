self.addEventListener("install",event=>event.waitUntil(caches.open("airferry-lite-v1").then(cache=>cache.addAll(["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./vendor/jsQR.js","./protocol.js"]))));
self.addEventListener("fetch",event=>event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request))));
