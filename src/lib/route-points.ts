import type { LngLat } from "@/lib/types";

type Routable = { lat: number; lng: number; access?: { lat: number; lng: number } | null };

/** Where the car goes for a stop: its saved parking lot when it has one, else the stop itself. */
export function routePoint(stop: Routable): LngLat {
  return stop.access ? [stop.access.lng, stop.access.lat] : [stop.lng, stop.lat];
}

/** `routePoint` for each stop, in order. Every drive calculation (directions, Optimize, share page) goes through this. */
export function routePoints(stops: Routable[]): LngLat[] {
  return stops.map(routePoint);
}
