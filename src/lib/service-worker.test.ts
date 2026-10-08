import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Evaluates the real public/sw.js with a fake `self`, so the handler logic that ships is the logic that is tested.
const SOURCE = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://app.test";

type Listener = (event: unknown) => void;

function boot(network: (url: string) => Promise<Response>) {
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
  };
  const fetchFn = vi.fn((req: string | Request) => network(typeof req === "string" ? new URL(req, ORIGIN).href : req.url));
  const sandbox = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      match: async (req: string | Request) => store.get(typeof req === "string" ? new URL(req, ORIGIN).href : req.url),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: fetchFn,
    URL, Response, Set, Promise, Error,
  };
  vm.runInNewContext(SOURCE, sandbox);
  store.set(`${ORIGIN}/offline`, new Response("OFFLINE SHELL"));
  function fire(url: string, init: { method?: string; mode?: string } = {}) {
    const respondWith = vi.fn();
    const request = { url: new URL(url, ORIGIN).href, method: init.method ?? "GET", mode: init.mode ?? "no-cors" };
    listeners.fetch({ request, respondWith });
    return { respondWith, request };
  }
  return { fire, fetchFn, cache, puts, store, listeners };
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
});
