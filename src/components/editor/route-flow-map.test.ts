import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOW_LAYER, fitMapToPoints, startRouteFlow } from "./route-flow-map";
import { FLOW_TOTAL_MS } from "./route-flow";

type Handler = (e?: unknown) => void;
function fakeMap(opts: { moving?: boolean } = {}) {
  const handlers = new Map<string, Set<Handler>>();
  const layers = new Set<string>();
  const m = {
    handlers,
    layers,
    moving: opts.moving ?? true,
    fitBounds: vi.fn(),
    on: vi.fn((t: string, h: Handler) => { (handlers.get(t) ?? handlers.set(t, new Set()).get(t)!).add(h); }),
    off: vi.fn((t: string, h: Handler) => { handlers.get(t)?.delete(h); }),
    isMoving: () => m.moving,
    addLayer: vi.fn((l: { id: string }) => { layers.add(l.id); }),
    removeLayer: vi.fn((id: string) => { layers.delete(id); }),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    setPaintProperty: vi.fn(),
    emit(t: string, e?: unknown) { for (const h of [...(handlers.get(t) ?? [])]) h(e); },
  };
  return m;
}
const pts: [number, number][] = [[-120, 36], [-118, 38], [-119, 37]];
const padding = { top: 1, right: 2, bottom: 3, left: 4 };
const asMap = (m: ReturnType<typeof fakeMap>) => m as never;

describe("fitMapToPoints", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fits the bounds of all points with the padding and resolves on moveend", async () => {
    const m = fakeMap();
    const { done } = fitMapToPoints(asMap(m), pts, padding);
    expect(m.fitBounds).toHaveBeenCalledWith([[-120, 36], [-118, 38]], expect.objectContaining({ padding }));
    let resolved = false;
    void done.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false);
    m.emit("moveend");
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    expect(m.handlers.get("moveend")?.size).toBe(0);
  });
  it("resolves at once when nothing moves, and after the timeout when moveend never comes", async () => {
    const still = fakeMap({ moving: false });
    let a = false;
    void fitMapToPoints(asMap(still), pts, padding).done.then(() => { a = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toBe(true);
    const stuck = fakeMap();
    let b = false;
    void fitMapToPoints(asMap(stuck), pts, padding).done.then(() => { b = true; });
    await vi.advanceTimersByTimeAsync(1400);
    expect(b).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(b).toBe(true);
  });
  it("does nothing for no points", async () => {
    const m = fakeMap();
    await fitMapToPoints(asMap(m), [], padding).done;
    expect(m.fitBounds).not.toHaveBeenCalled();
  });
});

describe("startRouteFlow", () => {
  let now = 0;
  let frames: ((t: number) => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    frames = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const step = (ms: number) => { now += ms; const f = frames; frames = []; f.forEach((cb) => cb(now)); };
  const opts = { points: pts, padding, reducedMotion: false, source: "route" };

  it("waits for the fit to end, sweeps the layer, then removes it and reports the end", async () => {
    const m = fakeMap();
    const onEnd = vi.fn();
    startRouteFlow(asMap(m), { ...opts, onEnd });
    await vi.advanceTimersByTimeAsync(300);
    expect(m.layers.has(FLOW_LAYER)).toBe(false);
    m.emit("moveend");
    await vi.advanceTimersByTimeAsync(0);
    expect(m.layers.has(FLOW_LAYER)).toBe(true);
    step(16);
    expect(m.setPaintProperty).toHaveBeenCalledWith(FLOW_LAYER, "line-gradient", expect.any(Array));
    step(1000);
    expect(onEnd).not.toHaveBeenCalled();
    step(FLOW_TOTAL_MS);
    expect(m.layers.has(FLOW_LAYER)).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(m.handlers.get("wheel")?.size).toBe(0);
  });
  it("hides the whole route before the zoom-out, uncovers it behind the head, and shows it all at the end", async () => {
    const m = fakeMap();
    m.layers.add("route-line");
    m.layers.add("route-casing");
    startRouteFlow(asMap(m), { ...opts, hideLayers: ["route-casing", "route-line"] });
    expect(m.setPaintProperty).toHaveBeenCalledWith("route-line", "line-trim-offset", [0, 1]);
    expect(m.setPaintProperty).toHaveBeenCalledWith("route-casing", "line-trim-offset", [0, 1]);
    m.emit("moveend");
    await vi.advanceTimersByTimeAsync(0);
    step(FLOW_TOTAL_MS / 2);
    const mid = m.setPaintProperty.mock.calls.filter((c) => c[0] === "route-line" && c[1] === "line-trim-offset").at(-1)![2] as number[];
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[1]).toBe(1);
    step(FLOW_TOTAL_MS);
    expect(m.setPaintProperty.mock.calls.filter((c) => c[0] === "route-line" && c[1] === "line-trim-offset").at(-1)![2]).toEqual([0, 0]);
  });
  it("leaves the route alone with reduced motion", async () => {
    const m = fakeMap({ moving: false });
    m.layers.add("route-line");
    startRouteFlow(asMap(m), { ...opts, reducedMotion: true, hideLayers: ["route-line"] });
    await vi.advanceTimersByTimeAsync(10);
    expect(m.setPaintProperty).not.toHaveBeenCalledWith("route-line", "line-trim-offset", [0, 1]);
  });
  it("starts after the timeout fallback if moveend never arrives", async () => {
    const m = fakeMap();
    startRouteFlow(asMap(m), opts);
    await vi.advanceTimersByTimeAsync(1600);
    expect(m.layers.has(FLOW_LAYER)).toBe(true);
  });
  it("only fits (no layer) with reduced motion, using a zero-length move", async () => {
    const m = fakeMap({ moving: false });
    const onEnd = vi.fn();
    startRouteFlow(asMap(m), { ...opts, reducedMotion: true, onEnd });
    await vi.advanceTimersByTimeAsync(10);
    expect(m.fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 0 }));
    expect(m.addLayer).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
  it("cancels when the viewer interacts mid-sweep, but ignores the map's own moves", async () => {
    const m = fakeMap({ moving: false });
    startRouteFlow(asMap(m), opts);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.layers.has(FLOW_LAYER)).toBe(true);
    m.emit("zoomstart", {}); // programmatic: no originalEvent
    expect(m.layers.has(FLOW_LAYER)).toBe(true);
    m.emit("dragstart", { originalEvent: {} });
    expect(m.layers.has(FLOW_LAYER)).toBe(false);
    step(100);
    expect(m.addLayer).toHaveBeenCalledTimes(1);
  });
  it("cancel during the fit never adds the layer", async () => {
    const m = fakeMap();
    const flow = startRouteFlow(asMap(m), opts);
    flow.cancel();
    m.emit("moveend");
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.addLayer).not.toHaveBeenCalled();
  });
  it("skips the animation if the layer cannot be added", async () => {
    const m = fakeMap({ moving: false });
    m.addLayer.mockImplementation(() => { throw new Error("no source"); });
    const onEnd = vi.fn();
    startRouteFlow(asMap(m), { ...opts, onEnd });
    await vi.advanceTimersByTimeAsync(0);
    expect(onEnd).toHaveBeenCalled();
  });
});
