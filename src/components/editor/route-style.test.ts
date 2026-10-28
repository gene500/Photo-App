import { describe, expect, it } from "vitest";
import {
  ROUTE_WIDTH_STOPS, SIMPLIFY_MAX_ZOOM, casingLineWidth, firstLabelLayerId, routeLineWidth, simplifyBucket, simplifyRoute, simplifyToleranceDeg,
} from "./route-style";

function checkInterpolate(expr: unknown[]) {
  expect(expr.slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
  const rest = expr.slice(3);
  expect(rest.length).toBeGreaterThanOrEqual(2);
  expect(rest.length % 2).toBe(0);
  const zooms = rest.filter((_, i) => i % 2 === 0) as number[];
  const widths = rest.filter((_, i) => i % 2 === 1) as number[];
  for (let i = 1; i < zooms.length; i++) expect(zooms[i]).toBeGreaterThan(zooms[i - 1]);
  for (const w of widths) expect(w).toBeGreaterThan(0);
  return widths;
}

describe("route widths", () => {
  it("builds well-formed interpolate expressions that never shrink with zoom", () => {
    const line = checkInterpolate(routeLineWidth());
    const casing = checkInterpolate(casingLineWidth());
    expect([...line].sort((a, b) => a - b)).toEqual(line);
    casing.forEach((w, i) => expect(w).toBeGreaterThan(line[i]));
    expect(ROUTE_WIDTH_STOPS.length).toBe(line.length);
  });
});

describe("simplify tolerance", () => {
  it("is zero at and above the max zoom and shrinks as you zoom in", () => {
    expect(simplifyToleranceDeg(SIMPLIFY_MAX_ZOOM)).toBe(0);
    expect(simplifyToleranceDeg(15)).toBe(0);
    expect(simplifyToleranceDeg(NaN)).toBe(0);
    expect(simplifyToleranceDeg(6)).toBeGreaterThan(simplifyToleranceDeg(9));
    expect(simplifyToleranceDeg(9)).toBeGreaterThan(0);
  });
  it("buckets to whole zooms", () => {
    expect(simplifyBucket(8.7)).toBe(8);
    expect(simplifyBucket(NaN)).toBe(SIMPLIFY_MAX_ZOOM);
  });
});

describe("simplifyRoute", () => {
  const zig: [number, number][] = [[0, 0], [1, 0.0001], [2, -0.0001], [3, 0.0001], [4, 0]];
  it("removes wiggles below the tolerance, keeping the ends", () => {
    const out = simplifyRoute(zig, 0.001);
    expect(out).toEqual([[0, 0], [4, 0]]);
  });
  it("keeps features larger than the tolerance (a switchback corner)", () => {
    const pts: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(simplifyRoute(pts, 0.01)).toEqual(pts);
  });
  it("is the identity at tolerance 0 or for short lines", () => {
    expect(simplifyRoute(zig, 0)).toBe(zig);
    expect(simplifyRoute([[0, 0], [1, 1]], 5)).toEqual([[0, 0], [1, 1]]);
  });
  it("keeps every point within the tolerance of the result", () => {
    const pts: [number, number][] = Array.from({ length: 200 }, (_, i) => [i * 0.01, Math.sin(i / 5) * 0.05]);
    const tol = 0.01;
    const out = simplifyRoute(pts, tol);
    expect(out.length).toBeLessThan(pts.length);
    for (const [x, y] of pts) {
      let best = Infinity;
      for (let i = 1; i < out.length; i++) {
        const [ax, ay] = out[i - 1], [bx, by] = out[i];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
      }
      expect(best).toBeLessThanOrEqual(tol + 1e-12);
    }
  });
});

describe("firstLabelLayerId", () => {
  it("picks the first symbol layer so the route sits under every label", () => {
    const layers = [{ id: "land", type: "background" }, { id: "road", type: "line" }, { id: "road-label", type: "symbol" }, { id: "poi", type: "symbol" }];
    expect(firstLabelLayerId(layers)).toBe("road-label");
  });
  it("is undefined when there is no symbol layer or no style yet", () => {
    expect(firstLabelLayerId([{ id: "road", type: "line" }])).toBeUndefined();
    expect(firstLabelLayerId(undefined)).toBeUndefined();
  });
});
