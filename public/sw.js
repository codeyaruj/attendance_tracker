const CACHE_VERSION = "v4";
const SHELL_CACHE = `attendsafe-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `attendsafe-static-${CACHE_VERSION}`;
const OCR_CACHE = `attendsafe-ocr-${CACHE_VERSION}`;
const OWNED_CACHE_PREFIXES = [
  "attendsafe-shell-",
  "attendsafe-static-",
  "attendsafe-ocr-",
];
const ACTIVE_CACHES = new Set([SHELL_CACHE, STATIC_CACHE, OCR_CACHE]);
const APP_ROUTES = new Set([
  "/",
  "/today/",
  "/dashboard/",
  "/timetable/",
  "/skip-planner/",
  "/history/",
  "/settings/",
]);
const INSTALL_SHELL = [
  "/",
  "/today/",
  "/dashboard/",
  "/timetable/",
  "/skip-planner/",
  "/history/",
  "/settings/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
];

function ownedCache(name) {
  return OWNED_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function appRoute(pathname) {
  if (APP_ROUTES.has(pathname)) return pathname;
  const withSlash = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return APP_ROUTES.has(withSlash) ? withSlash : undefined;
}

function immutableAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/fonts/")
  );
}

function ocrAsset(pathname) {
  return pathname.startsWith("/ocr-assets/");
}

function safeResponse(response) {
  if (response.status !== 200 || response.type === "opaque") return false;
  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  const disposition =
    response.headers.get("content-disposition")?.toLowerCase() ?? "";
  return (
    !cacheControl.includes("no-store") &&
    !cacheControl.includes("private") &&
    !disposition.includes("attachment")
  );
}

async function putIfSafe(cacheName, request, response) {
  if (!safeResponse(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

async function cacheInstallShell() {
  const shell = await caches.open(SHELL_CACHE);
  const staticCache = await caches.open(STATIC_CACHE);
  for (const path of INSTALL_SHELL) {
    const response = await fetch(path, { cache: "reload" });
    if (!safeResponse(response)) throw new Error(`Could not cache ${path}`);
    await shell.put(path, response.clone());
    if (response.headers.get("content-type")?.includes("text/html")) {
      const html = await response.text();
      for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        const asset = new URL(match[1], self.location.origin);
        if (asset.origin !== self.location.origin || !immutableAsset(asset.pathname)) {
          continue;
        }
        const assetResponse = await fetch(asset.href, { cache: "reload" });
        if (safeResponse(assetResponse)) {
          await staticCache.put(asset.href, assetResponse);
        }
      }
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheInstallShell().then(() => {
      if (!self.registration.active) return self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => ownedCache(name) && !ACTIVE_CACHES.has(name))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirstNavigation(request, route) {
  try {
    const response = await fetch(request);
    await putIfSafe(SHELL_CACHE, route, response);
    return response;
  } catch {
    return (await caches.match(route)) || (await caches.match("/"));
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putIfSafe(cacheName, request, response);
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (
    url.protocol === "blob:" ||
    url.protocol === "data:" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.includes("backup") ||
    url.pathname.includes("attachment")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    const route = appRoute(url.pathname);
    if (route) event.respondWith(networkFirstNavigation(request, route));
    return;
  }
  if (immutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (ocrAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, OCR_CACHE));
    return;
  }
  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === "CLEAR_APP_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names.filter((name) => ownedCache(name)).map((name) => caches.delete(name)),
          ),
        )
        .then(() => event.source?.postMessage({ type: "APP_CACHES_CLEARED" })),
    );
  }
});
