import { leadingVisited } from "./visited-run";

/**
 * Where the live plan starts: the last stop of the visited run at the front (the owner is there now). 0 when nothing is visited,
 * or when every stop is (then the whole trip is the plan, there is nothing left to drive to).
 */
export function planAnchor(stops: { visited: boolean }[]): number {
  const done = leadingVisited(stops);
  return done >= stops.length ? 0 : Math.max(done - 1, 0);
}

/**
 * A per-stop schedule (arrivals, best times) for a plan that starts at `anchor`: the stops before it are behind the owner and get
 * the "no route" answer, the rest are computed from `anchor` with `legs` (the legs from the anchor onward) and the given start.
 */
export function fromAnchor<Tr extends { stops: unknown[]; departAt?: string | null }, T>(
  compute: (trip: Tr, legs: number[] | null) => T[],
  trip: Tr,
  legs: number[] | null,
  anchor: number,
  anchorDepartAt: string | null,
): T[] {
  if (anchor <= 0) return compute(trip, legs);
  const head = compute({ ...trip, stops: trip.stops.slice(0, anchor) }, null);
  const tail = compute({ ...trip, stops: trip.stops.slice(anchor), departAt: anchorDepartAt ?? trip.departAt }, legs);
  return [...head, ...tail];
}
