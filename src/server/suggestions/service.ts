import { createHash } from "node:crypto";
import type { LngLat, Suggestion } from "@/lib/types";
import { fakeSuggestions, isFakeExternal } from "../external/fake";
import { TtlCache } from "./cache";
import { AROUND_RADIUS_KM, buildCorridor, buildOverpassAroundQuery, buildOverpassQuery, toOverpassPoly } from "./corridor";
import { clearCellCache, localPlacesAround, localPlacesInRing } from "./local-places";
import { fetchOverpass, OverpassError } from "./overpass";
import { parseOverpassResponse, SUGGESTION_CAP } from "./parse";
import { enrichPopularity, POPULARITY_MAX_CANDIDATES, resetSharedCounter } from "./popularity";

type LngLatLiteral = { lat: number; lng: number };

export const SUGGESTION_CACHE_TTL_MS = 30 * 60_000;

/** Fewer places than this from the local copy is treated as "probably not loaded or not covered", so Overpass is asked too. */
export const MIN_LOCAL_PLACES = 5;

/** Enriched (ranked by popularity) results, and the raw Overpass results they are built from. */
const cache = new TtlCache<Suggestion[]>(SUGGESTION_CACHE_TTL_MS);
const rawCache = new TtlCache<Suggestion[]>(SUGGESTION_CACHE_TTL_MS);

/** Searches already underway, so a repeat of the same one (a double-fired effect, a retry click) joins it instead of starting another. */
/** Overpass calls still running after a thin local answer was shown, so a repeat search joins them instead of racing the mirrors again. */
const lateAsks = new Map<string, Promise<Suggestion[]>>();
const inflight = new Map<string, Promise<{ parsed: Suggestion[]; degraded: boolean }>>();

