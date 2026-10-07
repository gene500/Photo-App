import { describe, expect, it } from "vitest";
import { haversineMeters, wrapLng } from "./geo";

describe("haversineMeters", () => {
  it("measures one degree of longitude at the equator (~111.2 km)", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -1);
  });

  it("is zero for identical points", () => {
    expect(haversineMeters({ lat: 37.7, lng: -119.6 }, { lat: 37.7, lng: -119.6 })).toBe(0);
  });
});

describe("wrapLng", () => {
  it("leaves in-range values alone", () => {
    expect(wrapLng(-122.4)).toBe(-122.4);
    expect(wrapLng(180)).toBe(180);
    expect(wrapLng(-180)).toBe(-180);
  });
  it("wraps values past the antimeridian", () => {
    expect(wrapLng(190)).toBeCloseTo(-170);
    expect(wrapLng(-190)).toBeCloseTo(170);
    expect(wrapLng(540 + 10)).toBeCloseTo(-170);
    expect(wrapLng(-350)).toBeCloseTo(10);
  });
});
