import { describe, expect, it } from "vitest";
import { encodePolyline, STATIC_MAP_MAX_URL, staticMapUrl } from "./static-map";
import type { LngLat } from "./types";

const GEOM: LngLat[] = [
  [-120.2, 38.5],
  [-120.95, 40.7],
  [-126.453, 43.252],
];
const STOPS = [
  { lat: 38.5, lng: -120.2 },
  { lat: 43.2, lng: -126.4 },
];

describe("encodePolyline", () => {
  it("matches the canonical Google example", () => {
    expect(encodePolyline(GEOM)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });
});

describe("staticMapUrl", () => {
  it("builds a path overlay then numbered pins", () => {
    const url = staticMapUrl({ stops: STOPS, geometry: GEOM, token: "TOKEN" })!;
    expect(url.startsWith("https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/")).toBe(true);
    expect(url).toContain("pin-s-1+");
    expect(url).toContain("pin-s-2+");
    expect(url).toContain(`path-4+2563eb-0.9(${encodeURIComponent(encodePolyline(GEOM))})`);
    expect(url.indexOf("path-")).toBeLessThan(url.indexOf("pin-s-1+"));
    expect(url.endsWith("/auto/640x400@2x?access_token=TOKEN")).toBe(true);
  });

  it("returns null without a token or with fewer than 2 stops", () => {
    expect(staticMapUrl({ stops: STOPS, geometry: GEOM, token: null })).toBeNull();
    expect(staticMapUrl({ stops: STOPS, geometry: GEOM, token: "" })).toBeNull();
    expect(staticMapUrl({ stops: STOPS.slice(0, 1), geometry: GEOM, token: "T" })).toBeNull();
  });

  it("keeps a huge route and many stops within the URL limit", () => {
    const geometry: LngLat[] = Array.from({ length: 20000 }, (_, i) => [
      -120 + Math.sin(i / 50) + i * 0.0001,
      38 + Math.cos(i / 70) + i * 0.0001,
    ]);
    const stops = Array.from({ length: 40 }, (_, i) => ({ lat: 38 + i * 0.01, lng: -120 + i * 0.01 }));
    const url = staticMapUrl({ stops, geometry, token: "TOKEN" })!;
    expect(url).not.toBeNull();
    expect(url.length).toBeLessThanOrEqual(STATIC_MAP_MAX_URL);
    expect(url).toContain("path-");
  });

  it("omits the label for pins past 99", () => {
    const stops = Array.from({ length: 101 }, (_, i) => ({ lat: 10 + i * 0.001, lng: 20 }));
    const url = staticMapUrl({ stops, geometry: [], token: "T" })!;
    expect(url).toContain("pin-s-99+");
    expect(url).not.toContain("pin-s-100");
    expect(url).toContain("pin-s+e11d48");
  });

  it("clamps width and height to 1280", () => {
    const url = staticMapUrl({ stops: STOPS, geometry: GEOM, token: "T", width: 5000, height: 2000 })!;
    expect(url).toContain("/auto/1280x1280@2x?");
  });

  it("draws pins only when geometry is empty", () => {
    const url = staticMapUrl({ stops: STOPS, geometry: [], token: "T" })!;
    expect(url).not.toContain("path-");
    expect(url).toContain("pin-s-1+");
  });

  it("returns null when pins alone exceed the limit", () => {
    const stops = Array.from({ length: 400 }, (_, i) => ({ lat: 10 + i * 0.001, lng: 20 + i * 0.001 }));
    expect(staticMapUrl({ stops, geometry: [], token: "T" })).toBeNull();
  });
});
