import { createHash } from "node:crypto";
import type { LngLat, Suggestion } from "@/lib/types";
import { fakeSuggestions, isFakeExternal } from "../external/fake";
import { TtlCache } from "./cache";
import { buildCorridor, buildOverpassAroundQuery, buildOverpassQuery, toOverpassPoly } from "./corridor";
import { fetchOverpass, OverpassError } from "./overpass";
import { parseOverpassResponse } from "./parse";
import { enrichPopularity } from "./popularity";

export const SUGGESTION_CACHE_TTL_MS = 5 * 60_000;

const cache = new TtlCache<Suggestion[]>(SUGGESTION_CACHE_TTL_MS);

export function routeCacheKey(route: LngLat[]): string {
  const canonical = route.map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`).join(";");
  return createHash("sha1").update(canonical).digest("hex");
}

export function clearSuggestionCache(): void {
  cache.clear();
}

type Deps = { fetchOverpass?: (query: string) => Promise<unknown>; fetchImpl?: typeof fetch };

async function runSearch(key: string, buildQuery: () => string, deps: Deps): Promise<Suggestion[]> {
  const cached = cache.get(key);
  if (cached) return cached;
  const json = await (deps.fetchOverpass ?? fetchOverpass)(buildQuery());
  // Popularity is a bonus: enrichPopularity never throws, but guard anyway so it can never fail the request.
  const parsed = parseOverpassResponse(json);
  const suggestions = await enrichPopularity(parsed, { fetchImpl: deps.fetchImpl }).catch(() => parsed);
  cache.set(key, suggestions);
  return suggestions;
}

export async function findSuggestions(route: LngLat[], deps: Deps = {}): Promise<Suggestion[]> {
  if (isFakeExternal()) return fakeSuggestions(route);
  return runSearch(routeCacheKey(route), () => {
    // Defense-in-depth: the schema cap on `coordinates` (see suggestionsRequestSchema)
    // is the real mitigation for pathological input reaching @turf/simplify here, but
    // wrap this anyway so any unexpected failure becomes a clean, typed error instead
    // of an unguarded throw.
    try {
      return buildOverpassQuery(toOverpassPoly(buildCorridor(route)));
    } catch (e) {
      throw new OverpassError(e instanceof Error ? e.message : "Could not build a route corridor");
    }
  }, deps);
}

/** Suggestions in a circle around one point (a trip's first stop, before there is a route). */
export async function findSuggestionsAround(point: LngLat, deps: Deps = {}): Promise<Suggestion[]> {
  if (isFakeExternal()) return fakeSuggestions([point]);
  return runSearch(`around:${routeCacheKey([point])}`, () => buildOverpassAroundQuery(point[0], point[1]), deps);
}
