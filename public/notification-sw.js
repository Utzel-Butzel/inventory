/* global clients */

const OFFLINE_CACHE_PREFIX = "open-inventory-offline";
const OFFLINE_CACHE_VERSION = "v1";
const ASSET_CACHE = `${OFFLINE_CACHE_PREFIX}-assets-${OFFLINE_CACHE_VERSION}`;
const PAGE_CACHE = `${OFFLINE_CACHE_PREFIX}-pages-${OFFLINE_CACHE_VERSION}`;
const STATE_CACHE = `${OFFLINE_CACHE_PREFIX}-state`;
const STATE_URL = new URL("/__open-inventory-offline-state__", self.location.origin).href;
const OFFLINE_FALLBACK_URL = "/offline.html";
const MAX_ASSET_ENTRIES = 120;
const MAX_PAGE_ENTRIES = 30;

let statePromise;

function defaultState() {
  return { enabled: false, ownerKey: null };
}

async function readOfflineState() {
  try {
    const cache = await caches.open(STATE_CACHE);
    const response = await cache.match(STATE_URL);
    if (!response) return defaultState();
    const state = await response.json();
    return {
      enabled: state.enabled === true,
      ownerKey: typeof state.ownerKey === "string" ? state.ownerKey : null,
    };
  } catch {
    return defaultState();
  }
}

function getOfflineState() {
  statePromise ??= readOfflineState();
  return statePromise;
}

async function writeOfflineState(state) {
  const normalized = {
    enabled: state.enabled === true,
    ownerKey: typeof state.ownerKey === "string" ? state.ownerKey : null,
  };
  const cache = await caches.open(STATE_CACHE);
  await cache.put(
    STATE_URL,
    new Response(JSON.stringify(normalized), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  statePromise = Promise.resolve(normalized);
  return normalized;
}

function isExcludedPath(pathname) {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/openapi") ||
    pathname === OFFLINE_FALLBACK_URL
  );
}

function canCacheResponse(response) {
  return response.ok && !response.redirected && response.type !== "opaque";
}

function canCachePage(response) {
  if (!canCacheResponse(response)) return false;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return false;
  try {
    const responseUrl = new URL(response.url);
    return responseUrl.origin === self.location.origin && !isExcludedPath(responseUrl.pathname);
  } catch {
    return false;
  }
}

async function trimCache(cache, maximumEntries, preservedUrls = []) {
  const preserved = new Set(
    preservedUrls.map((url) => new URL(url, self.location.origin).href),
  );
  const keys = await cache.keys();
  const removable = keys.filter((request) => !preserved.has(request.url));
  const excess = Math.max(0, keys.length - maximumEntries);
  await Promise.all(removable.slice(0, excess).map((request) => cache.delete(request)));
}

async function putInCache(cacheName, request, response, maximumEntries) {
  if (!canCacheResponse(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  await trimCache(
    cache,
    maximumEntries,
    cacheName === PAGE_CACHE ? [OFFLINE_FALLBACK_URL] : [],
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (canCacheResponse(response)) {
    await putInCache(ASSET_CACHE, request, response.clone(), MAX_ASSET_ENTRIES);
  }
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (canCacheResponse(response)) {
      await putInCache(ASSET_CACHE, request, response.clone(), MAX_ASSET_ENTRIES);
    }
    return response;
  });

  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

async function networkFirstNavigation(event, request) {
  const pageCache = await caches.open(PAGE_CACHE);

  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded ?? (await fetch(request));
    if (canCachePage(response)) {
      event.waitUntil(
        putInCache(PAGE_CACHE, request, response.clone(), MAX_PAGE_ENTRIES),
      );
    }
    return response;
  } catch {
    const cached =
      (await pageCache.match(request)) ??
      (await pageCache.match(request, { ignoreSearch: true })) ??
      (await pageCache.match(OFFLINE_FALLBACK_URL));
    if (cached) return cached;
    return Response.error();
  }
}

async function cacheOfflineFallback() {
  const cache = await caches.open(PAGE_CACHE);
  if (await cache.match(OFFLINE_FALLBACK_URL)) return;

  const response = await fetch(OFFLINE_FALLBACK_URL, { cache: "reload" });
  if (canCacheResponse(response)) {
    await cache.put(OFFLINE_FALLBACK_URL, response);
  }
}

async function warmOfflineResources(warmUrl) {
  const assetUrls = ["/icon.svg", "/manifest.webmanifest"];
  await Promise.allSettled(
    assetUrls.map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      if (canCacheResponse(response)) {
        await putInCache(ASSET_CACHE, url, response, MAX_ASSET_ENTRIES);
      }
    }),
  );

  if (!warmUrl) return;
  try {
    const url = new URL(warmUrl, self.location.origin);
    if (url.origin !== self.location.origin || isExcludedPath(url.pathname)) return;
    const request = new Request(url.href, {
      credentials: "include",
      headers: { Accept: "text/html" },
    });
    const response = await fetch(request);
    if (canCachePage(response)) {
      await putInCache(PAGE_CACHE, request, response, MAX_PAGE_ENTRIES);
    }
  } catch {
    // The fallback is still available if the current page could not be warmed.
  }
}

