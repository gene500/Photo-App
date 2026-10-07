import { describe, expect, it } from "vitest";
import { haversineMeters } from "./geo";

describe("haversineMeters", () => {
  it("measures one degree of longitude at the equator (~111.2 km)", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -1);
  });

  it("is zero for identical points", () => {
    expect(haversineMeters({ lat: 37.7, lng: -119.6 }, { lat: 37.7, lng: -119.6 })).toBe(0);
  });
});
