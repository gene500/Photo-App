import type { LngLat } from "@/lib/types";

/** Identity of a drawn route: a new Optimize (or Undo) gives a different one, a plain re-render the same. */
export function routeKey(geometry: LngLat[] | null | undefined): string | null {
  if (!geometry || geometry.length < 2) return null;
  const a = geometry[0]!;
  const b = geometry[geometry.length - 1]!;
  return `${geometry.length}:${a[0]},${a[1]}:${b[0]},${b[1]}`;
}

/**
 * What the map should frame now. A route frames the view once each time a new one appears (after Optimize or Undo),
 * never while the same route is simply re-rendered, so the user's own panning is not fought. With no route (before
 * Optimize) the stops are framed: once when there are 2+ and nothing was framed yet, and again when a trip with fewer
 * than 2 stops reaches 2. Never on later adds.
 */
export function decideFit({ prevCount, count, route, fittedRoute, fitted }: {
  prevCount: number;
  count: number;
  /** `routeKey` of the drawn route, null when none (an empty geometry counts as none). */
  route: string | null;
  /** `routeKey` of the route last framed, null when none is. */
  fittedRoute: string | null;
  /** Whether the map has been framed by anything yet. */
  fitted: boolean;
}): "route" | "stops" | null {
  if (route) return route !== fittedRoute ? "route" : null;
  if (count < 2) return null;
  return !fitted || prevCount < 2 ? "stops" : null;
}
