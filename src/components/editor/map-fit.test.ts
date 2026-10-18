import { describe, expect, it } from "vitest";
import { shouldFitStops } from "./map-fit";

const base = { prevCount: 0, count: 2, routePoints: 0, fitted: false };

describe("shouldFitStops", () => {
  it("frames a trip opened with 2+ stops and no route", () => {
    expect(shouldFitStops(base)).toBe(true);
  });
  it("frames when an empty or one-stop trip gets its 2nd stop, even if the map was already fitted", () => {
    expect(shouldFitStops({ ...base, prevCount: 1, fitted: false })).toBe(true);
    expect(shouldFitStops({ ...base, prevCount: 1, fitted: true })).toBe(true);
  });
  it("does not frame fewer than 2 stops", () => {
    expect(shouldFitStops({ ...base, count: 1 })).toBe(false);
  });
  it("does not reframe on a 3rd stop or later changes", () => {
    expect(shouldFitStops({ ...base, prevCount: 2, count: 3, fitted: true })).toBe(false);
  });
  it("leaves framing to the route when one is drawn, and treats an empty route as none", () => {
    expect(shouldFitStops({ ...base, routePoints: 5 })).toBe(false);
    expect(shouldFitStops({ ...base, routePoints: 0 })).toBe(true);
  });
});
