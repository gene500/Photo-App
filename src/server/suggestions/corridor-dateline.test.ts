import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridorShapes, buildOverpassQuery, CorridorError, toOverpassPoly } from "./corridor";
import { cellOf, cellsForRing } from "./places-grid";
import { clearSuggestionCache, findSuggestions } from "./service";

const lngs = (ring: LngLat[]) => ring.map((p) => p[0]);
const width = (ring: LngLat[]) => Math.max(...lngs(ring)) - Math.min(...lngs(ring));

describe("a corridor across the date line", () => {
  for (const [name, route] of [
    ["Fiji", [[179.5, 0], [-179.5, 0]]],
    ["Fiji, reversed", [[-179.5, 0], [179.5, 0]]],
    ["Bering Strait", [[-170, 66], [170, 66]]],
  ] as [string, LngLat[]][]) {
    it(`${name}: follows the short path, as two polygons inside [-180, 180]`, () => {
      const shapes = buildCorridorShapes(route);
      expect(shapes).toHaveLength(2);
      for (const { outer, holes } of shapes) {
        expect(lngs(outer).every((x) => x >= -180 && x <= 180)).toBe(true);
        expect(outer[0]).toEqual(outer[outer.length - 1]);
        expect(width(outer)).toBeLessThan(25);
        expect(holes).toEqual([]);
      }
      // one on each side of the line
      expect(shapes.some((s) => Math.min(...lngs(s.outer)) < -179)).toBe(true);
      expect(shapes.some((s) => Math.max(...lngs(s.outer)) > 179)).toBe(true);
    });
  }

  it("covers grid cells on both sides of the line, and only a handful", () => {
    const cells = buildCorridorShapes([[179.5, 0], [-179.5, 0]]).flatMap((s) => cellsForRing(s.outer, s.holes));
    expect(cells).toContain(cellOf(0, 179.95));
    expect(cells).toContain(cellOf(0, -179.95));
    expect(new Set(cells).size).toBeLessThan(200);
  });

  it("asks Overpass for both polygons in one query", () => {
    const polys = buildCorridorShapes([[179.5, 0], [-179.5, 0]]).map((s) => toOverpassPoly(s.outer));
    const q = buildOverpassQuery(polys);
    for (const p of polys) expect(q).toContain(`(poly:"${p}")`);
    expect(q).toContain("out center 500;");
  });

  it("leaves an ordinary route as one polygon", () => {
    expect(buildCorridorShapes([[-119.79, 36.74], [-119.12, 37.96]])).toHaveLength(1);
  });
});

describe("corridor failures that can never succeed", () => {
  beforeEach(() => clearSuggestionCache());

  it("throws CorridorError for a polar route and for a route that is too complex", () => {
    expect(() => buildCorridorShapes([[0, 90], [10, 90]])).toThrow(CorridorError);
    const zigzag: LngLat[] = Array.from({ length: 300 }, (_, i) => [i * 0.001, i % 2 === 0 ? 0 : 0.1] as LngLat);
    expect(() => buildCorridorShapes(zigzag)).toThrow(/too complex/);
  });

  it("findSuggestions surfaces them as CorridorError, not OverpassError", async () => {
    const fetchOverpass = vi.fn(async () => ({ elements: [] }));
    await expect(findSuggestions([[0, 90], [10, 90]], { fetchOverpass, local: async () => null, localPartial: async () => null })).rejects.toBeInstanceOf(CorridorError);
    expect(fetchOverpass).not.toHaveBeenCalled();
  });
});
