import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon } from "@turf/helpers";
import { describe, expect, it } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridor, buildOverpassQuery, CORRIDOR_KM, toOverpassPoly } from "./corridor";

// A 1-degree line along the equator, densely sampled like a real route geometry.
const ROUTE: LngLat[] = Array.from({ length: 101 }, (_, i) => [i / 100, 0]);

describe("buildCorridor", () => {
  it("defaults to a 2 km corridor", () => {
    expect(CORRIDOR_KM).toBe(2);
  });

  it("contains points near the route and excludes points far from it", () => {
    const ring = buildCorridor(ROUTE);
    const poly = polygon([ring]);
    expect(booleanPointInPolygon(point([0.5, 0.01]), poly)).toBe(true); // ~1.1 km off-route
    expect(booleanPointInPolygon(point([0.5, 0.03]), poly)).toBe(false); // ~3.3 km off-route
  });

  it("returns a closed ring that is much smaller than the input", () => {
    const ring = buildCorridor(ROUTE);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBeLessThan(80);
  });

  it("rejects a route with fewer than two points", () => {
    expect(() => buildCorridor([[0, 0]])).toThrow("Route needs at least 2 coordinates");
  });

  // Adversarial zigzag: amplitude (0.006) just above ROUTE_SIMPLIFY_DEG (0.005)
  // so the point survives simplify()'s Douglas-Peucker pass almost untouched,
  // defeating a raw-input-count cap. buffer()'s cost scales with this
  // POST-simplify point count, not the raw input size, so this must be
  // rejected before buffer() ever runs.
  const zigzag = (n: number): LngLat[] =>
    Array.from({ length: n }, (_, i) => [i * 0.001, i % 2 === 0 ? 0 : 0.006]);

  it("rejects a route whose simplified geometry is still too complex", () => {
    // raw=211 simplifies to 201 points (just over the 200-point guard).
    expect(() => buildCorridor(zigzag(211))).toThrow("too complex");
  });

  it("accepts a route whose simplified geometry is within budget", () => {
    // raw=210 simplifies to exactly 200 points (at the guard's limit).
    expect(() => buildCorridor(zigzag(210))).not.toThrow();
  });
});

describe("toOverpassPoly", () => {
  it("emits lat-first pairs with 5 decimals", () => {
    expect(toOverpassPoly([[-119.5, 37.25], [-119.4, 37.3]])).toBe("37.25000 -119.50000 37.30000 -119.40000");
  });
});

describe("buildOverpassQuery", () => {
  it("queries viewpoints, attractions and peaks within the polygon", () => {
    const q = buildOverpassQuery("1 2 3 4 5 6");
    expect(q).toContain("[out:json][timeout:10];");
    expect(q).toContain('nwr["tourism"~"^(viewpoint|attraction)$"](poly:"1 2 3 4 5 6");');
    expect(q).toContain('node["natural"="peak"](poly:"1 2 3 4 5 6");');
    expect(q).toContain("out center 500;");
  });
});
