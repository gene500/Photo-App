import { createHash } from "node:crypto";
import type { LngLat, Suggestion } from "@/lib/types";
import { fakeSuggestions, isFakeExternal } from "../external/fake";
import { TtlCache } from "./cache";
import { AROUND_RADIUS_KM, buildCorridorShapes, buildOverpassAroundQuery, buildOverpassQuery, type CorridorShape, OVERPASS_OUT_CAP, toOverpassPoly } from "./corridor";
import { createRingTester } from "./places-grid";
import { clearCellCache, localPlacesAround, localPlacesInRing, localPlacesInRingPartial } from "./local-places";
import { fetchOverpass } from "./overpass";
import { parseOverpassResponse, SUGGESTION_CAP } from "./parse";
import { enrichPopularity, POPULARITY_MAX_CANDIDATES, resetSharedCounter } from "./popularity";

type LngLatLiteral = { lat: number; lng: number };

export const SUGGESTION_CACHE_TTL_MS = 30 * 60_000;

/** Fewer places than this from the local copy is treated as "probably not loaded or not covered", so Overpass is asked too. */
export const MIN_LOCAL_PLACES = 5;

/** Enriched (ranked by popularity) results, and the raw Overpass results they are built from. */
/** A finished (enriched) result is served for up to this long past its TTL while a fresh one is built in the background. */
export const SUGGESTION_STALE_GRACE_MS = 6 * 3600_000;
const cache = new TtlCache<Suggestion[]>(SUGGESTION_CACHE_TTL_MS, 100, () => Date.now(), SUGGESTION_STALE_GRACE_MS);
/** Background refreshes underway for stale entries. */
const refreshing = new Set<string>();
const rawCache = new TtlCache<Suggestion[]>(SUGGESTION_CACHE_TTL_MS, 100, () => Date.now());

/** Most Overpass calls kept running in the background per instance after a thin local answer was shown. */
const MAX_LATE_ASKS = 10;
/** Overpass calls still running after a thin local answer was shown, so a repeat search joins them instead of racing the mirrors again. */
const lateAsks = new Map<string, Promise<Asked>>();
/** Searches already underway, so a repeat of the same one (a double-fired effect, a retry click) joins it instead of starting another. */
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
  refreshing.clear();
}

type Deps = {
  /** The local copy of the map data: elements, or null when the area isn't covered. Defaults to the database. */
  local?: () => Promise<unknown[] | null>;
  /** Places the local copy has for an area it only partly covers (a border park): shown as a fallback while Overpass is asked. */
  localPartial?: () => Promise<unknown[] | null>;
  fetchOverpass?: (query: string) => Promise<unknown>;   fetchImpl?: typeof fetch;
  /** false: skip popularity (the caller ranks it later). */
  enrich?: boolean;
  /** Test hook: overrides THIN_LOCAL_GRACE_MS. */
  thinGraceMs?: number;
  /** Told whether the answer is complete (false) or a stand-in shown while a slow source was still loading (true). */
  onResult?: (info: { degraded: boolean }) => void;
  /** Keeps work alive after the response is sent (the route passes next's `after`); without it the late answer is best effort. */
  defer?: (work: Promise<unknown>) => void;
};

/** How long a thin local answer waits for Overpass before being shown instead (Overpass keeps going and fills the cache). */
export const THIN_LOCAL_GRACE_MS = 1_500;

type Raw = { parsed: Suggestion[]; degraded: boolean };
/** An Overpass answer; `truncated` when the output cap cut it short and the hole filter then dropped places (so it is not the whole corridor). */
type Asked = { parsed: Suggestion[]; truncated: boolean };
const TRUNCATED = "truncatedByHoles";

async function loadRaw(key: string, buildQuery: () => string, local: () => Promise<unknown[] | null>, deps: Deps, origin?: LngLatLiteral, localPartial?: () => Promise<unknown[] | null>): Promise<Raw> {
  // The local copy answers in milliseconds; Overpass (free, often busy) is only asked when the copy doesn't cover the
  // area or comes back nearly empty, and a thin local answer still beats an Overpass failure.
  let nearby = await (deps.local ?? local)().catch(() => null);
  // Not covered (null): a corridor that touches the covered area still has US places to show while Overpass answers.
  const partial = nearby === null;
  if (partial) nearby = await (deps.localPartial ?? localPartial)?.().catch(() => null) ?? null;
  if (nearby && nearby.length >= MIN_LOCAL_PLACES && !partial) {
    const parsed = parseOverpassResponse({ elements: nearby }, SUGGESTION_CAP, origin);
    rawCache.set(key, parsed);
    return { parsed, degraded: false };
  }
  // Bounded background work: with this many slow Overpass calls already running, a thin local answer is shown as is.
  if (nearby?.length && !lateAsks.has(key) && lateAsks.size >= MAX_LATE_ASKS) {
    return { parsed: parseOverpassResponse({ elements: nearby }, SUGGESTION_CAP, origin), degraded: true };
  }
  const asked = lateAsks.get(key) ?? (async (): Promise<Asked> => {
    const json = await (deps.fetchOverpass ?? fetchOverpass)(buildQuery());
    return { parsed: parseOverpassResponse(json, SUGGESTION_CAP, origin), truncated: (json as Record<string, unknown> | null)?.[TRUNCATED] === true };
  })();
  if (!nearby?.length) {
    const { parsed, truncated } = await asked;
    // A truncated answer is shown, but not remembered as the whole corridor.
    if (!truncated) rawCache.set(key, parsed);
    return { parsed, degraded: truncated };
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
        const settle = asked.then((a) => { if (!a.truncated) rawCache.set(key, a.parsed); }, () => undefined).finally(() => {
          if (lateAsks.get(key) === asked) lateAsks.delete(key);
        });
        deps.defer?.(settle);
      }
      // A thin answer shown only because Overpass was slow must not be remembered as the real result.
      return { parsed: thin, degraded: true };
    }
    if (!won.truncated) rawCache.set(key, won.parsed);
    return { parsed: won.parsed, degraded: won.truncated };
  } catch {
    return { parsed: thin, degraded: true };
  } finally {
    clearTimeout(timer);
  }
}

