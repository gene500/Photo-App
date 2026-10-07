import { describe, expect, it } from "vitest";
import { latLngToPercent, pixelToLatLng } from "./map-bounds";

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
