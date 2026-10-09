import { describe, expect, it } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridor } from "./corridor";
import { haversineMeters } from "@/lib/geo";
import { cellOf, cellRuns, cellsForCircle, cellsForRing, pointInRing } from "./places-grid";

describe("cellOf", () => {
  it("puts nearby points in one 0.1 degree square and distant ones in different squares", () => {
    expect(cellOf(37.2982, -113.0263)).toBe(cellOf(37.2999, -113.0201));
    expect(cellOf(37.2982, -113.0263)).not.toBe(cellOf(37.4, -113.0263));
    expect(cellOf(37.2982, -113.0263)).not.toBe(cellOf(37.2982, -112.9));
  });
});

describe("cellsForCircle", () => {
  it("covers every point within the radius", () => {
    const cells = new Set(cellsForCircle(37.2982, -113.0263, 24));
    for (const [dLat, dLng] of [[0.2, 0], [-0.2, 0], [0, 0.27], [0, -0.27], [0.15, 0.2], [-0.15, -0.2]]) {
      expect(cells.has(cellOf(37.2982 + dLat, -113.0263 + dLng))).toBe(true);
    }
  });
});

describe("cellsForCircle corner trimming", () => {
  it("never misses a point inside the circle (brute force over many centres, radii and latitudes)", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < 300; i++) {
      const lat = 25 + rnd() * 45;
      const lng = -125 + rnd() * 58;
      const radiusKm = 2 + rnd() * 60;
      const cells = new Set(cellsForCircle(lat, lng, radiusKm));
      for (let k = 0; k < 40; k++) {
        const bearing = rnd() * 2 * Math.PI;
        const d = Math.sqrt(rnd()) * radiusKm; // km from the centre, inside the circle
        const pLat = lat + (d * Math.cos(bearing)) / 111.195;
        const pLng = lng + (d * Math.sin(bearing)) / (111.195 * Math.cos((lat * Math.PI) / 180));
        if (haversineMeters({ lat, lng }, { lat: pLat, lng: pLng }) <= radiusKm * 1000) expect(cells.has(cellOf(pLat, pLng))).toBe(true);
      }
    }
  });

  it("reads fewer cells than the bounding box and keeps the centre's own cell", () => {
    const cells = cellsForCircle(37.2982, -113.0263, 24);
    expect(cells).toContain(cellOf(37.2982, -113.0263));
    const dLat = 24 / 111.32;
    const dLng = 24 / (111.32 * Math.cos((37.2982 * Math.PI) / 180));
    const boxCells = (Math.floor((37.2982 + dLat + 90) / 0.1) - Math.floor((37.2982 - dLat + 90) / 0.1) + 1) * (Math.floor((-113.0263 + dLng + 180) / 0.1) - Math.floor((-113.0263 - dLng + 180) / 0.1) + 1);
    expect(cells.length).toBeLessThan(boxCells);
    expect(cells.length).toBeGreaterThan(boxCells * 0.6);
  });
});

describe("cellRuns", () => {
  it("merges consecutive cells into inclusive runs, sorted and de-duplicated", () => {
    expect(cellRuns([5, 3, 4, 4, 10, 20000, 20001, 11])).toEqual([[3, 5], [10, 11], [20000, 20001]]);
    expect(cellRuns([])).toEqual([]);
    expect(cellRuns([7])).toEqual([[7, 7]]);
  });

  it("turns a circle's cells into one run per grid row", () => {
    const cells = cellsForCircle(37.2982, -113.0263, 24);
    const rows = new Set(cells.map((c) => Math.floor(c / 10_000)));
    expect(cellRuns(cells)).toHaveLength(rows.size);
  });
});

describe("cellsForRing / pointInRing", () => {
  const route: LngLat[] = [[-119.79, 36.74], [-119.0, 37.5], [-118.2, 37.9]];
  const ring = buildCorridor(route);

  it("includes the cell of every point on the route, including long straight stretches between vertices", () => {
    const cells = new Set(cellsForRing(ring));
    for (let k = 0; k <= 50; k++) {
      const f = k / 50;
      expect(cells.has(cellOf(36.74 + (37.5 - 36.74) * f, -119.79 + (-119.0 + 119.79) * f))).toBe(true);
    }
  });

  it("tells inside from outside the corridor", () => {
    expect(pointInRing(-119.395, 37.12, ring)).toBe(true);
    expect(pointInRing(-119.395, 37.5, ring)).toBe(false);
  });
});