async function runSearch(key: string, buildQuery: () => string, local: () => Promise<unknown[] | null>, deps: Deps, origin?: LngLatLiteral, localPartial?: () => Promise<unknown[] | null>): Promise<Suggestion[]> {
  const enrich = deps.enrich !== false;
  const done = enrich ? cache.get(key) : (cache.get(key) ?? rawCache.get(key));
  if (done) {
    deps.onResult?.({ degraded: false });
    return done;
  }
  if (enrich) {
    // Stale-while-revalidate: a result past its TTL is still far better than making the user wait, so show it now and
    // rebuild it in the background (the map data changes rarely; popularity changes slowly). Only complete results are
    // ever cached, so a stale entry is a complete answer.
    const stale = cache.getStale(key);
    if (stale) {
      if (!refreshing.has(key)) {
        refreshing.add(key);
        // The response is already on its way, so the rebuild must not report back through onResult.
        const refresh = compute(key, buildQuery, local, { ...deps, onResult: undefined }, origin, localPartial).then(() => undefined, () => undefined).finally(() => refreshing.delete(key));
        deps.defer?.(refresh);
      }
      deps.onResult?.({ degraded: false });
      return stale.value;
    }
  }
  return compute(key, buildQuery, local, deps, origin, localPartial);
}

async function compute(key: string, buildQuery: () => string, local: () => Promise<unknown[] | null>, deps: Deps, origin?: LngLatLiteral, localPartial?: () => Promise<unknown[] | null>): Promise<Suggestion[]> {
  const enrich = deps.enrich !== false;
  let parsed = rawCache.get(key);
  let degraded = false;
  if (!parsed) {
    let pending = inflight.get(key);
    if (!pending) {
      const started: Promise<Raw> = loadRaw(key, buildQuery, local, deps, origin, localPartial);
      pending = started;
      inflight.set(key, started);
      const clear = () => {
        if (inflight.get(key) === started) inflight.delete(key);
      };
      started.then(clear, clear);
    }
    ({ parsed, degraded } = await pending);
  }
  deps.onResult?.({ degraded });
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
  let shapes: CorridorShape[] | null = null;
  // Throws CorridorError (a route that can never be searched, so the caller answers 400 rather than "retry"); the schema cap
  // on `coordinates` (see suggestionsRequestSchema) is the real mitigation for pathological input.
  const corridor = (): CorridorShape[] => (shapes ??= buildCorridorShapes(route));
  // Overpass's `poly:` filter takes one ring and no holes, so a loop route's hole is cut out of its answer afterwards.
  const askOverpass = deps.fetchOverpass ?? fetchOverpass;
  const outsideHoles = async (query: string): Promise<unknown> => {
    const json = await askOverpass(query);
    const parts = corridor();
    if (!parts.some((p) => p.holes.length)) return json;
    const testers = parts.map((p) => createRingTester(p.outer, p.holes));
    return dropElementsInHoles(json, (lng, lat) => testers.some((t) => t(lng, lat)));
  };
  // The local copy answers per part; one part outside its coverage makes the whole answer "not covered".
  const coveredParts = async (): Promise<unknown[] | null> => {
    const found = await Promise.all(corridor().map((p) => localPlacesInRing(p.outer, undefined, p.holes)));
    return found.some((f) => f === null) ? null : found.flat() as unknown[];
  };
  const partialParts = async (): Promise<unknown[] | null> => {
    const found = (await Promise.all(corridor().map((p) => localPlacesInRingPartial(p.outer, undefined, p.holes)))).filter((f) => f !== null);
    return found.length ? found.flat() : null;
  };
  return runSearch(routeCacheKey(route), () => buildOverpassQuery(corridor().map((p) => toOverpassPoly(p.outer))), coveredParts, { ...deps, fetchOverpass: outsideHoles }, undefined, partialParts);
}

type LooseElement = { lat?: number; lon?: number; center?: { lat: number; lon: number } };

/**
 * An Overpass response without the elements the tester refuses (elements with no position are left for the parser to judge).
 * A response at the output cap that lost places to the filter is marked truncated: the cap may have hidden places outside the holes.
 */
function dropElementsInHoles(json: unknown, inside: (lng: number, lat: number) => boolean): unknown {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return json;
  const kept = elements.filter((e: LooseElement | null) => {
    const lat = e?.lat ?? e?.center?.lat;
    const lng = e?.lon ?? e?.center?.lon;
    return typeof lat !== "number" || typeof lng !== "number" || inside(lng, lat);
  });
  const truncated = elements.length >= OVERPASS_OUT_CAP && kept.length < elements.length;
  return { ...(json as object), elements: kept, ...(truncated ? { [TRUNCATED]: true } : {}) };
}

/** Suggestions in a circle around one point (a trip's first stop, before there is a route). */
export async function findSuggestionsAround(point: LngLat, deps: Deps = {}, radiusKm: number = AROUND_RADIUS_KM): Promise<Suggestion[]> {
  if (isFakeExternal()) return fakeSuggestions([point]);
  return runSearch(`around:${radiusKm}:${routeCacheKey([point])}`, () => buildOverpassAroundQuery(point[0], point[1], radiusKm), () => localPlacesAround(point[1], point[0], radiusKm), deps, { lat: point[1], lng: point[0] });
}
