import { describe, expect, it } from "vitest";
import type { Stop } from "./types";
import { routeSignature, type SignedStop } from "./route-signature";

const stop = (over: Partial<Stop> = {}): Stop => ({
  id: "a", tripId: "t", order: 0, name: "A", lat: 36.74, lng: -119.79, notes: null, source: "manual", photoUrl: null,
  visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...over,
});
const base: SignedStop[] = [stop(), stop({ id: "b", order: 1, lat: 37.96, lng: -119.12 })];
const sig = (stops: readonly SignedStop[] = base, date = "2026-07-01") => routeSignature(date, stops);

describe("routeSignature", () => {
  it("is stable and well-formed", () => {
    expect(sig()).toBe(sig());
    expect(sig()).toMatch(/^v1:[0-9a-f]{16}$/);
  });

  it("changes on order, add/remove, position, light, priority, dwell and date", () => {
    const b = sig();
    expect(sig([base[1], base[0]])).not.toBe(b);
    expect(sig([base[0]])).not.toBe(b);
    expect(sig([...base, stop({ id: "c" })])).not.toBe(b);
    expect(sig([stop({ lat: 36.75 }), base[1]])).not.toBe(b);
    expect(sig([stop({ lng: -119.8 }), base[1]])).not.toBe(b);
    expect(sig([stop({ lightPref: "sunset" }), base[1]])).not.toBe(b);
    expect(sig([stop({ priority: "must" }), base[1]])).not.toBe(b);
    expect(sig([stop({ dwellMinutes: 45 }), base[1]])).not.toBe(b);
    expect(sig(base, "2026-07-02")).not.toBe(b);
  });

  it("ignores name, notes, visited and photo", () => {
    const edited = [stop({ name: "Renamed", notes: "n", visited: true, photoUrl: "/p.jpg", order: 5 }), base[1]];
    expect(sig(edited)).toBe(sig());
  });

  it("ignores float noise below 1e-6", () => {
    expect(sig([stop({ lat: 1.0000001 })])).toBe(sig([stop({ lat: 1 })]));
  });
});
