const CACHE_NAME = "attendsafe-shell-v3-local-ocr";
const APP_SHELL = [
  "/",
  "/today",
  "/dashboard",
  "/timetable",
  "/skip-planner",
  "/history",
  "/settings",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/ocr-assets/pdf.worker.min.mjs",
  "/ocr-assets/worker.min.js",
  "/ocr-assets/lang/eng.traineddata.gz",
  "/ocr-assets/core/tesseract-core-lstm.wasm.js",
  "/ocr-assets/core/tesseract-core-simd-lstm.wasm.js",
  "/ocr-assets/core/tesseract-core-relaxedsimd-lstm.wasm.js",
];
const CACHEABLE_ASSET_PREFIXES = [
  "/_next/static/",
  "/_vinext/",
  "/assets/",
  "/icons/",
  "/ocr-assets/",
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const discoveredAssets = new Set();

  await Promise.all(
    APP_SHELL.map(async (path) => {
      const response = await fetch(path, { cache: "reload" });
      if (!response.ok) throw new Error(`Could not cache ${path}`);
      await cache.put(path, response.clone());

      if (response.headers.get("content-type")?.includes("text/html")) {
        const html = await response.text();
        for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
          const assetUrl = new URL(match[1], self.location.origin);
          if (assetUrl.origin === self.location.origin) {
            discoveredAssets.add(assetUrl.pathname + assetUrl.search);
          }
        }
      }
    }),
  );

  await Promise.allSettled(
    [...discoveredAssets].map(async (path) => {
      const response = await fetch(path, { cache: "reload" });
      if (response.ok) await cache.put(path, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/"))),
    );
    return;
  }

  if (!CACHEABLE_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || "/today"));
});
