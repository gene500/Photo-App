import type { LngLat } from "@/lib/types";
import { fetchOverpass } from "@/server/suggestions/overpass";

export const OSM_TIMEOUT_MS = 12_000;
/** Overall limit for the Overpass step, whatever the mirrors do (the library may try each one and retry). */
export const OSM_DEADLINE_MS = 15_000;
/** A bigger answer than this (a dense city) makes Overpass give up, and the lookup counts as failed. */
export const OSM_MAX_BYTES = 6_000_000;
const WALKABLE = "path|footway|track|steps|bridleway";
/** A "track" named like this is a road a car can use, not a trail. */
const ROADLIKE = /\b(road|rd|highway|hwy|drive|dr|street|st|avenue|ave|lane|ln|boulevard|blvd)\b\.?$/i;

export type OsmTrails = { segments: LngLat[][]; trailheads: LngLat[]; parking: LngLat[] };

/** The Overpass query: walkable ways, the ways of hiking routes, trailhead nodes and parking, all in a box around the point (a box is much cheaper for Overpass than a circle, and big city answers are capped by maxsize). */
export function osmHikeQuery(lat: number, lng: number, radiusM: number): string {
  const dLat = radiusM / 111_320;
  const dLng = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const box = `(${(lat - dLat).toFixed(5)},${(lng - dLng).toFixed(5)},${(lat + dLat).toFixed(5)},${(lng + dLng).toFixed(5)})`;
  const hw = `["highway"~"^(${WALKABLE})$"]`;
  return (
    `[out:json][timeout:12][maxsize:${OSM_MAX_BYTES}];(` +
    `way${hw}["footway"!~"^(sidewalk|crossing)$"]${box};` +
    `rel["route"="hiking"]${box}->.h;way(r.h)${hw}${box};` +
    `node["highway"="trailhead"]${box};` +
    `node["amenity"="parking"]${box};` +
    `);out tags geom qt;`
  );
}

type Tags = Record<string, string | undefined>;

/** Walkable ways and trailhead/parking points from an `out geom` answer. null when the answer is not an element list. */
export function parseOsm(json: unknown): OsmTrails | null {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const out: OsmTrails = { segments: [], trailheads: [], parking: [] };
  for (const e of elements as { type?: string; tags?: Tags; lat?: number; lon?: number; geometry?: { lat?: number; lon?: number }[] }[]) {
    const tags = e?.tags ?? {};
    if (e?.type === "node") {
      if (typeof e.lat !== "number" || typeof e.lon !== "number") continue;
      if (tags.highway === "trailhead") out.trailheads.push([e.lon, e.lat]);
      else if (tags.amenity === "parking") out.parking.push([e.lon, e.lat]);
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

/** Trails around the point (null = Overpass failed). Never throws. */
export async function fetchOsmTrails(lat: number, lng: number, radiusM: number, fetchImpl?: typeof fetch): Promise<OsmTrails | null> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), OSM_DEADLINE_MS);
    });
    const answer = fetchOverpass(osmHikeQuery(lat, lng, radiusM), { fetchImpl, timeoutMs: OSM_TIMEOUT_MS }).then(parseOsm, () => null);
    try {
      return await Promise.race([answer, deadline]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
