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

/** A corridor polygon: its outer ring, and the rings of any holes in it (a loop route encloses an area far from every road). */
export type CorridorShape = { outer: LngLat[]; holes: LngLat[][] };

const toLngLats = (ring: number[][]): LngLat[] => ring.map(([lng, lat]) => [lng, lat] as LngLat);

/** The route cannot be turned into a corridor (too complex, or no valid polygon around it): retrying never helps. */
export class CorridorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorridorError";
  }
}

/** Longitudes made continuous: a step of more than 180 degrees is the short way across the date line, so 360 is added or removed. */
function unwrapRoute(route: LngLat[]): LngLat[] {
  let shift = 0;
  return route.map(([lng, lat], i) => {
    if (i > 0) {
      const step = lng - route[i - 1][0];
      if (step > 180) shift -= 360;
      else if (step < -180) shift += 360;
    }
    return [lng + shift, lat] as LngLat;
  });
}

/** Sutherland-Hodgman against one vertical line: keeps the part of an (open) ring on the `keepAbove` side of x = edge. */
function clipRing(ring: LngLat[], edge: number, keepAbove: boolean): LngLat[] {
  const inside = (p: LngLat) => (keepAbove ? p[0] >= edge : p[0] <= edge);
  const out: LngLat[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) out.push([edge, a[1] + ((b[1] - a[1]) * (edge - a[0])) / (b[0] - a[0])] as LngLat);
  }
  return out;
}

/** The part of a closed ring inside the 360 degree band `index` (0 is -180..180), shifted into -180..180; null when nothing is left. */
function bandOfRing(ring: LngLat[], index: number): LngLat[] | null {
  const open = ring.slice(0, -1);
  const lo = 180 * (2 * index - 1);
  const clipped = clipRing(clipRing(open, lo, true), lo + 360, false);
  if (clipped.length < 3) return null;
  const shifted = clipped.map(([lng, lat]) => [lng - 360 * index, lat] as LngLat);
  return [...shifted, shifted[0]];
}

/** A shape whose longitudes may run past +-180 (an unwrapped route), cut into one shape per 360 degree band, each inside -180..180. */
function splitAtDateLine(shape: CorridorShape): CorridorShape[] {
  const xs = shape.outer.map((p) => p[0]);
  if (Math.min(...xs) >= -180 && Math.max(...xs) <= 180) return [shape];
  const first = Math.floor((Math.min(...xs) + 180) / 360);
  const last = Math.floor((Math.max(...xs) + 180) / 360);
  const parts: CorridorShape[] = [];
  for (let band = first; band <= last; band++) {
    const outer = bandOfRing(shape.outer, band);
    if (!outer) continue;
    const holes = shape.holes.map((h) => bandOfRing(h, band)).filter((h): h is LngLat[] => h !== null);
    parts.push({ outer, holes });
  }
  return parts;
}

/**
 * The corridor around a route, as one shape, or two when it crosses the date line (each inside -180..180, which is what
 * the `poly:` filter and the grid cells need). The route is unwrapped first so the corridor follows the short way across.
 * Throws CorridorError when no corridor can be built.
 */
export function buildCorridorShapes(route: LngLat[], radiusKm: number = CORRIDOR_KM): CorridorShape[] {
  if (route.length < 2) throw new CorridorError("Route needs at least 2 coordinates");
  try {
    return splitAtDateLine(buildShapeNear(unwrapRoute(route), radiusKm));
  } catch (e) {
    throw e instanceof CorridorError ? e : new CorridorError(e instanceof Error ? e.message : "Could not build a route corridor");
  }
}

/** turf wraps its output back into -180..180, so a route near the date line is built centred on 0 and moved back afterwards. */
function buildShapeNear(route: LngLat[], radiusKm: number): CorridorShape {
  const xs = route.map((p) => p[0]);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (lo >= -170 && hi <= 170) return buildShape(route, radiusKm);
  const mid = (lo + hi) / 2;
  const back = (ring: LngLat[]) => ring.map(([lng, lat]) => [lng + mid, lat] as LngLat);
  const { outer, holes } = buildShape(route.map(([lng, lat]) => [lng - mid, lat] as LngLat), radiusKm);
  return { outer: back(outer), holes: holes.map(back) };
}

function buildShape(route: LngLat[], radiusKm: number): CorridorShape {
  const input = lineString(route);
  let used = ROUTE_SIMPLIFY_STEPS_DEG[0];
  let line = simplify(input, { tolerance: used, highQuality: false });
  for (const tolerance of ROUTE_SIMPLIFY_STEPS_DEG.slice(1)) {
    if (line.geometry.coordinates.length <= MAX_SIMPLIFIED_ROUTE_POINTS) break;
    used = tolerance;
    line = simplify(input, { tolerance, highQuality: false });
  }
  if (line.geometry.coordinates.length > MAX_SIMPLIFIED_ROUTE_POINTS) {
    throw new CorridorError("Route is too complex to build a corridor for");
  }
  const extraKm = (used - ROUTE_SIMPLIFY_STEPS_DEG[0]) * KM_PER_DEG;
  const corridor = buffer(line, radiusKm + extraKm, { units: "kilometers" });
  if (!corridor) throw new CorridorError("Could not build a corridor around the route");
  const simple = simplify(corridor, { tolerance: POLYGON_SIMPLIFY_DEG, highQuality: false });
  const g = simple.geometry;
  // A MultiPolygon (rare) keeps only its largest polygon, as before, with that polygon's holes.
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const biggest = polygons.reduce((a, b) => (b[0].length > a[0].length ? b : a));
  return { outer: toLngLats(biggest[0]), holes: biggest.slice(1).map(toLngLats) };
}

/** The first (and, unless the route crosses the date line, only) part of the corridor; see `buildCorridorShapes`. */
export function buildCorridorShape(route: LngLat[], radiusKm: number = CORRIDOR_KM): CorridorShape {
  return buildCorridorShapes(route, radiusKm)[0];
}

/** The outer ring of the corridor (see `buildCorridorShape` for its holes). */
export function buildCorridor(route: LngLat[], radiusKm: number = CORRIDOR_KM): LngLat[] {
  return buildCorridorShape(route, radiusKm).outer;
}

/** About 15 miles: the search radius around a trip's first stop, before there is a route to follow. */
export const AROUND_RADIUS_KM = 24;

export function toOverpassPoly(ring: LngLat[]): string {
  return ring.map(([lng, lat]) => `${lat.toFixed(5)} ${lng.toFixed(5)}`).join(" ");
}

/** The Overpass `out` cap on a corridor query; a response this long may have been cut short. */
export const OVERPASS_OUT_CAP = 500;

/** One `poly:` ring, or several (a corridor across the date line is two). */
export function buildOverpassQuery(poly: string | string[], timeoutSec = 25): string {
  const polys = Array.isArray(poly) ? poly : [poly];
  return [
    `[out:json][timeout:${timeoutSec}];`,
    "(",
    ...polys.flatMap((p) => [
      `  nwr["tourism"~"^(viewpoint|attraction)$"](poly:"${p}");`,
      `  node["natural"="peak"]["name"](poly:"${p}");`,
    ]),
    ");",
    `out center ${OVERPASS_OUT_CAP};`,
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
