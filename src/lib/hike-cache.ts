import { api } from "./api-client";
import { hikeKey, type Hike } from "./hike";

/** A hike is reused this long in a session; "no hike" for a while less; a failed lookup is retried after a minute. */
export const HIKE_SUCCESS_TTL_MS = 30 * 60_000;
export const HIKE_NONE_TTL_MS = 10 * 60_000;
export const HIKE_FAILURE_TTL_MS = 60_000;
/** Requests in flight at once; the rest wait their turn, so a long trip does not open a request per stop at once. */
export const HIKE_MAX_IN_FLIGHT = 3;

type Entry = { promise: Promise<Hike | null>; expiresAt: number; subscribers: number; controller: AbortController; done: boolean };
const cache = new Map<string, Entry>();
let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>, cancelled: () => boolean): Promise<T | null> {
  if (running >= HIKE_MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  else running++;
  // A slot was handed over (or taken). If every listener left while waiting, give it back unused.
  try {
    return cancelled() ? null : await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Subscribes to the hike for a place: one request per ~11 m grid cell, shared by everyone asking, at most
 * HIKE_MAX_IN_FLIGHT at a time. Resolves to the hike, or null when there is none, the lookup failed or the device is
 * offline (the hike is decorative, so nothing ever throws). Call `release` on unmount: when the last subscriber of a
 * request that has not finished leaves, the request is aborted and forgotten.
 */
export function subscribeHike(lat: number, lng: number): { promise: Promise<Hike | null>; release: () => void } {
  const key = hikeKey(lat, lng);
  const now = Date.now();
  for (const [k, e] of cache) if (e.done && e.expiresAt <= now) cache.delete(k);
  let entry = cache.get(key);
  if (!entry) {
    const e: Entry = { promise: Promise.resolve(null), expiresAt: Infinity, subscribers: 0, controller: new AbortController(), done: false };
    if (offline()) {
      e.done = true;
      e.expiresAt = 0; // not remembered: asking again once back online works
    } else {
      e.promise = slot(() => api.hike({ lat, lng }, e.controller.signal), () => e.controller.signal.aborted)
        .then((r) => {
          e.done = true;
          const hike = r?.hike ?? null;
          e.expiresAt = Date.now() + (hike ? HIKE_SUCCESS_TTL_MS : HIKE_NONE_TTL_MS);
          return hike;
        })
        .catch(() => {
          e.done = true;
          e.expiresAt = Date.now() + HIKE_FAILURE_TTL_MS;
          return null;
        });
    }
    cache.set(key, e);
    entry = e;
  }
  const e = entry;
  e.subscribers++;
  let released = false;
  return {
    promise: e.promise,
    release: () => {
      if (released) return;
      released = true;
      e.subscribers--;
      // Deferred a tick: a re-render that swaps the subscriber list releases and re-subscribes in one go, and that must not restart the request.
      setTimeout(() => {
        if (e.subscribers > 0 || e.done) return;
        e.controller.abort();
        if (cache.get(key) === e) cache.delete(key);
      }, 0);
    },
  };
}

/** Entries currently held (for tests). */
export const hikeCacheSize = () => cache.size;

export function resetHikeCache(): void {
  for (const e of cache.values()) if (!e.done) e.controller.abort();
  cache.clear();
  running = 0;
  waiting.length = 0;
}
