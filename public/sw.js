// Minimal service worker: it only makes the static /offline page (and the static assets it needs) available
// without a network. It deliberately does NOT cache API responses or any page that can show a user's data:
//   - /api/* and /s/* (share links) are never touched; the browser handles them as if there were no worker.
//   - Navigations go to the network as normal; only if the network fails is the cached /offline page shown.
//   - Only the /offline shell, /_next/static/* assets and /icons/* are ever written to the cache.
const CACHE = "rtpp-offline-v1";
const OFFLINE_URL = "/offline";

const isStaticAsset = (path) => path.startsWith("/_next/static/") || path.startsWith("/icons/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch(OFFLINE_URL, { credentials: "omit" });
      if (!res.ok) throw new Error("offline page unavailable");
      const html = await res.clone().text();
      await cache.put(OFFLINE_URL, res);
      // The assets the shell references, so it can render without a network.
      const assets = new Set();
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"#]+)/g)) assets.add(m[1]);
      await Promise.all([...assets].map((a) => cache.add(a).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith("/api/") || path.startsWith("/s/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (res) => {
          // Visiting the shell itself refreshes the cached shell (its asset URLs change between deploys); no other page is stored.
          if (path === OFFLINE_URL && res.ok && !res.redirected) await (await caches.open(CACHE)).put(OFFLINE_URL, res.clone());
          return res;
        })
        .catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  if (path === OFFLINE_URL || isStaticAsset(path)) {
    // Network first (hashed assets never change, and in dev they do), cache as the fallback.
    event.respondWith(
      fetch(request)
        .then(async (res) => {
          if (res.ok && res.type !== "opaque") {
            const copy = res.clone();
            const cache = await caches.open(CACHE);
            await cache.put(request, copy);
          }
          return res;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: isStaticAsset(path) })) ?? Response.error()),
    );
  }
});
