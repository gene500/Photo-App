import { describe, expect, it } from "vitest";
import { formatHikeDistance, hikeKey, isHike, type Hike } from "./hike";

const good: Hike = { distanceMeters: 1930, geometry: [[-119.52, 36.99], [-119.5, 37]], source: "osm", attribution: "x", access: null };

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

describe("hikeKey", () => {
  it("rounds to a 4-decimal grid", () => {
    expect(hikeKey(37.123449, -119.5)).toBe("37.1234,-119.5000");
  });
});

describe("isHike", () => {
  it("accepts a well-formed hike", () => expect(isHike(good)).toBe(true));
  it("accepts a lot, and a missing access (an older answer) as null", () => {
    expect(isHike({ ...good, access: { lat: 37, lng: -119.5, name: "Arch lot" } })).toBe(true);
    expect(isHike({ ...good, access: { lat: 37, lng: -119.5, name: null } })).toBe(true);
    const old: Partial<Hike> = { ...good };
    delete old.access;
    expect(isHike(old)).toBe(true);
    expect(isHike({ ...good, access: { lat: 37, lng: -119.5, name: "x".repeat(120) } })).toBe(true);
  });
  it("rejects a lot name longer than 120 characters (the server never sends one)", () => {
    expect(isHike({ ...good, access: { lat: 37, lng: -119.5, name: "x".repeat(121) } })).toBe(false);
  });
  it("rejects a missing name (it must be a string or null)", () => {
    expect(isHike({ ...good, access: { lat: 37, lng: -119.5 } })).toBe(false);
  });
  it.each([
    null, {}, { ...good, distanceMeters: 0 }, { ...good, distanceMeters: NaN }, { ...good, source: "x" },
    { ...good, geometry: [[1, 2]] }, { ...good, geometry: [[1, 2], ["a", 2]] }, { ...good, access: {} }, { ...good, access: { lat: 91, lng: 0, name: null } }, { ...good, access: { lat: 1, lng: 2, name: 5 } }, { ...good, access: "x" },
    { ...good, geometry: Array.from({ length: 201 }, () => [1, 2]) },
  ])("rejects %j", (v) => expect(isHike(v)).toBe(false));
});