export function routeCacheKey(route: LngLat[]): string {
  const canonical = route.map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`).join(";");
  return createHash("sha1").update(canonical).digest("hex");
}

export function clearSuggestionCache(): void {
  cache.clear();
  rawCache.clear();
  resetSharedCounter();
  clearCellCache();
  inflight.clear();
  lateAsks.clear();
}

type Deps = {
  /** The local copy of the map data: elements, or null when the area isn't covered. Defaults to the database. */
  local?: () => Promise<unknown[] | null>;
  fetchOverpass?: (query: string) => Promise<unknown>;   fetchImpl?: typeof fetch;
  /** false: skip popularity (the caller ranks it later). */
  enrich?: boolean;
  /** Test hook: overrides THIN_LOCAL_GRACE_MS. */
  thinGraceMs?: number;
  /** Keeps work alive after the response is sent (the route passes next's `after`); without it the late answer is best effort. */
  defer?: (work: Promise<unknown>) => void;
};

/** How long a thin local answer waits for Overpass before being shown instead (Overpass keeps going and fills the cache). */
export const THIN_LOCAL_GRACE_MS = 2_500;

type Raw = { parsed: Suggestion[]; degraded: boolean };

async function loadRaw(key: string, buildQuery: () => string, local: () => Promise<unknown[] | null>, deps: Deps, origin?: LngLatLiteral): Promise<Raw> {
  // The local copy answers in milliseconds; Overpass (free, often busy) is only asked when the copy doesn't cover the
  // area or comes back nearly empty, and a thin local answer still beats an Overpass failure.
  const nearby = await (deps.local ?? local)().catch(() => null);
  if (nearby && nearby.length >= MIN_LOCAL_PLACES) {
    const parsed = parseOverpassResponse({ elements: nearby }, SUGGESTION_CAP, origin);
    rawCache.set(key, parsed);
    return { parsed, degraded: false };
  }
  const asked = lateAsks.get(key) ?? (async () => parseOverpassResponse(await (deps.fetchOverpass ?? fetchOverpass)(buildQuery()), SUGGESTION_CAP, origin))();
  if (!nearby?.length) {
    const parsed = await asked;
    rawCache.set(key, parsed);
    return { parsed, degraded: false };
  }
  // Something local to show: don't make the first page wait out a slow or failing Overpass.
  const thin = parseOverpassResponse({ elements: nearby }, SUGGESTION_CAP, origin);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), deps.thinGraceMs ?? THIN_LOCAL_GRACE_MS);
  });
  try {
    const won = await Promise.race([asked, late]);
    if (won === "late") {
      // Overpass is still working: remember its answer if it comes, so the next search is complete.
      if (!lateAsks.has(key)) {
        lateAsks.set(key, asked);
        const settle = asked.then((p) => { rawCache.set(key, p); }, () => undefined).finally(() => {
          if (lateAsks.get(key) === asked) lateAsks.delete(key);
        });
        deps.defer?.(settle);
      }
      // A thin answer shown only because Overpass was slow must not be remembered as the real result.
      return { parsed: thin, degraded: true };
    }
    rawCache.set(key, won);
    return { parsed: won, degraded: false };
  } catch {
    return { parsed: thin, degraded: true };
  } finally {
    clearTimeout(timer);
  }
}

async function runSearch(key: string, buildQuery: () => string, local: () => Promise<unknown[] | null>, deps: Deps, origin?: LngLatLiteral): Promise<Suggestion[]> {
  const enrich = deps.enrich !== false;
  const done = enrich ? cache.get(key) : (cache.get(key) ?? rawCache.get(key));
  if (done) return done;
  let parsed = rawCache.get(key);
  let degraded = false;
  if (!parsed) {
    let pending = inflight.get(key);
    if (!pending) {
      const started: Promise<Raw> = loadRaw(key, buildQuery, local, deps, origin);
      pending = started;
      inflight.set(key, started);
      const clear = () => {
        if (inflight.get(key) === started) inflight.delete(key);
      };
      started.then(clear, clear);
    }
    ({ parsed, degraded } = await pending);
  }
  if (!enrich) return parsed;
  // Popularity is a bonus: enrichPopularity never throws, but guard anyway so it can never fail the request.
  const base = parsed;
  const suggestions = await enrichPopularity(base, { fetchImpl: deps.fetchImpl }).catch(() => base);
  // Cache only a reasonably complete enrichment: a half-finished one would be served for the whole TTL.
  const head = Math.min(suggestions.length, POPULARITY_MAX_CANDIDATES);
  const counted = suggestions.filter((s) => s.popularity !== undefined).length;
  if (!degraded && (head === 0 || counted * 2 >= head)) cache.set(key, suggestions);
  return suggestions;
}

export async function findSuggestions(route: LngLat[], deps: Deps = {}): Promise<Suggestion[]> {
  if (isFakeExternal()) return fakeSuggestions(route);
  let ring: LngLat[] | null = null;
  const corridor = () => {
    // Defense-in-depth: the schema cap on `coordinates` (see suggestionsRequestSchema)
    // is the real mitigation for pathological input reaching @turf/simplify here, but
    // wrap this anyway so any unexpected failure becomes a clean, typed error instead
    // of an unguarded throw.
    try {
      return (ring ??= buildCorridor(route));
    } catch (e) {
      throw new OverpassError(e instanceof Error ? e.message : "Could not build a route corridor");
    }
  };
  return runSearch(routeCacheKey(route), () => buildOverpassQuery(toOverpassPoly(corridor())), async () => localPlacesInRing(corridor()), deps);
}

/** Suggestions in a circle around one point (a trip's first stop, before there is a route). */
export async function findSuggestionsAround(point: LngLat, deps: Deps = {}, radiusKm: number = AROUND_RADIUS_KM): Promise<Suggestion[]> {
  if (isFakeExternal()) return fakeSuggestions([point]);
  return runSearch(`around:${radiusKm}:${routeCacheKey([point])}`, () => buildOverpassAroundQuery(point[0], point[1], radiusKm), () => localPlacesAround(point[1], point[0], radiusKm), deps, { lat: point[1], lng: point[0] });
}