async function deleteOfflineContentCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter(
        (name) =>
          name.startsWith(`${OFFLINE_CACHE_PREFIX}-assets-`) ||
          name.startsWith(`${OFFLINE_CACHE_PREFIX}-pages-`),
      )
      .map((name) => caches.delete(name)),
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(`${OFFLINE_CACHE_PREFIX}-assets-`) ||
              name.startsWith(`${OFFLINE_CACHE_PREFIX}-pages-`),
          )
          .filter((name) => name !== ASSET_CACHE && name !== PAGE_CACHE)
          .map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) {
        const state = await getOfflineState();
        if (state.enabled) {
          await self.registration.navigationPreload.enable();
        } else {
          await self.registration.navigationPreload.disable();
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "OPEN_INVENTORY_OFFLINE_CONFIG") return;

  const replyPort = event.ports?.[0];
  event.waitUntil(
    (async () => {
      const enabled = event.data.enabled === true;
      const ownerKey =
        enabled && typeof event.data.ownerKey === "string"
          ? event.data.ownerKey
          : null;
      const previous = await getOfflineState();

      if (!enabled) {
        await writeOfflineState(defaultState());
        await deleteOfflineContentCaches();
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.disable();
        }
        replyPort?.postMessage({ ok: true, enabled: false });
        return;
      }

      if (previous.ownerKey && previous.ownerKey !== ownerKey) {
        await caches.delete(PAGE_CACHE);
      }
      await writeOfflineState({ enabled: true, ownerKey });
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await cacheOfflineFallback();
      replyPort?.postMessage({ ok: true, enabled: true });
      await warmOfflineResources(event.data.warmUrl);
    })().catch((error) => {
      replyPort?.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : "Offline setup failed.",
      });
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isExcludedPath(url.pathname)) return;
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  const isNavigation = request.mode === "navigate";
  const isImmutableAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/barcodes/");
  const isRuntimeAsset =
    url.pathname.startsWith("/_next/image") ||
    ["font", "image", "script", "style", "worker"].includes(request.destination);

  if (!isNavigation && !isImmutableAsset && !isRuntimeAsset) return;

  event.respondWith(
    (async () => {
      const state = await getOfflineState();
      if (!state.enabled) return fetch(request);
      if (isNavigation) return networkFirstNavigation(event, request);
      if (isImmutableAsset) return cacheFirst(request);
      return staleWhileRevalidate(event, request);
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Inventory";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "You have a new inventory notification.",
      tag: "inventory-notification-digest",
      renotify: false,
      data: { url: payload.url || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/notifications",
    self.location.origin,
  ).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) =>
        client.url.startsWith(self.location.origin),
      );
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return clients.openWindow(target);
    }),
  );
});
