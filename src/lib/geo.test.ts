import { describe, expect, it } from "vitest";
import { bearingEndpoint, isAddressOrCoordsName, haversineMeters, wrapLng } from "./geo";

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

describe("bearingEndpoint", () => {
  it("heads east along the equator", () => {
    const [lng, lat] = bearingEndpoint({ lat: 0, lng: 0 }, 90, 111.195);
    expect(Math.abs(lng - 1)).toBeLessThan(0.01);
    expect(Math.abs(lat)).toBeLessThan(0.01);
  });
  it("heads north along a meridian", () => {
    const [lng, lat] = bearingEndpoint({ lat: 0, lng: 0 }, 0, 111.195);
    expect(Math.abs(lng)).toBeLessThan(0.01);
    expect(Math.abs(lat - 1)).toBeLessThan(0.01);
  });
  it("does not wrap across the antimeridian, so a map line takes the short way", () => {
    const [lng] = bearingEndpoint({ lat: 0, lng: 179.5 }, 90, 111.195);
    expect(Math.abs(lng - 180.5)).toBeLessThan(0.01);
    expect(Math.abs(lng - 179.5 - 1)).toBeLessThan(0.01);
  });
  it("does not wrap west across the antimeridian either", () => {
    const [lng] = bearingEndpoint({ lat: 0, lng: -179.5 }, 270, 111.195);
    expect(Math.abs(lng - -180.5)).toBeLessThan(0.01);
    expect(Math.abs(lng + 179.5 + 1)).toBeLessThan(0.01);
  });
  it("stays finite near the pole", () => {
    const [lng, lat] = bearingEndpoint({ lat: 89, lng: 0 }, 90, 50);
    expect(Number.isFinite(lng)).toBe(true);
    expect(Number.isFinite(lat)).toBe(true);
    expect(Math.abs(lat - 89)).toBeLessThan(0.1);
  });
});

describe("isAddressOrCoordsName", () => {
  it("flags coordinate labels, fake spots and house-number-first addresses", () => {
    for (const n of ["37.7456, -119.5972", "-37.7, 119.5", "Spot 37.1071, -119.1250 (fake)", "1600 Pennsylvania Ave NW", "12B Rue de Rivoli, Paris", "221 Baker Street, London, UK"]) {
      expect(isAddressOrCoordsName(n), n).toBe(true);
    }
  });
  it("leaves real place names alone", () => {
    for (const n of ["Tunnel View", "Golden Gate Bridge", "Route 66 Diner", "Alpha Town (fake)", "Mount Whitney"]) {
      expect(isAddressOrCoordsName(n), n).toBe(false);
    }
  });
});
