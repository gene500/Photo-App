import type { LngLat } from "@/lib/types";

/** [zoom, px] stops, strictly increasing in zoom. The route thins when zoomed out so close roads don't clump. */
export const ROUTE_WIDTH_STOPS: ReadonlyArray<readonly [number, number]> = [[5, 2], [9, 3], [12, 4], [15, 6]];
/** The white casing is this much wider than the route line. */
export const CASING_EXTRA_PX = 2;

/** A Mapbox `["interpolate", ["linear"], ["zoom"], ...]` width expression from zoom stops. */
export function widthExpression(stops: ReadonlyArray<readonly [number, number]> = ROUTE_WIDTH_STOPS, extra = 0) {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flatMap(([z, w]) => [z, w + extra])];
}

export const routeLineWidth = () => widthExpression(ROUTE_WIDTH_STOPS, 0);
export const casingLineWidth = () => widthExpression(ROUTE_WIDTH_STOPS, CASING_EXTRA_PX);

/** Simplification stops being applied from this zoom up (the line is drawn as saved). */
export const SIMPLIFY_MAX_ZOOM = 12;
/** Wiggles smaller than this many screen pixels are smoothed away. */
export const SIMPLIFY_PX = 1.5;

/** Simplify tolerance in degrees for a zoom: SIMPLIFY_PX screen pixels (512 px tiles); 0 means draw as saved. */
export function simplifyToleranceDeg(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom >= SIMPLIFY_MAX_ZOOM) return 0;
  return (SIMPLIFY_PX * 360) / (512 * 2 ** zoom);
}

/** The zoom is bucketed to whole levels so the line is only rebuilt when the level changes. */
export const simplifyBucket = (zoom: number): number => (Number.isFinite(zoom) ? Math.floor(zoom) : SIMPLIFY_MAX_ZOOM);

/** Douglas-Peucker on plain [lng, lat] pairs; endpoints (first and last stop) are always kept. */
export function simplifyRoute(points: LngLat[], toleranceDeg: number): LngLat[] {
  if (toleranceDeg <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const t2 = toleranceDeg * toleranceDeg;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
      const d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * The layer id to draw the route (and its casing) under: the first text/icon layer of the base style, so road names, place
 * names and shields stay readable on top of the line. `undefined` (draw on top) when the style has no symbol layer.
 */
export function firstLabelLayerId(layers: readonly { id: string; type: string }[] | undefined): string | undefined {
  return layers?.find((l) => l.type === "symbol")?.id;
}
