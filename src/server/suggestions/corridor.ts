import buffer from "@turf/buffer";
import { lineString } from "@turf/helpers";
import simplify from "@turf/simplify";
import type { LngLat } from "@/lib/types";

/** D2: how far either side of the route to look for photo spots. */
export const CORRIDOR_KM = 2;

// Simplify the route (~500 m) before buffering, then the polygon (~200 m) after,
// so long routes produce an Overpass `poly:` filter of manageable size.
const ROUTE_SIMPLIFY_DEG = 0.005;
const POLYGON_SIMPLIFY_DEG = 0.002;

export function buildCorridor(route: LngLat[], radiusKm: number = CORRIDOR_KM): LngLat[] {
  if (route.length < 2) throw new Error("Route needs at least 2 coordinates");
  const line = simplify(lineString(route), { tolerance: ROUTE_SIMPLIFY_DEG, highQuality: false });
  const corridor = buffer(line, radiusKm, { units: "kilometers" });
  if (!corridor) throw new Error("Could not build a corridor around the route");
  const simple = simplify(corridor, { tolerance: POLYGON_SIMPLIFY_DEG, highQuality: false });
  const g = simple.geometry;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
  const outer = rings.reduce((a, b) => (b.length > a.length ? b : a));
  return outer.map(([lng, lat]) => [lng, lat] as LngLat);
}

export function toOverpassPoly(ring: LngLat[]): string {
  return ring.map(([lng, lat]) => `${lat.toFixed(5)} ${lng.toFixed(5)}`).join(" ");
}

export function buildOverpassQuery(poly: string, timeoutSec = 10): string {
  return [
    `[out:json][timeout:${timeoutSec}];`,
    "(",
    `  nwr["tourism"~"^(viewpoint|attraction)$"](poly:"${poly}");`,
    `  node["natural"="peak"](poly:"${poly}");`,
    ");",
    "out center 500;",
  ].join("\n");
}
