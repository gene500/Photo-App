/**
 * "Water flowing through a pipe" along the optimized route (A49). Pure maths only: the map code in
 * route-flow-map.ts and the fake map feed it the elapsed time and draw the result.
 */

/** Time the water takes to run from the first stop to the last, then the time the finished fill takes to fade out. */
export const FLOW_SWEEP_MS = 2400;
export const FLOW_FADE_MS = 500;
export const FLOW_TOTAL_MS = FLOW_SWEEP_MS + FLOW_FADE_MS;

/** Fixed hexes like ROUTE_COLOR in MapPanel: a pale blue that reads over the brown route on light and dark maps. */
export const FLOW_TRAIL_COLOR = "rgba(120, 200, 245, 0.7)";
export const FLOW_HEAD_COLOR = "rgba(235, 249, 255, 0.98)";
const FLOW_CLEAR = "rgba(120, 200, 245, 0)";

/** How far past each end the head travels, as a share of the line, so it enters and leaves smoothly. */
const EDGE = 0.07;
/** Width of the bright head and of the soft edge ahead of it, as a share of the line. */
const HEAD = 0.03;

export function easeInOutSine(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return (1 - Math.cos(Math.PI * c)) / 2;
}

/** Where the water is `elapsedMs` after the start: the head's position along the line (-EDGE..1+EDGE) and the layer opacity. */
export function flowFrame(elapsedMs: number): { head: number; opacity: number; done: boolean } {
  if (!(elapsedMs > 0)) return { head: -EDGE, opacity: 1, done: false };
  if (elapsedMs >= FLOW_TOTAL_MS) return { head: 1 + EDGE, opacity: 0, done: true };
  const p = easeInOutSine(Math.min(elapsedMs / FLOW_SWEEP_MS, 1));
  const head = -EDGE + p * (1 + 2 * EDGE);
  const fade = elapsedMs <= FLOW_SWEEP_MS ? 0 : (elapsedMs - FLOW_SWEEP_MS) / FLOW_FADE_MS;
  return { head, opacity: 1 - fade, done: false };
}

export type GradientStop = [number, string];

/**
 * Stops for a Mapbox `line-gradient` (`["interpolate", ["linear"], ["line-progress"], ...stops]`): water filling the pipe
 * behind the head, a bright head, and a soft clear edge ahead. Offsets are strictly increasing and inside 0..1, as Mapbox requires.
 */
export function flowGradientStops(head: number): GradientStop[] {
  const raw: GradientStop[] = [
    [0, head > 0 ? FLOW_TRAIL_COLOR : FLOW_CLEAR],
    [head - HEAD * 2, FLOW_TRAIL_COLOR],
    [head - HEAD * 0.4, FLOW_HEAD_COLOR],
    [head, FLOW_HEAD_COLOR],
    [head + HEAD * 2, FLOW_CLEAR],
    [1, FLOW_CLEAR],
  ];
  // A head that has left the far end leaves the whole line filled.
  if (head >= 1) return [[0, FLOW_TRAIL_COLOR], [1, FLOW_TRAIL_COLOR]];
  const out: GradientStop[] = [];
  for (const [t, color] of raw) {
    const c = Math.min(Math.max(t, 0), 1);
    const prev = out[out.length - 1];
    if (prev && c <= prev[0] + 1e-4) continue; // collapsed onto its neighbour (off an end)
    out.push([c, color]);
  }
  if (out[out.length - 1]![0] < 1) out.push([1, FLOW_CLEAR]);
  return out;
}

/** The Mapbox expression for `flowGradientStops`. */
export function flowGradientExpression(head: number): unknown[] {
  return ["interpolate", ["linear"], ["line-progress"], ...flowGradientStops(head).flat()];
}
