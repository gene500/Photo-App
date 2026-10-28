import { describe, expect, it } from "vitest";
import { formatHikeDistance, hikeAttribution, hikeKey, isHike, type Hike } from "./hike";

const good: Hike = { distanceMeters: 1930, geometry: [[-119.52, 36.99], [-119.5, 37]], source: "osm", attribution: "x" };

describe("formatHikeDistance", () => {
  it("shows miles with one decimal", () => {
    expect(formatHikeDistance(1931, "mi")).toBe("1.2 mi");
    expect(formatHikeDistance(8047, "mi")).toBe("5.0 mi");
    expect(formatHikeDistance(30, "mi")).toBe("0.1 mi");
  });
  it("shows kilometres with one decimal, or metres under a kilometre", () => {
    expect(formatHikeDistance(1931, "km")).toBe("1.9 km");
    expect(formatHikeDistance(854, "km")).toBe("850 m");
    expect(formatHikeDistance(4, "km")).toBe("10 m");
    expect(formatHikeDistance(1931)).toBe("1.9 km");
  });
});

describe("hikeKey and attribution", () => {
  it("rounds to a 4-decimal grid", () => {
    expect(hikeKey(37.123449, -119.5)).toBe("37.1234,-119.5000");
  });
  it("names the source", () => {
    expect(hikeAttribution("nps")).toBe("Trail data: National Park Service");
    expect(hikeAttribution("osm")).toBe("Trail data © OpenStreetMap contributors");
  });
});

describe("isHike", () => {
  it("accepts a well-formed hike", () => expect(isHike(good)).toBe(true));
  it.each([
    null, {}, { ...good, distanceMeters: 0 }, { ...good, distanceMeters: NaN }, { ...good, source: "x" },
    { ...good, geometry: [[1, 2]] }, { ...good, geometry: [[1, 2], ["a", 2]] }, { ...good, geometry: Array.from({ length: 201 }, () => [1, 2]) },
  ])("rejects %j", (v) => expect(isHike(v)).toBe(false));
});
