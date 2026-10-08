import { createHash } from "node:crypto";
import type { LngLat, Suggestion } from "@/lib/types";
import { fakeSuggestions, isFakeExternal } from "../external/fake";
import { TtlCache } from "./cache";
import { AROUND_RADIUS_KM, buildCorridor, buildOverpassAroundQuery, buildOverpassQuery, toOverpassPoly } from "./corridor";
import { localPlacesAround, localPlacesInRing } from "./local-places";
import { fetchOverpass, OverpassError } from "./overpass";
import { parseOverpassResponse } from "./parse";
import { enrichPopularity } from "./popularity";

export const SUGGESTION_CACHE_TTL_MS = 30 * 60_000;

/** Fewer places than this from the local copy is treated as "probably not loaded or not covered", so Overpass is asked too. */
export const MIN_LOCAL_PLACES = 5;

/** Enriched (ranked by popularity) results, and the raw Overpass results they are built from. */
const cache = new TtlCache<Suggestion[]>(SUGGESTION_CACHE_TTL_MS);
const rawCache = new TtlCache<Suggestion[]>(SUGGESTION_CACHE_TTL_MS);

export function routeCacheKey(route: LngLat[]): string {
  const canonical = route.map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`).join(";");
  return createHash("sha1").update(canonical).digest("hex");
}

export function clearSuggestionCache(): void {
  cache.clear();
  rawCache.clear();
}

type Deps = {
  /** The local copy of the map data: elements, or null when the area isn't covered. Defaults to the database. */
  local?: () => Promise<unknown[] | null>;
  fetchOverpass?: (query: string) => Promise<unknown>;   fetchImpl?: typeof fetch;
  /** false: skip popularity (the caller ranks it later). */
  enrich?: boolean;
};

async function runSearch(key: string, buildQuery: () => string, local: () => Promise<unknown[] | null>, deps: Deps): Promise<Suggestion[]> {
  const enrich = deps.enrich !== false;
  const done = enrich ? cache.get(key) : (cache.get(key) ?? rawCache.get(key));
  if (done) return done;
  let parsed = rawCache.get(key);
  if (!parsed) {
    // The local copy answers in milliseconds; Overpass (free, often busy) is only asked when the copy doesn't cover the
    // area or comes back nearly empty, and a thin local answer still beats an Overpass failure.
    const nearby = await (deps.local ?? local)().catch(() => null);
    if (nearby && nearby.length >= MIN_LOCAL_PLACES) {
      parsed = parseOverpassResponse({ elements: nearby });
    } else {
      try {
        parsed = parseOverpassResponse(await (deps.fetchOverpass ?? fetchOverpass)(buildQuery()));
      } catch (e) {
        if (!nearby) throw e;
        parsed = parseOverpassResponse({ elements: nearby });
      }
    }
    rawCache.set(key, parsed);
  }
  if (!enrich) return parsed;
  // Popularity is a bonus: enrichPopularity never throws, but guard anyway so it can never fail the request.
  const base = parsed;
  const suggestions = await enrichPopularity(base, { fetchImpl: deps.fetchImpl }).catch(() => base);
  cache.set(key, suggestions);
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
  return runSearch(`around:${radiusKm}:${routeCacheKey([point])}`, () => buildOverpassAroundQuery(point[0], point[1], radiusKm), () => localPlacesAround(point[1], point[0], radiusKm), deps);
}
