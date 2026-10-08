const CACHE_NAME = "qr-profesores-v1";
const OFFLINE_URL = "/offline";
const APP_ASSETS = [
  OFFLINE_URL,
  "/static/css/style.css",
  "/static/css/offline.css",
  "/static/js/offline.js",
  "/static/js/pwa.js",
  "/static/icons/app.svg",
  "/static/manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok || response.type === "opaque") {
            await cache.put(request, response.clone());
          }
          return response;
        } catch (error) {
          const offlineCopy = await cache.match(request);
          if (offlineCopy) return offlineCopy;
          throw error;
        }
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedOfflinePage = await caches.match(OFFLINE_URL);
        if (cachedOfflinePage) return cachedOfflinePage;
        return new Response("Sin conexión. Abre Modo sin conexión.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(request).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error(`No hay una copia offline para ${url.pathname}`);
    })
  );
});
