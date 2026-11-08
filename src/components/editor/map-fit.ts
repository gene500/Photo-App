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

export type Padding = { top?: number; right?: number; bottom?: number; left?: number };

/**
 * Padding that centres a selected stop (and its sunrise/sunset arrows) in the part of the map nobody is covering.
 * `base` already clears the trip panel / bottom sheet; the Edit stop drawer docks on the right, so its width
 * (0 when closed or when it is a full-screen sheet on phones) is added on that side.
 */
export function selectionPadding<P extends Padding>(base: P, drawerWidth: number): P {
  return drawerWidth > 0 ? { ...base, right: Math.max(base.right ?? 0, Math.round(drawerWidth) + 16) } : base;
}

/**
 * Bottom padding on phones: clears the sheet wherever it is snapped. `sheetTop` is the sheet's top edge in px from the
 * top of the page (null when it cannot be measured: then the usual snap height is assumed). Plus a marker radius, and
 * never so much that less than `minFree` px of the map is left for the points.
 */
export function sheetBottomPadding({ height, sheetTop, readOnly, top, minFree = 80 }: { height: number; sheetTop: number | null; readOnly: boolean; top: number; minFree?: number }): number {
  const covered = sheetTop !== null && sheetTop >= 0 && sheetTop <= height ? height - sheetTop : Math.round(height * (readOnly ? 0.57 : 0.45));
  return Math.max(0, Math.min(covered + 18, height - top - minFree));
}
