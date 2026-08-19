const CACHE_NAME = "airferry-lite-v33";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./vendor/jsQR.js","./receiver-storage.js","./decoder-worker.js","./highspeed-decoder-worker.js","./protocol.js","./highspeed-protocol.js","./vendor/decimen/decoder-worker.js","./vendor/decimen/multi-decoder-worker.js","./vendor/decimen/highspeed-decoder-worker.js","./vendor/decimen/zxing_reader-EOacYbLr.wasm"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const path = new URL(event.request.url).pathname;
  const isWasmOrWorker = path.endsWith(".wasm") || path.includes("worker");
  if (isWasmOrWorker) {
    event.respondWith(caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }));
    return;
  }
  event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
