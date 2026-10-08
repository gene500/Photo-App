import buffer from "@turf/buffer";
import { lineString } from "@turf/helpers";
import simplify from "@turf/simplify";
import type { LngLat } from "@/lib/types";

/** D2: how far either side of the route to look for photo spots. */
export const CORRIDOR_KM = 2;

// Simplify the route (~500 m) before buffering, then the polygon (~200 m) after,
// so long routes produce an Overpass `poly:` filter of manageable size.
// Long routes keep more detail than 200 points at the finest tolerance (a real
// 1,900 km route simplifies to ~280), so coarsen step by step before giving up.
// Simplifying can move the line up to `tolerance` away from the real road, so the
// buffer is widened by the extra error beyond the finest step (see buildCorridor).
const KM_PER_DEG = 111;
const ROUTE_SIMPLIFY_STEPS_DEG = [0.005, 0.01, 0.02, 0.04];
const POLYGON_SIMPLIFY_DEG = 0.002;

// buffer()'s cost scales with the SIMPLIFIED point count, not the raw input
// size — a raw-coordinate-count cap alone can't catch this, because adversarial
// input (a zigzag whose amplitude is tuned just above the simplify tolerance) barely
// shrinks under simplify() while real route geometry (gentle curves following
// actual roads) collapses to a tiny fraction of its input size. A real
// road-trip route, even an unusually winding one, simplifies down to well
// under 100-200 points at this tolerance; anything still above that is either
// pathological input or a corridor too complex to be a useful request anyway.
const MAX_SIMPLIFIED_ROUTE_POINTS = 200;

export function buildCorridor(route: LngLat[], radiusKm: number = CORRIDOR_KM): LngLat[] {
  if (route.length < 2) throw new Error("Route needs at least 2 coordinates");
  const input = lineString(route);
  let used = ROUTE_SIMPLIFY_STEPS_DEG[0];
  let line = simplify(input, { tolerance: used, highQuality: false });
  for (const tolerance of ROUTE_SIMPLIFY_STEPS_DEG.slice(1)) {
    if (line.geometry.coordinates.length <= MAX_SIMPLIFIED_ROUTE_POINTS) break;
    used = tolerance;
    line = simplify(input, { tolerance, highQuality: false });
  }
  if (line.geometry.coordinates.length > MAX_SIMPLIFIED_ROUTE_POINTS) {
    throw new Error("Route is too complex to build a corridor for");
  }
  const extraKm = (used - ROUTE_SIMPLIFY_STEPS_DEG[0]) * KM_PER_DEG;
  const corridor = buffer(line, radiusKm + extraKm, { units: "kilometers" });
  if (!corridor) throw new Error("Could not build a corridor around the route");
  const simple = simplify(corridor, { tolerance: POLYGON_SIMPLIFY_DEG, highQuality: false });
  const g = simple.geometry;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
  const outer = rings.reduce((a, b) => (b.length > a.length ? b : a));
  return outer.map(([lng, lat]) => [lng, lat] as LngLat);
}

/** About 15 miles: the search radius around a trip's first stop, before there is a route to follow. */
export const AROUND_RADIUS_KM = 24;

export function toOverpassPoly(ring: LngLat[]): string {
  return ring.map(([lng, lat]) => `${lat.toFixed(5)} ${lng.toFixed(5)}`).join(" ");
}

export function buildOverpassQuery(poly: string, timeoutSec = 25): string {
  return [
    `[out:json][timeout:${timeoutSec}];`,
    "(",
    `  nwr["tourism"~"^(viewpoint|attraction)$"](poly:"${poly}");`,
    `  node["natural"="peak"]["name"](poly:"${poly}");`,
    ");",
    "out center 500;",
  ].join("\n");
}

/**
 * Each kind gets its own output cap: one shared `out 500` keeps the lowest ids, so in a dense area
 * (a city's many attractions) it would crowd out the viewpoints and peaks we want most.
 */
export function buildOverpassAroundQuery(lng: number, lat: number, radiusKm: number = AROUND_RADIUS_KM, timeoutSec = 25): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(5)},${lng.toFixed(5)})`;
  return [
    `[out:json][timeout:${timeoutSec}];`,
    `nwr["tourism"="viewpoint"]${around}->.vp;`,
    `node["natural"="peak"]["name"]${around}->.pk;`,
    `nwr["tourism"="attraction"]${around}->.at;`,
    ".vp out center 200;",
    ".pk out center 200;",
    ".at out center 150;",
  ].join("\n");
}
