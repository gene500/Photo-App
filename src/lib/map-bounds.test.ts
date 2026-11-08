import { describe, expect, it } from "vitest";
import { latLngToPercent, pixelToLatLng, unwrapForFit } from "./map-bounds";

describe("map-bounds", () => {
  const b = { minLat: 35.95, maxLat: 38.05, minLng: -120.05, maxLng: -117.95 };

  it("converts pixels to lat/lng and back to percentages", () => {
    const center = pixelToLatLng(b, 100, 50, 200, 100);
    expect(center.lat).toBeCloseTo(37);
    expect(center.lng).toBeCloseTo(-119);
    const pct = latLngToPercent(b, center);
    expect(pct.left).toBeCloseTo(50);
    expect(pct.top).toBeCloseTo(50);
  });
});

describe("unwrapForFit", () => {
  const span = (pts: [number, number][]) => {
    const l = unwrapForFit(pts).map((p) => p[0]);
    return Math.max(...l) - Math.min(...l);
  };
  it("frames an antimeridian trip the short way", () => {
    expect(span([[179.5, 0], [-179.5, 0]])).toBeCloseTo(1);
    expect(span([[150, 0], [-150, 0]])).toBeCloseTo(60);
  });
  it("leaves an ordinary trip alone", () => {
    expect(unwrapForFit([[-120, 36], [-118, 38]])).toEqual([[-120, 36], [-118, 38]]);
  });
  it("keeps a trip around the world when no side is shorter", () => {
    expect(span([[0, 0], [120, 0], [-120, 0]])).toBeCloseTo(240);
  });
  it("clamps polar latitudes and keeps a single point", () => {
    expect(unwrapForFit([[10, 89.99]])).toEqual([[10, 85]]);
    expect(unwrapForFit([[10, -89.9], [12, 0]])[0]).toEqual([10, -85]);
  });
});
