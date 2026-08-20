const CACHE_NAME = "airferry-lite-v79";
const WASM_CACHE = "airferry-lite-wasm";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./vendor/jsQR.js","./receiver-storage.js","./decoder-worker.js","./highspeed-decoder-worker.js","./protocol.js","./highspeed-protocol.js","./vendor/decimen/decoder-worker.js","./vendor/decimen/multi-decoder-worker.js","./vendor/decimen/highspeed-decoder-worker.js","./vendor/decimen/zxing_reader-EOacYbLr.wasm"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.filter((path) => !path.endsWith(".wasm")))).then(() => self.skipWaiting())
  );
});

async function rememberWasm(request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(WASM_CACHE);
  await cache.put(request, response.clone());
}

async function matchWasm(request) {
  const cache = await caches.open(WASM_CACHE);
  return (await cache.match(request)) || (await cache.match(request.url));
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    for (const key of keys) {
      if (key === CACHE_NAME || key === WASM_CACHE) continue;
      const old = await caches.open(key);
      const reqs = await old.keys();
      for (const req of reqs) {
        if (!new URL(req.url).pathname.endsWith(".wasm")) continue;
        const res = await old.match(req);
        if (res) await rememberWasm(req, res);
      }
      await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const path = new URL(event.request.url).pathname;
  if (path.endsWith(".wasm")) {
    event.respondWith((async () => {
      const cached = await matchWasm(event.request);
      if (cached) return cached;
      const fallback = await caches.match(event.request);
      if (fallback) {
        rememberWasm(event.request, fallback);
        return fallback;
      }
      const response = await fetch(event.request);
      rememberWasm(event.request, response);
      return response;
    })());
    return;
  }
  const isWorker = path.includes("worker");
  if (isWorker) {
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
