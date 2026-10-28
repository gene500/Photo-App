import type mapboxgl from "mapbox-gl";
import type { LngLat } from "@/lib/types";
import { flowFrame, flowGradientExpression, hiddenRange } from "./route-flow";

export const FLOW_LAYER = "route-flow";
const FIT_MS = 700;
const FIT_TIMEOUT_MS = 1500;
/** Events that mean the viewer took over the map; only their own events carry `originalEvent`. */
const USER_EVENTS = ["mousedown", "touchstart", "wheel", "dragstart", "zoomstart", "rotatestart", "pitchstart"] as const;

type FlowMap = Pick<mapboxgl.Map, "fitBounds" | "on" | "off" | "isMoving" | "addLayer" | "removeLayer" | "getLayer" | "setPaintProperty">;

/**
 * Frame every point in the part of the map nobody covers (`padding`). The one zoom-to-fit used after Optimize and by the
 * Zoom-to-fit button. `done` resolves when the move ends, when nothing needed to move, on `cancel`, or after a timeout, so
 * callers never wait for ever. A lone point (or points all in one spot) is framed with a capped zoom.
 */
export function fitMapToPoints(
  map: FlowMap,
  points: LngLat[],
  padding: mapboxgl.PaddingOptions,
  { duration = FIT_MS, timeoutMs = FIT_TIMEOUT_MS }: { duration?: number; timeoutMs?: number } = {},
): { done: Promise<void>; cancel: () => void } {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    map.off("moveend", finish);
    resolve();
  };
  if (points.length === 0) {
    finish();
    return { done, cancel: finish };
  }
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  map.on("moveend", finish);
  map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding, duration, maxZoom: 14 });
  if (!map.isMoving()) finish();
  else timer = setTimeout(finish, timeoutMs);
  return { done, cancel: finish };
}

/**
 * After a successful Optimize: hide the route (`hideLayers`), zoom out to show every point, wait for that move to end, then
 * draw the route from the first stop to the last behind a pale-blue "water" head, which then fades. With `reducedMotion` the
 * route stays as it is and it only does the fit.
 * `cancel` (also called by itself when the viewer pans, zooms or drags) stops everything and removes the layer.
 * The route source needs `lineMetrics: true` for the gradient. Pointer events are never touched.
 */
export function startRouteFlow(
  map: FlowMap,
  { points, padding, reducedMotion, source, beforeId, hideLayers = [], onEnd }: {
    points: LngLat[]; padding: mapboxgl.PaddingOptions; reducedMotion: boolean; source: string; beforeId?: string; hideLayers?: string[]; onEnd?: () => void;
  },
): { cancel: () => void } {
  let cancelled = false;
  let ended = false;
  let raf = 0;
  const interrupt = (e: unknown) => { if ((e as { originalEvent?: unknown } | undefined)?.originalEvent) cancel(); };
  const removeLayer = () => {
    try { if (map.getLayer(FLOW_LAYER)) map.removeLayer(FLOW_LAYER); } catch { /* the map is already gone */ }
  };
  // Cut the route (and its casing) away from `range[0]` to `range[1]` along the line; [0, 0] shows all of it.
  const trim = (range: [number, number]) => {
    for (const id of hideLayers) {
      try { if (map.getLayer(id)) map.setPaintProperty(id, "line-trim-offset", range); } catch { /* the map is already gone */ }
    }
  };
  const end = () => {
    if (ended) return;
    ended = true;
    if (raf) cancelAnimationFrame(raf);
    trim([0, 0]);
    for (const t of USER_EVENTS) { try { map.off(t, interrupt); } catch { /* map removed */ } }
    removeLayer();
    onEnd?.();
  };
  function cancel() {
    cancelled = true;
    fit.cancel();
    end();
  }
  for (const t of USER_EVENTS) map.on(t, interrupt);
  if (!reducedMotion) trim(hiddenRange(flowFrame(0).head)); // no full line while the map zooms out
  const fit = fitMapToPoints(map, points, padding, { duration: reducedMotion ? 0 : FIT_MS });
  void fit.done.then(() => {
    if (cancelled || ended) return;
    if (reducedMotion) return end();
    try {
      map.addLayer(
        {
          id: FLOW_LAYER,
          type: "line",
          source,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-gradient": flowGradientExpression(flowFrame(0).head) as never, "line-width": 5, "line-opacity": 1 },
        },
        beforeId,
      );
    } catch {
      return end(); // e.g. the route source is gone; skip the animation
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      if (cancelled || ended) return;
      const f = flowFrame(now - t0);
      if (f.done) return end();
      try {
        trim(hiddenRange(f.head));
        map.setPaintProperty(FLOW_LAYER, "line-gradient", flowGradientExpression(f.head) as never);
        map.setPaintProperty(FLOW_LAYER, "line-opacity", f.opacity);
      } catch {
        return end();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
  return { cancel };
}
