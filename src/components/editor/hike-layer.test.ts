import { describe, expect, it, vi } from "vitest";
import type mapboxgl from "mapbox-gl";
import { ensureHikeLayer, HIKE_COLOR, HIKE_LAYER, HIKE_SOURCE, hikeData } from "./hike-layer";

const line: [number, number][] = [[-119.52, 36.99], [-119.5, 37]];

/** A stand-in map that remembers sources and layers, and can lose them like a style reload does. */
function fakeMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, { layer: Record<string, unknown>; before?: string }>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    addLayer: vi.fn((layer: { id: string }, before?: string) => layers.set(layer.id, { layer, before })),
  };
  return { map: map as unknown as mapboxgl.Map, raw: map, sources, layers, reload: () => { sources.clear(); layers.clear(); } };
}

describe("hikeData", () => {
  it("makes one LineString per hike and skips lines with fewer than two points", () => {
    const d = hikeData([{ id: "a", geometry: line }, { id: "b", geometry: [[1, 2]] }]);
    expect(d.features).toHaveLength(1);
    expect(d.features[0].geometry).toEqual({ type: "LineString", coordinates: line });
    expect(d.features[0].properties).toEqual({ id: "a" });
  });
  it("is empty with no hikes", () => {
    expect(hikeData(undefined).features).toEqual([]);
    expect(hikeData([]).features).toEqual([]);
  });
});

describe("ensureHikeLayer", () => {
  it("adds its own source and a dotted, matte green, glow-free line layer separate from the route", () => {
    const m = fakeMap();
    ensureHikeLayer(m.map, [{ id: "a", geometry: line }]);
    expect(m.raw.addSource.mock.calls[0][0]).toBe(HIKE_SOURCE);
    expect(HIKE_SOURCE).not.toBe("route");
    const { layer } = m.layers.get(HIKE_LAYER)!;
    expect(layer).toMatchObject({ type: "line", source: HIKE_SOURCE });
    const paint = layer.paint as Record<string, unknown>;
    expect(paint["line-color"]).toBe(HIKE_COLOR);
    expect(HIKE_COLOR).toMatch(/^#[0-9a-f]{6}$/);
    expect(paint["line-dasharray"]).toEqual([0.01, 2]);
    expect(paint).not.toHaveProperty("line-blur");
    expect((layer.layout as Record<string, unknown>)["line-cap"]).toBe("round");
  });

  it("only updates the data on later calls, and clears it when there are no hikes", () => {
    const m = fakeMap();
    ensureHikeLayer(m.map, [{ id: "a", geometry: line }]);
    ensureHikeLayer(m.map, []);
    expect(m.raw.addSource).toHaveBeenCalledTimes(1);
    expect(m.raw.addLayer).toHaveBeenCalledTimes(1);
    expect(m.sources.get(HIKE_SOURCE)!.setData).toHaveBeenLastCalledWith(expect.objectContaining({ features: [] }));
  });

  it("puts the source and layer back after a style reload", () => {
    const m = fakeMap();
    ensureHikeLayer(m.map, [{ id: "a", geometry: line }]);
    m.reload();
    ensureHikeLayer(m.map, [{ id: "a", geometry: line }]);
    expect(m.raw.addSource).toHaveBeenCalledTimes(2);
    expect(m.raw.addLayer).toHaveBeenCalledTimes(2);
  });

  it("goes under the sky lines when they exist", () => {
    const m = fakeMap();
    m.layers.set("sky-sunrise", { layer: {} });
    ensureHikeLayer(m.map, []);
    expect(m.layers.get(HIKE_LAYER)!.before).toBe("sky-sunrise");
  });
});
