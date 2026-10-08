// Minimal service worker: it only makes the static /offline page (and the static assets it needs) available
// without a network. It deliberately does NOT cache API responses or any page that can show a user's data:
//   - /api/* and /s/* (share links) are never touched; the browser handles them as if there were no worker.
//   - Navigations go to the network as normal; only if the network fails is the cached /offline page shown.
//   - Only the /offline shell, /_next/static/* assets and /icons/* are ever written to the cache.
// Only caches whose name starts with the prefix are ever deleted; bump the version suffix to drop older shells.
const CACHE_PREFIX = "rtpp-offline-";
const CACHE = CACHE_PREFIX + "v2";
const OFFLINE_URL = "/offline";
const MAX_STATIC_ENTRIES = 200;

const isStaticAsset = (path) => path.startsWith("/_next/static/") || path.startsWith("/icons/");

// Caching is best effort: a failed write (quota, eviction) must never break the live response.
const quietly = (promise) => Promise.resolve(promise).catch(() => {});

// Stores the /offline shell plus the assets it references, then trims old build assets. Throws if the shell is unavailable.
async function precacheShell(cache) {
  const res = await fetch(OFFLINE_URL, { credentials: "omit" });
  if (!res.ok || res.redirected) throw new Error("offline page unavailable");
  const html = await res.clone().text();
  await cache.put(OFFLINE_URL, res);
  // The assets the shell references, so it can render without a network.
  const assets = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"#]+)/g)) assets.add(m[1]);
  await Promise.all([...assets].map((a) => cache.add(a).catch(() => {})));
  await pruneStatic(cache, assets);
}

// Keeps at most MAX_STATIC_ENTRIES /_next/static entries: the current shell's assets stay, the oldest others go first.
async function pruneStatic(cache, keep) {
  const entries = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith("/_next/static/"));
  let excess = entries.length - MAX_STATIC_ENTRIES;
  for (const r of entries) {
    if (excess <= 0) break;
    if (keep.has(new URL(r.url).pathname)) continue;
    await cache.delete(r);
    excess--;
  }
}

// The shell's asset URLs change with every deploy, so it is refreshed in the background: on activate and after the
// first successful online navigation of a session.
let refreshedThisSession = false;
function refreshShell() {
  return quietly(
    (async () => {
      await precacheShell(await caches.open(CACHE));
    })(),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheShell(await caches.open(CACHE));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
      refreshedThisSession = true;
      await refreshShell();
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
        .then((res) => {
          if (path === OFFLINE_URL) {
            // Visiting the shell itself refreshes the cached shell (its asset URLs change between deploys); no other page is stored.
            if (res.ok && !res.redirected) {
              const copy = res.clone();
              event.waitUntil(quietly(caches.open(CACHE).then((cache) => cache.put(OFFLINE_URL, copy))));
            }
          } else if (res.ok && !refreshedThisSession) {
            refreshedThisSession = true;
            event.waitUntil(refreshShell());
          }
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
        .then((res) => {
          if (res.ok && res.type !== "opaque") {
            const copy = res.clone();
            event.waitUntil(quietly(caches.open(CACHE).then((cache) => cache.put(request, copy))));
          }
          return res;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: isStaticAsset(path) })) ?? Response.error()),
    );
  }
});
