// Optimizing from the owner's live position. The position is one extra point in front of the stops: the optimizer already
// fixes index 0 as the start of the path, so with the position at index 0 it picks the first STOP by origin -> first + the
// rest. These helpers add that point before the search and take it out of the answer again (the client never sees it).
import type { LngLat } from "./types";

/** The stops with the position first; every index in the search is one higher than the submitted stop's. */
export function withOrigin(coordinates: LngLat[], origin: { lat: number; lng: number }): LngLat[] {
  return [[origin.lng, origin.lat], ...coordinates];
}

/** A search order over [origin, ...stops] (origin = 0) as an order over the submitted stops. */
export function orderWithoutOrigin(order: number[]): number[] {
  return order.filter((i) => i !== 0).map((i) => i - 1);
}

/** A search index (over [origin, ...stops]) as the submitted stop's index, or null for the origin itself. */
export function stopIndexWithoutOrigin(i: number): number | null {
  return i === 0 ? null : i - 1;
}

/** A position farther than this from every stop is not "from my location" for this trip (a trip planned elsewhere). */
export const MAX_ORIGIN_DISTANCE_KM = 500;

/** Straight-line distance in km. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Is the position within MAX_ORIGIN_DISTANCE_KM (straight line) of the nearest of these stops? */
export function originNearStops(origin: { lat: number; lng: number }, stops: { lat: number; lng: number }[]): boolean {
  return stops.some((s) => distanceKm(origin, s) <= MAX_ORIGIN_DISTANCE_KM);
}
