/**
 * Whether the map should frame the stops itself (no route is drawn before Optimize). Once, when there are 2+ stops and
 * nothing was framed yet; and again when an emptier trip reaches 2 stops (it was never framed with a real pair). Never
 * on later adds, so the user's own panning is not fought.
 */
export function shouldFitStops({ prevCount, count, routePoints, fitted }: { prevCount: number; count: number; routePoints: number; fitted: boolean }): boolean {
  if (routePoints > 1 || count < 2) return false;
  return !fitted || prevCount < 2;
}
