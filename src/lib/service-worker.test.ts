import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Evaluates the real public/sw.js with a fake `self`, so the handler logic that ships is the logic that is tested.
const SOURCE = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://app.test";

type Listener = (event: unknown) => void;

function boot(network: (url: string) => Promise<Response>, cacheNames: string[] = [], dev = false) {
  const listeners: Record<string, Listener> = {};
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const cache = {
    put: vi.fn(async (req: string | Request, res: Response) => {
      const key = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
      puts.push(new URL(key).pathname);
      store.set(key, res);
    }),
    add: vi.fn(async () => {}),
    match: vi.fn(async (req: string | Request) => store.get(typeof req === "string" ? new URL(req, ORIGIN).href : req.url)),
    keys: vi.fn(async () => [...store.keys()].map((url) => ({ url }))),
    delete: vi.fn(async (req: { url: string }) => store.delete(req.url)),
  };
  const deletedCaches: string[] = [];
  const fetchFn = vi.fn((req: string | Request) => network(typeof req === "string" ? new URL(req, ORIGIN).href : req.url));
  const sandbox = {
    self: {
      location: { origin: ORIGIN, href: `${ORIGIN}/sw.js${dev ? "?dev=1" : ""}` },
      addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      match: async (req: string | Request) => store.get(typeof req === "string" ? new URL(req, ORIGIN).href : req.url),
      keys: async () => cacheNames,
      delete: async (name: string) => { deletedCaches.push(name); return true; },
    },
    fetch: fetchFn,
    URL, Response, Set, Promise, Error,
  };
  vm.runInNewContext(SOURCE, sandbox);
  store.set(`${ORIGIN}/offline`, new Response("OFFLINE SHELL"));
  function fire(url: string, init: { method?: string; mode?: string } = {}) {
    const respondWith = vi.fn();
    const request = { url: new URL(url, ORIGIN).href, method: init.method ?? "GET", mode: init.mode ?? "no-cors" };
    listeners.fetch({ request, respondWith, waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
    return { respondWith, request };
  }
  const pending: Promise<unknown>[] = [];
  /** Lets the event.waitUntil work (cache writes, refreshes) finish. */
  const settle = async () => { await Promise.all(pending.splice(0)); };
  return { fire, fetchFn, cache, puts, store, listeners, deletedCaches, settle };
}

const ok = () => Promise.resolve(new Response("page", { status: 200 }));
const down = () => Promise.reject(new TypeError("network"));

describe("service worker fetch handler", () => {
  it.each([
    ["/api/trips", "navigate"],
    ["/api/trips", "cors"],
    ["/api/auth/session", "same-origin"],
    ["/s/abc123", "navigate"],
    ["/s/abc123", "cors"],
  ])("leaves %s (%s) untouched", (url, mode) => {
    const sw = boot(ok);
    const { respondWith } = sw.fire(url, { mode });
    expect(respondWith).not.toHaveBeenCalled();
    expect(sw.fetchFn).not.toHaveBeenCalled();
    expect(sw.cache.put).not.toHaveBeenCalled();
  });

  it("passes through non-GET requests, cross-origin requests and non-navigation data fetches", () => {
    const sw = boot(ok);
    expect(sw.fire("/trips/1", { method: "POST", mode: "navigate" }).respondWith).not.toHaveBeenCalled();
    expect(sw.fire("https://api.mapbox.com/styles/v1/x", { mode: "cors" }).respondWith).not.toHaveBeenCalled();
    expect(sw.fire("/trips/1", { mode: "cors" }).respondWith).not.toHaveBeenCalled();
    expect(sw.fire("/trips/1?_rsc=abc", { mode: "cors" }).respondWith).not.toHaveBeenCalled();
    expect(sw.cache.put).not.toHaveBeenCalled();
  });

  it("serves navigations from the network and never caches them", async () => {
    const sw = boot(ok);
    const { respondWith } = sw.fire("/trips/1", { mode: "navigate" });
    expect(respondWith).toHaveBeenCalledOnce();
    const res = (await respondWith.mock.calls[0][0]) as Response;
    expect(await res.text()).toBe("page");
    expect(sw.cache.put).not.toHaveBeenCalled();
  });

  it("refreshes the cached shell when /offline itself is visited, and caches no other navigation", async () => {
    const sw = boot(ok);
    await sw.fire("/offline", { mode: "navigate" }).respondWith.mock.calls[0][0];
    await sw.settle();
    expect(sw.puts).toEqual(["/offline"]);
  });

  it("falls back to the cached /offline page when a navigation fails", async () => {
    const sw = boot(down);
    const { respondWith } = sw.fire("/trips/1", { mode: "navigate" });
    const res = (await respondWith.mock.calls[0][0]) as Response;
    expect(await res.text()).toBe("OFFLINE SHELL");
    expect(sw.cache.put).not.toHaveBeenCalled();
  });

  it("only writes the offline shell and static assets to the cache", async () => {
    const sw = boot(ok);
    for (const url of ["/_next/static/chunks/a.js", "/icons/icon-192.png", "/offline"]) {
      const { respondWith } = sw.fire(url);
      await respondWith.mock.calls[0][0];
    }
    await sw.settle();
    expect(sw.puts.sort()).toEqual(["/_next/static/chunks/a.js", "/icons/icon-192.png", "/offline"]);
    // Anything else is not handled at all (no respondWith), so it cannot be cached.
    for (const url of ["/trips", "/trips/1", "/login", "/uploads/photo.jpg", "/sw.js"]) {
      expect(sw.fire(url).respondWith).not.toHaveBeenCalled();
    }
  });

  it("serves a cached static asset when offline", async () => {
    const sw = boot(down);
    sw.store.set(`${ORIGIN}/_next/static/chunks/a.js`, new Response("JS"));
    const { respondWith } = sw.fire("/_next/static/chunks/a.js");
    expect(await ((await respondWith.mock.calls[0][0]) as Response).text()).toBe("JS");
  });

  it("does not cache failed asset responses", async () => {
    const sw = boot(() => Promise.resolve(new Response("nope", { status: 500 })));
    const { respondWith } = sw.fire("/_next/static/chunks/a.js");
    await respondWith.mock.calls[0][0];
    expect(sw.cache.put).not.toHaveBeenCalled();
  });

  it("install precaches /offline and the static assets it references, nothing else", async () => {
    const html = `<html><script src="/_next/static/chunks/x.js"></script><link href="/_next/static/css/y.css" rel="stylesheet"><a href="/trips">t</a></html>`;
    const sw = boot(() => Promise.resolve(new Response(html)));
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(sw.puts).toEqual(["/offline"]);
    expect(sw.cache.add.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["/_next/static/chunks/x.js", "/_next/static/css/y.css"]);
  });

  it("a rejected cache write never breaks the live response", async () => {
    const sw = boot(ok);
    sw.cache.put.mockRejectedValue(new Error("QuotaExceededError"));
    for (const [url, mode] of [["/_next/static/chunks/a.js", "no-cors"], ["/offline", "navigate"]]) {
      const { respondWith } = sw.fire(url, { mode });
      const res = (await respondWith.mock.calls[0][0]) as Response;
      expect(await res.text()).toBe("page");
    }
    await expect(sw.settle()).resolves.toBeUndefined();
  });

  it("activate deletes only older rtpp-offline- caches, never other apps' caches", async () => {
    const sw = boot(ok, ["rtpp-offline-v1", "rtpp-offline-v2", "other-app-cache", "workbox-precache"]);
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(sw.deletedCaches).toEqual(["rtpp-offline-v1"]);
  });

  it("activate refreshes the /offline shell in the background, and a failing refresh does not fail activation", async () => {
    const sw = boot(ok);
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(sw.puts).toEqual(["/offline"]);
    const down2 = boot(down);
    down2.listeners.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await expect(done).resolves.toBeUndefined();
  });

  it("refreshes the shell after the first successful online navigation of a session, only once", async () => {
    const sw = boot(ok);
    await sw.fire("/trips/1", { mode: "navigate" }).respondWith.mock.calls[0][0];
    await sw.settle();
    expect(sw.puts).toEqual(["/offline"]);
    await sw.fire("/trips/2", { mode: "navigate" }).respondWith.mock.calls[0][0];
    await sw.settle();
    expect(sw.puts).toEqual(["/offline"]);
  });

  it("trims /_next/static entries to 200, oldest first, keeping the current shell's assets", async () => {
    const html = `<script src="/_next/static/chunks/current.js"></script>`;
    const sw = boot(() => Promise.resolve(new Response(html)));
    for (let i = 0; i < 205; i++) sw.store.set(`${ORIGIN}/_next/static/chunks/old-${i}.js`, new Response("x"));
    sw.store.set(`${ORIGIN}/_next/static/chunks/current.js`, new Response("x"));
    // Make "current.js" the oldest entry: it must survive because the shell references it.
    const first = sw.store.get(`${ORIGIN}/_next/static/chunks/current.js`)!;
    sw.store.delete(`${ORIGIN}/_next/static/chunks/current.js`);
    const entries = [...sw.store.entries()];
    sw.store.clear();
    sw.store.set(`${ORIGIN}/_next/static/chunks/current.js`, first);
    for (const [k, v] of entries) sw.store.set(k, v);
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    const statics = [...sw.store.keys()].filter((k) => k.includes("/_next/static/"));
    expect(statics).toHaveLength(200);
    expect(statics).toContain(`${ORIGIN}/_next/static/chunks/current.js`);
    expect(statics).not.toContain(`${ORIGIN}/_next/static/chunks/old-0.js`);
    expect(statics).toContain(`${ORIGIN}/_next/static/chunks/old-204.js`);
  });

  it("answers hashed /_next/static assets from the cache without touching the network, and fetches and stores them on a miss", async () => {
    const sw = boot(ok);
    sw.store.set(`${ORIGIN}/_next/static/chunks/abc123.js`, new Response("cached"));
    sw.fetchFn.mockClear();
    const hit = sw.fire("/_next/static/chunks/abc123.js");
    expect(await hit.respondWith.mock.calls[0][0].then((r: Response) => r.text())).toBe("cached");
    expect(sw.fetchFn).not.toHaveBeenCalled();
    const miss = sw.fire("/_next/static/chunks/new456.js");
    await miss.respondWith.mock.calls[0][0];
    await sw.settle();
    expect(sw.fetchFn).toHaveBeenCalledTimes(1);
    expect(sw.puts).toContain("/_next/static/chunks/new456.js");
  });

  it("in a dev build still goes to the network first, because dev asset names are reused between edits", async () => {
    const sw = boot(() => Promise.resolve(new Response("fresh")), [], true);
    sw.store.set(`${ORIGIN}/_next/static/chunks/abc123.js`, new Response("stale"));
    const res = sw.fire("/_next/static/chunks/abc123.js");
    expect(await res.respondWith.mock.calls[0][0].then((r: Response) => r.text())).toBe("fresh");
  });

  it("the shell refresh only downloads assets that are not already cached", async () => {
    const html = '<script src="/_next/static/chunks/old.js"></script><script src="/_next/static/chunks/new.js"></script>';
    const sw = boot((url) => Promise.resolve(new Response(url.endsWith("/offline") ? html : "x")));
    sw.store.set(`${ORIGIN}/_next/static/chunks/old.js`, new Response("have it"));
    sw.cache.add.mockClear();
    await (sw.listeners.install as (e: unknown) => void)({ waitUntil: (p: Promise<unknown>) => p.then(() => {}) });
    await new Promise((r) => setTimeout(r, 10));
    expect(sw.cache.add.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(["/_next/static/chunks/new.js"]);
  });
});
