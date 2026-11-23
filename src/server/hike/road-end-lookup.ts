import { ACCESS_TRAIL_MAX_POINTS, serializeAccessTrail } from "@/lib/access-trail";
import { hikeKey } from "@/lib/hike";
import type { LngLat } from "@/lib/types";
import { fakeRoadEnd, isFakeExternal } from "@/server/external/fake";
import { fetchOverpass } from "@/server/suggestions/overpass";
import { simplifyLine } from "./graph";
import { chooseRoadEnd, parseRoadEnd, roadEndQuery, ROAD_SEARCH_M, type RoadEndChoice } from "./road-end";

export const ROAD_END_TTL_MS = 24 * 60 * 60_000;
/** "No road end needed / no road" is remembered for an hour; a failed lookup for five minutes (Overpass is slow or busy). */
export const ROAD_END_NONE_TTL_MS = 60 * 60_000;
export const ROAD_END_FAILURE_TTL_MS = 5 * 60_000;
export const ROAD_END_CACHE_MAX = 500;
const ROAD_END_DEADLINE_MS = 12_000;
const FALLBACK_POINTS = 60;

/** Same shape as `RoadEndChoice`, with the trail already simplified to fit the stored caps. */
export type RoadEndResult = RoadEndChoice;
export type RoadEndStatus = { result: RoadEndResult | null; failed: boolean };
type Deps = { fetchImpl?: typeof fetch; now?: () => number };

const FAILED: RoadEndStatus = { result: null, failed: true };

/** Simplifies a trail to the stored caps: 120 points, then 60 if the saved text is still over the character cap. */
export function capTrail(trail: LngLat[], stop: { lat: number; lng: number }): LngLat[] | null {
  for (const cap of [ACCESS_TRAIL_MAX_POINTS, FALLBACK_POINTS]) {
    const t = simplifyLine(trail, cap, stop);
    if (serializeAccessTrail(t) !== null) return t;
  }
  return null;
}

/** One uncached lookup. Never throws; any upstream problem is `failed`, never "none". */
async function lookup(lat: number, lng: number, fetchImpl?: typeof fetch): Promise<RoadEndStatus> {
  try {
    const json = await fetchOverpass(roadEndQuery(lat, lng, ROAD_SEARCH_M), { fetchImpl, stopOnHeavy: true });
    const data = parseRoadEnd(json);
    if (!data) return FAILED;
    const choice = chooseRoadEnd(data, { lat, lng });
    if (choice.kind === "road-end" && choice.trail) return { result: { ...choice, trail: capTrail(choice.trail, { lat, lng }) }, failed: false };
    return { result: choice, failed: false };
  } catch {
    return FAILED;
  }
}

/** The road-end lookup with a bounded in-memory cache (24 h for a road end, 1 h for near-road or none, 5 min for a failure) and shared in-flight requests. */
export function createRoadEndLookup(deps: Deps = {}) {
  const now = deps.now ?? Date.now;
  const store = new Map<string, RoadEndStatus & { expiresAt: number }>();
  const inFlight = new Map<string, Promise<RoadEndStatus>>();
  return function roadEnd(lat: number, lng: number): Promise<RoadEndStatus> {
    if (isFakeExternal()) return Promise.resolve({ result: fakeRoadEnd(lat, lng) ?? { kind: "none" }, failed: false });
    const key = hikeKey(lat, lng);
    const [qLat, qLng] = key.split(",").map(Number);
    const hit = store.get(key);
    if (hit) {
      store.delete(key);
      if (hit.expiresAt > now()) {
        store.set(key, hit);
        return Promise.resolve({ result: hit.result, failed: hit.failed });
      }
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<RoadEndStatus>((resolve) => {
      timer = setTimeout(() => resolve(FAILED), ROAD_END_DEADLINE_MS);
    });
    const p = Promise.race([lookup(qLat, qLng, deps.fetchImpl), deadline])
      .then((status) => {
        const ttl = status.failed ? ROAD_END_FAILURE_TTL_MS : status.result?.kind === "road-end" ? ROAD_END_TTL_MS : ROAD_END_NONE_TTL_MS;
        store.set(key, { ...status, expiresAt: now() + ttl });
        while (store.size > ROAD_END_CACHE_MAX) store.delete(store.keys().next().value as string);
        return status;
      })
      .finally(() => {
        clearTimeout(timer);
        inFlight.delete(key);
      });
    inFlight.set(key, p);
    return p;
  };
}

export const lookupRoadEnd = createRoadEndLookup();
