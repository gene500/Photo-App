import { describe, expect, it } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridor } from "./corridor";
import { cellOf, cellsForCircle, cellsForRing, pointInRing } from "./places-grid";

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
