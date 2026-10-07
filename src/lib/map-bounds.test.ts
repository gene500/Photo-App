import { describe, expect, it } from "vitest";
import { boundsFor, latLngToPercent, pixelToLatLng } from "./map-bounds";

describe("map-bounds", () => {
  const b = boundsFor([{ lat: 36, lng: -120 }, { lat: 38, lng: -118 }], 0);

  it("covers the given points (with a minimum pad)", () => {
    expect(b).toEqual({ minLat: 35.95, maxLat: 38.05, minLng: -120.05, maxLng: -117.95 });
  });

  it("pads by a fraction of the span", () => {
    const padded = boundsFor([{ lat: 36, lng: -120 }, { lat: 38, lng: -118 }], 0.5);
    expect(padded.minLat).toBe(35);
    expect(padded.maxLng).toBe(-117);
  });

  it("converts pixels to lat/lng and back to percentages", () => {
    const center = pixelToLatLng(b, 100, 50, 200, 100);
    expect(center.lat).toBeCloseTo(37);
    expect(center.lng).toBeCloseTo(-119);
    const pct = latLngToPercent(b, center);
    expect(pct.left).toBeCloseTo(50);
    expect(pct.top).toBeCloseTo(50);
  });
});
