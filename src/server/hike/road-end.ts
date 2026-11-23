import type { LngLat } from "@/lib/types";
import { haversineMeters } from "@/lib/geo";
import { findHikePath, lineLengthMeters } from "./graph";
import { ROADLIKE, WALKABLE } from "./osm";
import { LOT_MAX_WALK_M } from "./service";

/** A stop this close to a drivable road (straight line) needs no road end. */
export const ROAD_NEAR_M = 100;
/** How far around the stop roads are looked for (the box radius, and the longest straight walk to a road). */
export const ROAD_SEARCH_M = 5000;

const MAX_BYTES = 6_000_000;
const ROAD_HIGHWAYS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link";
const ROAD_SET = new Set(ROAD_HIGHWAYS.split("|"));
const SERVICE_EXCLUDED = "driveway|parking_aisle|alley|emergency_access|drive-through";
const WALKABLE_RE = new RegExp(`^(${WALKABLE})$`);
const STOP_GAP_M = 5;
const ROAD_VERTEX_SPACING_M = 50;
const M_PER_DEG = 111_320;

export type RoadData = { roads: LngLat[][]; trails: LngLat[][] };
export type RoadEndChoice = { kind: "near-road" } | { kind: "none" } | { kind: "road-end"; point: LngLat; trail: LngLat[] | null; walkMeters: number };

/** One Overpass query for the drivable roads and the walkable ways in a box (not `around:`) of the radius, printed with geometry. */
export function roadEndQuery(lat: number, lng: number, radiusM: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("roadEndQuery needs finite lat and lng");
  const dLat = radiusM / M_PER_DEG;
  const dLng = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v)).toFixed(5);
  const box = `(${clamp(lat - dLat, 90)},${clamp(lng - dLng, 180)},${clamp(lat + dLat, 90)},${clamp(lng + dLng, 180)})`;
  const roads = `["highway"~"^(${ROAD_HIGHWAYS})$"]["access"!~"^(private|no)$"]["motor_vehicle"!="no"]["service"!~"^(${SERVICE_EXCLUDED})$"]`;
  const trails = `["highway"~"^(${WALKABLE})$"]["footway"!~"^(sidewalk|crossing)$"]`;
  return `[out:json][timeout:10][maxsize:${MAX_BYTES}];(way${roads}${box};way${trails}${box};);out tags geom qt;`;
}

type Tags = Record<string, string | undefined>;
const validPoint = (lat: unknown, lng: unknown): boolean => typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Roads a car can use and walkable ways from an `out geom` answer. null when the answer has no element list. */
export function parseRoadEnd(json: unknown): RoadData | null {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const out: RoadData = { roads: [], trails: [] };
  for (const e of elements as { type?: string; tags?: Tags; geometry?: { lat?: number; lon?: number }[] }[]) {
    if (e?.type !== "way" || !Array.isArray(e.geometry)) continue;
    const tags = e.tags ?? {};
    const hw = tags.highway ?? "";
    const pts = e.geometry.filter((p) => p && validPoint(p.lat, p.lon)).map((p): LngLat => [p.lon as number, p.lat as number]);
    if (pts.length < 2) continue;
    if (ROAD_SET.has(hw)) {
      if (tags.access === "private" || tags.access === "no" || tags.motor_vehicle === "no") continue;
      if (hw === "service" && tags.service && SERVICE_EXCLUDED.split("|").includes(tags.service)) continue;
      out.roads.push(pts);
    } else if (WALKABLE_RE.test(hw)) {
      if (tags.access === "private" || tags.access === "no" || tags.foot === "no") continue;
      if (tags.footway === "sidewalk" || tags.footway === "crossing" || tags.footway === "traffic_island") continue;
      if (hw === "track" && tags.name && ROADLIKE.test(tags.name.trim())) continue;
      out.trails.push(pts);
    }
  }
  return out;
}

type Hit = { d: number; point: LngLat };

/** The nearest point of the roads to `at`, in a flat metre grid around `at`. */
function nearestOnRoads(roads: LngLat[][], at: { lat: number; lng: number }): Hit | null {
  const kx = Math.cos((at.lat * Math.PI) / 180) * M_PER_DEG;
  let best: Hit | null = null;
  for (const road of roads) {
    for (let i = 1; i < road.length; i++) {
      const ax = (road[i - 1][0] - at.lng) * kx, ay = (road[i - 1][1] - at.lat) * M_PER_DEG;
      const bx = (road[i][0] - at.lng) * kx, by = (road[i][1] - at.lat) * M_PER_DEG;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const x = ax + t * dx, y = ay + t * dy;
      const d = Math.hypot(x, y);
      if (!best || d < best.d) best = { d, point: [at.lng + x / kx, at.lat + y / M_PER_DEG] };
    }
  }
  return best;
}

/** Distance in metres from `at` to the nearest road segment (Infinity when there are no roads). */
export function nearestRoadDistanceM(roads: LngLat[][], at: { lat: number; lng: number }): number {
  return nearestOnRoads(roads, at)?.d ?? Infinity;
}

/** Every vertex of every road within ROAD_SEARCH_M of `at`, with extra points so none are more than 50 m apart. */
function roadVertices(roads: LngLat[][], at: { lat: number; lng: number }): LngLat[] {
  const out: LngLat[] = [];
  const near = (p: LngLat) => haversineMeters(at, { lat: p[1], lng: p[0] }) <= ROAD_SEARCH_M;
  for (const road of roads) {
    for (let i = 0; i < road.length; i++) {
      if (near(road[i])) out.push(road[i]);
      if (i === 0) continue;
      const [a, b] = [road[i - 1], road[i]];
      const steps = Math.ceil(haversineMeters({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }) / ROAD_VERTEX_SPACING_M);
      for (let s = 1; s < steps; s++) {
        const p: LngLat = [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps];
        if (near(p)) out.push(p);
      }
    }
  }
  return out;
}

const round10 = (m: number) => Math.round(m / 10) * 10;

/** Where the car stops for an off-road stop: nothing needed, no road in reach, or a road end with the trail from it (when OSM has one). */
export function chooseRoadEnd(data: RoadData, at: { lat: number; lng: number }): RoadEndChoice {
  const nearest = nearestOnRoads(data.roads, at);
  if (!nearest) return { kind: "none" };
  const nearestM = haversineMeters(at, { lat: nearest.point[1], lng: nearest.point[0] });
  if (nearestM <= ROAD_NEAR_M) return { kind: "near-road" };

  const vertices = roadVertices(data.roads, at);
  if (vertices.length > 0 && data.trails.length > 0) {
    const hike = findHikePath(data.trails, at, { trailheadTiers: [vertices], tierMaxM: [LOT_MAX_WALK_M], snapTrailheadM: 25, minM: 0 });
    if (hike && hike.start.kind === "tier") {
      const point = vertices[hike.start.index];
      const trail = hike.coords.slice();
      if (haversineMeters({ lat: point[1], lng: point[0] }, { lat: trail[0][1], lng: trail[0][0] }) > 1) trail.unshift(point);
      const last = trail[trail.length - 1];
      if (haversineMeters({ lat: last[1], lng: last[0] }, at) > STOP_GAP_M) trail.push([at.lng, at.lat]);
      const total = lineLengthMeters(trail);
      if (total <= LOT_MAX_WALK_M) return { kind: "road-end", point, trail, walkMeters: round10(total) };
    }
  }
  if (nearestM > ROAD_SEARCH_M) return { kind: "none" };
  return { kind: "road-end", point: nearest.point, trail: null, walkMeters: round10(nearestM) };
}
