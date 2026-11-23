import type { LngLat } from "@/lib/types";
import { haversineMeters } from "@/lib/geo";
import { cleanLine } from "@/lib/text";
import { fetchOverpass, OverpassTooHeavyError } from "@/server/suggestions/overpass";

const OSM_TIMEOUT_MS = 12_000;
/** Overall limit for the Overpass step, whatever the mirrors do (the library may try each one and retry). */
export const OSM_DEADLINE_MS = 15_000;
/** A bigger answer than this (a dense city) makes Overpass give up; when two mirrors both say so, the lookup counts as a finished one with no lot (one mirror alone may just be overloaded). */
const OSM_MAX_BYTES = 6_000_000;
export const WALKABLE = "path|footway|track|steps|bridleway";
/** A "track" named like this is a road a car can use, not a trail. */
export const ROADLIKE = /\b(road|rd|highway|hwy|drive|dr|street|st|avenue|ave|lane|ln|boulevard|blvd)\b\.?$/i;

/** A place a car can stop or a walk starts: its point and its OSM `name` (trimmed, at most 120 characters), if any. */
export type Lot = { point: LngLat; name: string | null };
export type OsmTrails = { segments: LngLat[][]; trailheads: Lot[]; parking: Lot[] };

const NAME_MAX = 120;
const lotName = (tags: Record<string, string | undefined>): string | null => cleanLine(tags.name, NAME_MAX);

/** The Overpass query: walkable ways, the ways of hiking routes, trailhead nodes and parking, all in a box around the point (a box is much cheaper for Overpass than a circle, and big city answers are capped by maxsize). Two sets, each printed in a documented form: trails and trailheads with `geom`, parking with `center` (a node still has lat/lon; a way or relation gets its centre point). */
export function osmHikeQuery(lat: number, lng: number, radiusM: number): string {
  const dLat = radiusM / 111_320;
  const dLng = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  // Clamped to the valid range (not wrapped): near a pole or the antimeridian the box is just smaller.
  const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v)).toFixed(5);
  const box = `(${clamp(lat - dLat, 90)},${clamp(lng - dLng, 180)},${clamp(lat + dLat, 90)},${clamp(lng + dLng, 180)})`;
  const hw = `["highway"~"^(${WALKABLE})$"]`;
  return (
    `[out:json][timeout:12][maxsize:${OSM_MAX_BYTES}];(` +
    `way${hw}["footway"!~"^(sidewalk|crossing)$"]${box};` +
    `rel["route"="hiking"]${box}->.h;way(r.h)${hw}${box};` +
    `node["highway"="trailhead"]${box};` +
    `)->.t;.t out tags geom qt;` +
    `nwr["amenity"="parking"]${box}->.p;.p out tags center qt;`
  );
}

type Tags = Record<string, string | undefined>;

/** A real position: finite, |lat| <= 90, |lng| <= 180 (a bad OSM node must not become a route point). */
const validPoint = (lat: unknown, lng: unknown): boolean => typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Walkable ways and trailhead/parking points from an `out geom` answer. null when the answer is not an element list. */
export function parseOsm(json: unknown): OsmTrails | null {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const out: OsmTrails = { segments: [], trailheads: [], parking: [] };
  for (const e of elements as { type?: string; tags?: Tags; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; geometry?: { lat?: number; lon?: number }[] }[]) {
    const tags = e?.tags ?? {};
    if (tags.amenity === "parking" && (e?.type === "node" || e?.type === "way" || e?.type === "relation")) {
      if (tags.access === "private" || tags.access === "no" || tags.access === "customers" || tags.access === "permit") continue;
      if (tags.parking === "street_side" || tags.parking === "lane" || tags.parking === "underground") continue;
      const c = typeof e.lat === "number" && typeof e.lon === "number" ? e : e.center;
      if (!validPoint(c?.lat, c?.lon)) continue;
      out.parking.push({ point: [c!.lon as number, c!.lat as number], name: lotName(tags) });
      continue;
    }
    if (e?.type === "node") {
      if (!validPoint(e.lat, e.lon)) continue;
      if (tags.highway === "trailhead") out.trailheads.push({ point: [e.lon as number, e.lat as number], name: lotName(tags) });
      continue;
    }
    if (e?.type !== "way" || !Array.isArray(e.geometry)) continue;
    if (!new RegExp(`^(${WALKABLE})$`).test(tags.highway ?? "")) continue;
    if (tags.access === "private" || tags.access === "no" || tags.foot === "no") continue;
    if (tags.footway === "sidewalk" || tags.footway === "crossing" || tags.footway === "traffic_island") continue;
    if (tags.highway === "track" && tags.name && ROADLIKE.test(tags.name.trim())) continue;
    const pts = e.geometry.filter((p) => p && typeof p.lat === "number" && typeof p.lon === "number").map((p): LngLat => [p.lon as number, p.lat as number]);
    if (pts.length >= 2) out.segments.push(pts);
  }
  return out;
}

/** The box reaches ~1.4 x the radius at its corners: lots and trailheads outside the true circle are dropped (trails are left to the walk-length limits). */
function withinRadius(osm: OsmTrails | null, lat: number, lng: number, radiusM: number): OsmTrails | null {
  if (!osm) return osm;
  const near = (l: Lot) => haversineMeters({ lat, lng }, { lat: l.point[1], lng: l.point[0] }) <= radiusM;
  return { ...osm, trailheads: osm.trailheads.filter(near), parking: osm.parking.filter(near) };
}

/** Trails around the point (null = Overpass failed). Never throws. */
export async function fetchOsmTrails(lat: number, lng: number, radiusM: number, fetchImpl?: typeof fetch): Promise<OsmTrails | null> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), OSM_DEADLINE_MS);
    });
    // Too much data here (a dense city; two mirrors agreed): Overpass answered, there is just nothing usable, so it is a finished empty result, not a failure.
    const answer = fetchOverpass(osmHikeQuery(lat, lng, radiusM), { fetchImpl, timeoutMs: OSM_TIMEOUT_MS, stopOnHeavy: true }).then((json) => withinRadius(parseOsm(json), lat, lng, radiusM), (e: unknown): OsmTrails | null => (e instanceof OverpassTooHeavyError ? { segments: [], trailheads: [], parking: [] } : null));
    try {
      return await Promise.race([answer, deadline]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
