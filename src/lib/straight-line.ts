import { haversineMeters } from "./geo";

/** Rough average road speed and winding factor for estimating drive time without a routing call. */
const AVG_KMH = 80;
const WINDING = 1.3;

/** Estimated seconds per leg from straight-line distances (the public page cannot call the routing API). */
export function estimateLegDurations(stops: { lat: number; lng: number }[]): number[] {
  return stops.slice(1).map((s, i) => Math.round(((haversineMeters(stops[i]!, s) * WINDING) / 1000 / AVG_KMH) * 3600));
}
