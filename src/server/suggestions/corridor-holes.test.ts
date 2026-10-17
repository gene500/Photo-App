import { beforeEach, describe, expect, it } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridor, buildCorridorShape } from "./corridor";
import { localPlacesInRing, type PlaceRow } from "./local-places";
import { cellOf, cellsForRing, createRingTester } from "./places-grid";
import { clearSuggestionCache, findSuggestions } from "./service";

// A loop route: a circle ~0.15 degrees (~16 km) in radius around (-105, 40), closed back on its start.
const CENTER: LngLat = [-105, 40];
const loopOf = (radius: number): LngLat[] =>
  Array.from({ length: 73 }, (_, i) => {
    const a = ((i % 72) / 72) * 2 * Math.PI;
    return [CENTER[0] + radius * Math.cos(a), CENTER[1] + radius * Math.sin(a)] as LngLat;
  });
const LOOP = loopOf(0.15);
const ON_ROUTE: LngLat = [CENTER[0] + 0.15, CENTER[1] + 0.005]; // within ~1 km of the loop

describe("a loop route's corridor", () => {
  it("keeps the hole, and the loop's centre is not inside the corridor", () => {
    const { outer, holes } = buildCorridorShape(LOOP);
    expect(holes.length).toBeGreaterThanOrEqual(1);
    const inside = createRingTester(outer, holes);
    expect(inside(CENTER[0], CENTER[1])).toBe(false);
    expect(inside(ON_ROUTE[0], ON_ROUTE[1])).toBe(true);
  });

  it("skips grid cells that lie wholly inside the hole", () => {
    const { outer, holes } = buildCorridorShape(loopOf(0.4)); // wide enough that a whole 0.1 degree cell fits in the hole
    expect(cellsForRing(outer).includes(cellOf(CENTER[1], CENTER[0]))).toBe(true); // the old, hole-less answer
    const cells = cellsForRing(outer, holes);
    expect(cells.includes(cellOf(CENTER[1], CENTER[0]))).toBe(false);
    expect(cells.includes(cellOf(CENTER[1], CENTER[0] + 0.4))).toBe(true);
  });

  it("drops local places in the hole", async () => {
    const { outer, holes } = buildCorridorShape(LOOP);
    const rows: PlaceRow[] = [
      { id: "node/1", name: "Centre", kind: "viewpoint", lat: CENTER[1], lng: CENTER[0] },
      { id: "node/2", name: "Road", kind: "viewpoint", lat: ON_ROUTE[1], lng: ON_ROUTE[0] },
    ];
    const found = (await localPlacesInRing(outer, async () => rows, holes)) as { id: number }[];
    expect(found.map((e) => e.id)).toEqual([2]);
  });

  describe("findSuggestions", () => {
    beforeEach(() => clearSuggestionCache());
    it("filters Overpass results that fall in the hole", async () => {
      const tags = { tourism: "viewpoint", name: "Spot" };
      const fetchOverpass = async () => ({
        elements: [
          { type: "node", id: 1, lat: CENTER[1], lon: CENTER[0], tags },
          { type: "node", id: 2, lat: ON_ROUTE[1], lon: ON_ROUTE[0], tags },
        ],
      });
      const result = await findSuggestions(LOOP, { fetchOverpass, local: async () => null, localPartial: async () => null, enrich: false });
      expect(result.map((s) => s.osmId)).toEqual(["node/2"]);
    });
  });
});

describe("a straight route's corridor", () => {
  it("has no holes and behaves as before", () => {
    const route: LngLat[] = [[-119.79, 36.74], [-119.0, 37.5], [-118.2, 37.9]];
    const { outer, holes } = buildCorridorShape(route);
    expect(holes).toEqual([]);
    expect(outer).toEqual(buildCorridor(route));
    const cells = cellsForRing(outer);
    expect(cellsForRing(outer, holes).sort()).toEqual(cells.sort());
    expect(createRingTester(outer, holes)(-119.395, 37.12)).toBe(createRingTester(outer)(-119.395, 37.12));
  });
});
