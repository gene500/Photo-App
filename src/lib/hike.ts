import { METERS_PER_MILE } from "./format";
import type { DistanceUnit } from "./settings";
import type { LngLat } from "./types";

/** The hike to a place: the walk from the nearest trailhead, with its length and where the trail data came from. */
export type Hike = {
  distanceMeters: number;
  /** Trailhead first, the place last. A simplified line (at most HIKE_MAX_POINTS points). */
  geometry: LngLat[];
  source: "nps" | "osm";
  attribution: string;
};

export const HIKE_MAX_POINTS = 200;
export const NPS_ATTRIBUTION = "Trail data: National Park Service";
export const OSM_ATTRIBUTION = "Trail data © OpenStreetMap contributors";

/** Stops on the same ~11 m grid share one lookup. */
export function hikeKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** "1.2 mi", or "1.9 km" / "850 m": distance only, one decimal (never "0"). */
export function formatHikeDistance(meters: number, unit: DistanceUnit = "km"): string {
  if (unit === "mi") return `${Math.max(0.1, Math.round((meters / METERS_PER_MILE) * 10) / 10).toFixed(1)} mi`;
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

/** True for a well-formed hike from the server (a wrong shape is treated as "no hike"). */
export function isHike(v: unknown): v is Hike {
  const h = v as Hike | null;
  return (
    !!h &&
    typeof h.distanceMeters === "number" && Number.isFinite(h.distanceMeters) && h.distanceMeters > 0 &&
    (h.source === "nps" || h.source === "osm") &&
    Array.isArray(h.geometry) && h.geometry.length >= 2 && h.geometry.length <= HIKE_MAX_POINTS &&
    h.geometry.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  );
}
