import { HIKE_MAX_POINTS, NPS_ATTRIBUTION, OSM_ATTRIBUTION, hikeKey, type Hike } from "@/lib/hike";
import { fakeHike, isFakeExternal } from "@/server/external/fake";
import { findHikePath, simplifyLine, type HikePath } from "./graph";
import { fetchNpsTrails } from "./nps";
import { fetchOsmTrails } from "./osm";

/** Trails are looked for this far around the place (a trailhead farther away is not found: "small radius"). */
export const HIKE_RADIUS_M = 2500;
const HALF_DEG = HIKE_RADIUS_M / 111_320;
export const HIKE_TTL_MS = 24 * 60 * 60_000;
/** "No hike here" is remembered for an hour; a failed lookup for five minutes (Overpass is slow or busy: do not hammer it). */
export const HIKE_NONE_TTL_MS = 60 * 60_000;
export const HIKE_FAILURE_TTL_MS = 5 * 60_000;
export const HIKE_CACHE_MAX = 500;

type Deps = { fetchImpl?: typeof fetch; now?: () => number };

const toHike = (path: HikePath, source: Hike["source"], at: { lat: number; lng: number }): Hike => ({
  distanceMeters: Math.round(path.distanceMeters / 10) * 10,
  geometry: simplifyLine(path.coords, HIKE_MAX_POINTS, at),
  source,
  attribution: source === "nps" ? NPS_ATTRIBUTION : OSM_ATTRIBUTION,
});

/**
 * One uncached lookup: National Park Service trails first (inside a park unit there are some), then OpenStreetMap
 * (everywhere else, and when the park data has no usable walk). `failed` is true when a source was down and nothing was
 * found, so the answer is not worth remembering for long. Never throws.
 */
export async function lookupHike(lat: number, lng: number, fetchImpl?: typeof fetch): Promise<{ hike: Hike | null; failed: boolean }> {
  const at = { lat, lng };
  const nps = await fetchNpsTrails(lat, lng, HALF_DEG, fetchImpl);
  if (nps && nps.length) {
    const path = findHikePath(nps, at);
    if (path) return { hike: toHike(path, "nps", at), failed: false };
  }
  const osm = await fetchOsmTrails(lat, lng, HIKE_RADIUS_M, fetchImpl);
  if (osm) {
    const tiers = [osm.trailheads, osm.parking].filter((t) => t.length > 0);
    const path = findHikePath(osm.segments, at, { trailheadTiers: tiers });
    if (path) return { hike: toHike(path, "osm", at), failed: false };
  }
  return { hike: null, failed: osm === null };
}

/** The lookup with a bounded in-memory cache (24 h for a hike, 1 h for none, 5 min for a failure) and shared in-flight requests. */
export function createHikeLookup(deps: Deps = {}) {
  const now = deps.now ?? Date.now;
  const store = new Map<string, { hike: Hike | null; expiresAt: number }>();
  const inFlight = new Map<string, Promise<Hike | null>>();
  return function get(lat: number, lng: number): Promise<Hike | null> {
    if (isFakeExternal()) return Promise.resolve(fakeHike(lat, lng));
    // Snap to the same ~11 m grid as the cache key, so every request with a key asks upstream for the same point.
    const key = hikeKey(lat, lng);
    const [qLat, qLng] = key.split(",").map(Number);
    const hit = store.get(key);
    if (hit) {
      store.delete(key);
      if (hit.expiresAt > now()) {
        store.set(key, hit);
        return Promise.resolve(hit.hike);
      }
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = lookupHike(qLat, qLng, deps.fetchImpl)
      .catch(() => ({ hike: null, failed: true }))
      .then(({ hike, failed }) => {
        store.set(key, { hike, expiresAt: now() + (hike ? HIKE_TTL_MS : failed ? HIKE_FAILURE_TTL_MS : HIKE_NONE_TTL_MS) });
        while (store.size > HIKE_CACHE_MAX) store.delete(store.keys().next().value as string);
        return hike;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}

export const getHike = createHikeLookup();
