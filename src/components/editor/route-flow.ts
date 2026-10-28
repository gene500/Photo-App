/**
 * "Water flowing through a pipe" along the optimized route (A49). Pure maths only: the map code in
 * route-flow-map.ts and the fake map feed it the elapsed time and draw the result.
 */

/** Time the water takes to run from the first stop to the last, then the time the glow takes to fade out. */
export const FLOW_SWEEP_MS = 5000;
export const FLOW_FADE_MS = 500;
export const FLOW_TOTAL_MS = FLOW_SWEEP_MS + FLOW_FADE_MS;

/** Fixed hexes like ROUTE_COLOR in MapPanel: a pale blue that reads over the brown route on light and dark maps. The route itself is uncovered behind the head (see hiddenRange), so the glow is only a short soft tail. */
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

/** The part of the route still hidden at `head`: from the head to the far end (a Mapbox `line-trim-offset`). */
export function hiddenRange(head: number): [number, number] {
  return [Math.min(Math.max(head, 0), 1), 1];
}

/**
 * Stops for a Mapbox `line-gradient` (`["interpolate", ["linear"], ["line-progress"], ...stops]`): a short soft glow that
 * trails into a bright head, and a clear line everywhere else. The route itself is uncovered behind the head by hiddenRange.
 * Offsets are strictly increasing and inside 0..1, as Mapbox requires.
 */
export function flowGradientStops(head: number): GradientStop[] {
  const raw: GradientStop[] = [
    [0, FLOW_CLEAR],
    [head - HEAD * 3, FLOW_CLEAR],
    [head - HEAD * 0.4, FLOW_TRAIL_COLOR],
    [head, FLOW_HEAD_COLOR],
    [head + HEAD * 1.5, FLOW_CLEAR],
    [1, FLOW_CLEAR],
  ];
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
