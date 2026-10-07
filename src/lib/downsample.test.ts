import { describe, expect, it } from "vitest";
import { downsampleRoute } from "./downsample";

const line = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [i * 0.001, i * 0.002]);

describe("downsampleRoute", () => {
  it("leaves short routes unchanged", () => {
    const pts = line(10);
    expect(downsampleRoute(pts)).toEqual(pts);
    expect(downsampleRoute(line(1500))).toHaveLength(1500);
  });

  it("reduces a 3207-point route to at most 1500, keeping first and last in order", () => {
    const pts = line(3207);
    const out = downsampleRoute(pts);
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out.length).toBeGreaterThan(1000);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[3206]);
    const lngs = out.map((p) => p[0]);
    expect([...lngs].sort((a, b) => a - b)).toEqual(lngs);
  });

  it("handles tiny and custom targets", () => {
    expect(downsampleRoute([])).toEqual([]);
    expect(downsampleRoute(line(100), 2)).toEqual([line(100)[0], line(100)[99]]);
  });
});
