import { createHash } from "node:crypto";
import type { LngLat, Suggestion } from "@/lib/types";
import { fakeSuggestions, isFakeExternal } from "../external/fake";
import { TtlCache } from "./cache";
import { buildCorridor, buildOverpassQuery, toOverpassPoly } from "./corridor";
import { fetchOverpass, OverpassError } from "./overpass";
import { parseOverpassResponse } from "./parse";

export const SUGGESTION_CACHE_TTL_MS = 5 * 60_000;

const cache = new TtlCache<Suggestion[]>(SUGGESTION_CACHE_TTL_MS);

export function routeCacheKey(route: LngLat[]): string {
  const canonical = route.map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`).join(";");
  return createHash("sha1").update(canonical).digest("hex");
}

export function clearSuggestionCache(): void {
  cache.clear();
}

export async function findSuggestions(
  route: LngLat[],
  deps: { fetchOverpass?: (query: string) => Promise<unknown> } = {},
): Promise<Suggestion[]> {
  if (isFakeExternal()) return fakeSuggestions(route);
  const key = routeCacheKey(route);
  const cached = cache.get(key);
  if (cached) return cached;

  // Defense-in-depth: the schema cap on `coordinates` (see suggestionsRequestSchema)
  // is the real mitigation for pathological input reaching @turf/simplify here, but
  // wrap this anyway so any unexpected failure becomes a clean, typed error instead
  // of an unguarded throw.
  let corridor: ReturnType<typeof buildCorridor>;
  try {
    corridor = buildCorridor(route);
  } catch (e) {
    throw new OverpassError(e instanceof Error ? e.message : "Could not build a route corridor");
  }
  const query = buildOverpassQuery(toOverpassPoly(corridor));
  const json = await (deps.fetchOverpass ?? fetchOverpass)(query);
  const suggestions = parseOverpassResponse(json);
  cache.set(key, suggestions);
  return suggestions;
}
