import { HIKE_MAX_POINTS, NPS_ATTRIBUTION, OSM_ATTRIBUTION, hikeKey, type Hike } from "@/lib/hike";
import { fakeHike, isFakeExternal } from "@/server/external/fake";
import { findHikePath, lineLengthMeters, simplifyLine, type HikePath } from "./graph";
import { fetchNpsTrails } from "./nps";
import { fetchOsmTrails, type Lot } from "./osm";

/** Trails are looked for this far around the place (a trailhead farther away is not found: "small radius"). */
const HIKE_RADIUS_M = 2500;
const HALF_DEG = HIKE_RADIUS_M / 111_320;
export const HIKE_TTL_MS = 24 * 60 * 60_000;
/** "No hike here" is remembered for an hour; a failed lookup for five minutes (Overpass is slow or busy: do not hammer it). */
export const HIKE_NONE_TTL_MS = 60 * 60_000;
export const HIKE_FAILURE_TTL_MS = 5 * 60_000;
export const HIKE_CACHE_MAX = 500;

type Deps = { fetchImpl?: typeof fetch; now?: () => number };

/** A lot this close to the place is not a drive-then-walk: the walk is kept but the car goes to the place itself. */
const ACCESS_MIN_M = 150;
/** A parking lot or trailhead marker more than this far away by trail is not "the" start: trailhead markers are tried after lots, and with neither in range the walk starts at a trail dead end with no drive target. */
export const LOT_MAX_WALK_M = 5000;

const toHike = (path: HikePath, source: Hike["source"], at: { lat: number; lng: number }, lot: Lot | null = null): Hike => ({
  distanceMeters: Math.round(path.distanceMeters / 10) * 10,
  geometry: simplifyLine(path.coords, HIKE_MAX_POINTS, at),
  source,
  attribution: source === "nps" ? NPS_ATTRIBUTION : OSM_ATTRIBUTION,
  access: lot && lineLengthMeters([lot.point, [at.lng, at.lat]]) >= ACCESS_MIN_M ? { lat: lot.point[1], lng: lot.point[0], name: lot.name } : null,
});

/**
 * One uncached lookup. OpenStreetMap first, with parking lots as the preferred start and trailhead markers second: a
 * walk that starts at a lot is returned with that lot as `access`. Otherwise National Park Service trails (inside a
 * park unit there are some; no lot), then the OpenStreetMap walk from a trail dead end (no lot). `failed` is true when
 * OpenStreetMap was down (even if NPS answered: the hike is returned for display but no lot is known), so the answer is only remembered for a short time. Never throws.
 */
export async function lookupHike(lat: number, lng: number, fetchImpl?: typeof fetch): Promise<{ hike: Hike | null; failed: boolean }> {
  const at = { lat, lng };
  const osm = await fetchOsmTrails(lat, lng, HIKE_RADIUS_M, fetchImpl);
  let osmPath: HikePath | null = null;
  if (osm) {
    const tiers = [osm.parking, osm.trailheads];
    osmPath = findHikePath(osm.segments, at, { trailheadTiers: tiers.map((t) => t.map((l) => l.point)), tierMaxM: [LOT_MAX_WALK_M, LOT_MAX_WALK_M] });
    if (osmPath?.start.kind === "tier") return { hike: toHike(osmPath, "osm", at, tiers[osmPath.start.tier][osmPath.start.index]), failed: false };
  }
  const nps = await fetchNpsTrails(lat, lng, HALF_DEG, fetchImpl);
  if (nps && nps.length) {
    const path = findHikePath(nps, at);
    // OpenStreetMap down: the NPS walk is still shown, but no lot is known, so the lookup counts as failed (short cache, retried).
    if (path) return { hike: toHike(path, "nps", at), failed: osm === null };
  }
  if (osmPath) return { hike: toHike(osmPath, "osm", at), failed: false };
  return { hike: null, failed: osm === null };
}

export type HikeStatus = { hike: Hike | null; failed: boolean };

/**
 * The lookup with a bounded in-memory cache (24 h for a hike, 1 h for none, 5 min for a failure) and shared in-flight requests.
 * The returned function gives the hike (null for both "none" and "down"); its `status` sibling shares the cache and also
 * says whether the lookup failed, so a caller can tell the two apart.
 */
export function createHikeLookup(deps: Deps = {}) {
  const now = deps.now ?? Date.now;
  const store = new Map<string, { hike: Hike | null; failed: boolean; expiresAt: number }>();
  const inFlight = new Map<string, Promise<HikeStatus>>();
  function status(lat: number, lng: number): Promise<HikeStatus> {
    if (isFakeExternal()) return Promise.resolve({ hike: fakeHike(lat, lng), failed: false });
    // Snap to the same ~11 m grid as the cache key, so every request with a key asks upstream for the same point.
    const key = hikeKey(lat, lng);
    const [qLat, qLng] = key.split(",").map(Number);
    const hit = store.get(key);
    if (hit) {
      store.delete(key);
      if (hit.expiresAt > now()) {
        store.set(key, hit);
        return Promise.resolve({ hike: hit.hike, failed: hit.failed });
      }
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = lookupHike(qLat, qLng, deps.fetchImpl)
      .catch((): HikeStatus => ({ hike: null, failed: true }))
      .then(({ hike, failed }) => {
        store.set(key, { hike, failed, expiresAt: now() + (failed ? HIKE_FAILURE_TTL_MS : hike ? HIKE_TTL_MS : HIKE_NONE_TTL_MS) });
        while (store.size > HIKE_CACHE_MAX) store.delete(store.keys().next().value as string);
        return { hike, failed };
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }
  return Object.assign((lat: number, lng: number): Promise<Hike | null> => status(lat, lng).then((r) => r.hike), { status });
}

export const getHike = createHikeLookup();
/** Like `getHike` (same cache) but says whether the lookup failed, which `getHike` shows as "no hike". */
export const lookupHikeStatus = getHike.status;
