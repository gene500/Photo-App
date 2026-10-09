import type { Suggestion } from "@/lib/types";
import { getCommonsPhotoCount } from "../external/commons";
import { flickrKey, getFlickrPhotoCount } from "../external/flickr";
import { TtlCache } from "./cache";
import { KIND_RANK } from "./parse";

export const POPULARITY_MAX_CANDIDATES = 40;
export const POPULARITY_CONCURRENCY = 5;
export const POPULARITY_TIMEOUT_MS = 5000;
/** Overall budget for the whole enrichment; counts not back by then are simply left out. */
export const POPULARITY_BUDGET_MS = 4000;

type Counter = (s: Suggestion, fetchImpl: typeof fetch) => Promise<number | undefined>;

/** Flickr totals when a key is configured (strong signal), else the number of Commons files nearby (weaker, max 50). */
export function defaultCounter(): Counter {
  return flickrKey()
    ? (s, f) => getFlickrPhotoCount(s, f, POPULARITY_TIMEOUT_MS)
    : (s, f) => getCommonsPhotoCount(s, f, POPULARITY_TIMEOUT_MS);
}

export const COUNT_CACHE_TTL_MS = 6 * 3600_000;
export const COUNT_CACHE_MAX = 2000;

/**
 * Wraps a counter with a per-instance cache (6 h, keyed on the ~10 m grid cell) and in-flight de-duplication, so a place
 * that shows up in a second search - or in two at once - is counted once. Failures (undefined) are not remembered.
 */
export function cachedCounter(count: Counter, now: () => number = Date.now): Counter {
  const cache = new TtlCache<number>(COUNT_CACHE_TTL_MS, COUNT_CACHE_MAX, now);
  const inFlight = new Map<string, Promise<number | undefined>>();
  return (s, fetchImpl) => {
    const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = count(s, fetchImpl)
      .then((n) => {
        if (typeof n === "number" && Number.isFinite(n) && n >= 0) cache.set(key, n);
        return n;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}

/** The counter used by the routes: the default source behind the shared cache. */
let shared: Counter | undefined;
export const sharedCounter = (): Counter => (shared ??= cachedCounter(defaultCounter()));
export const resetSharedCounter = (): void => {
  shared = undefined;
};

/**
 * Adds `popularity` to the first 40 suggestions (5 requests at a time, within a 4 s overall budget) and re-ranks within each kind tier by it,
 * descending; ties and unknowns (ranked as 0) keep their incoming (deterministic) order. Never throws: a failed count just
 * leaves that suggestion without popularity.
 */
export async function enrichPopularity(
  suggestions: Suggestion[],
  deps: { count?: Counter; fetchImpl?: typeof fetch; budgetMs?: number } = {},
): Promise<Suggestion[]> {
  const count = deps.count ?? sharedCounter();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const head = suggestions.slice(0, POPULARITY_MAX_CANDIDATES);
  const result: (number | undefined)[] = new Array(head.length).fill(undefined);
  let next = 0;
  const deadline = Date.now() + (deps.budgetMs ?? POPULARITY_BUDGET_MS);
  const worker = async () => {
    while (next < head.length && Date.now() < deadline) {
      const i = next++;
      try {
        const n = await count(head[i], fetchImpl);
        if (typeof n === "number" && Number.isFinite(n) && n >= 0) result[i] = n;
      } catch {
        /* no popularity for this one */
      }
    }
  };
  const workers = Promise.all(Array.from({ length: Math.min(POPULARITY_CONCURRENCY, head.length) }, worker));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())); });
  await Promise.race([workers, expired]);
  clearTimeout(timer);
  // Late results must not mutate what we are about to rank.
  const done = result.slice();

  const enriched = suggestions.map((s, i) => (done[i] === undefined ? s : { ...s, popularity: done[i] }));
  return enriched
    .map((s, i) => ({ s, i }))
    .sort((a, b) => KIND_RANK[a.s.kind] - KIND_RANK[b.s.kind] || (b.s.popularity ?? 0) - (a.s.popularity ?? 0) || a.i - b.i)
    .map((x) => x.s);
}
