import { routeLengthKm } from "./geo";
import { MAX_SUGGESTIONS_ROUTE_KM } from "./limits";
import type { LngLat } from "./types";

/** Server cap is 2000 points; stay well under it. */
const SUGGESTIONS_TARGET_POINTS = 1500;

/** Evenly pick up to `target` points from a route line, always keeping the first and last. */
export function downsampleRoute(points: LngLat[], target = SUGGESTIONS_TARGET_POINTS): LngLat[] {
  if (points.length <= target) return points;
  const n = Math.max(2, Math.floor(target));
  const last = points.length - 1;
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) out.push(points[Math.round((i * last) / (n - 1))]!);
  return out;
}

/** True when the suggestions endpoint would refuse this route as too long (it answers 400); measured on the points that would be sent. */
export const routeTooLongForSuggestions = (points: LngLat[]) => routeLengthKm(downsampleRoute(points)) > MAX_SUGGESTIONS_ROUTE_KM;
