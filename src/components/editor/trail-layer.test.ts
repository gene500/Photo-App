import { describe, expect, it, vi } from "vitest";
import type mapboxgl from "mapbox-gl";
import { ACCESS_TRAIL_COLOR } from "@/lib/map-theme";
import { ACCESS_TRAIL_LAYER, ACCESS_TRAIL_SOURCE, ensureTrailLayer, trailData } from "./trail-layer";

const lines = [{ id: "a", geometry: [[-119.001, 37.001], [-119, 37]] as [number, number][], mapped: true }];

function fakeMap(withCasing: boolean) {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, { layer: Record<string, unknown>; before?: string }>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    getLayer: (id: string) => (layers.has(id) || (withCasing && id === "route-casing") ? {} : undefined),
    addLayer: vi.fn((layer: { id: string }, before?: string) => layers.set(layer.id, { layer, before })),
  };
  return { map: map as unknown as mapboxgl.Map, raw: map, sources, layers };
}

describe("trailData", () => {
  it("makes one LineString feature per line with id and mapped", () => {
    const d = trailData([...lines, { id: "b", geometry: [[1, 2], [3, 4]], mapped: false }]);
    expect(d.features).toHaveLength(2);
    expect(d.features[0].geometry).toEqual({ type: "LineString", coordinates: lines[0].geometry });
    expect(d.features[0].properties).toEqual({ id: "a", mapped: true });
    expect(d.features[1].properties).toEqual({ id: "b", mapped: false });
  });
});

describe("ensureTrailLayer", () => {
  it("adds the source and a dashed layer once, under the route casing", () => {
    const m = fakeMap(true);
    ensureTrailLayer(m.map, lines);
    expect(m.raw.addSource.mock.calls[0][0]).toBe(ACCESS_TRAIL_SOURCE);
    const { layer, before } = m.layers.get(ACCESS_TRAIL_LAYER)!;
    expect(before).toBe("route-casing");
    expect(layer).toMatchObject({ type: "line", source: ACCESS_TRAIL_SOURCE });
    const paint = layer.paint as Record<string, unknown>;
    expect(paint["line-color"]).toBe(ACCESS_TRAIL_COLOR);
    expect(paint["line-dasharray"]).toEqual([2, 1.5]);
    expect(paint["line-width"]).toEqual(["interpolate", ["linear"], ["zoom"], 8, 2, 14, 3]);
    ensureTrailLayer(m.map, []);
    expect(m.raw.addSource).toHaveBeenCalledTimes(1);
    expect(m.raw.addLayer).toHaveBeenCalledTimes(1);
    expect(m.sources.get(ACCESS_TRAIL_SOURCE)!.setData).toHaveBeenCalledWith(trailData([]));
  });
  it("adds on top when there is no route casing yet", () => {
    const m = fakeMap(false);
    ensureTrailLayer(m.map, lines);
    expect(m.layers.get(ACCESS_TRAIL_LAYER)!.before).toBeUndefined();
  });
});
