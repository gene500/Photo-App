import { describe, expect, it } from "vitest";
import { decideFit, routeKey, selectionPadding } from "./map-fit";

const base = { prevCount: 0, count: 2, route: null as string | null, fittedRoute: null as string | null, fitted: false };

describe("routeKey", () => {
  it("is null for no route or an empty one, and differs between routes", () => {
    expect(routeKey(null)).toBeNull();
    expect(routeKey([])).toBeNull();
    expect(routeKey([[1, 2]])).toBeNull();
    expect(routeKey([[1, 2], [3, 4]])).not.toBe(routeKey([[1, 2], [5, 6]]));
    expect(routeKey([[1, 2], [3, 4]])).toBe(routeKey([[1, 2], [3, 4]]));
  });
});

describe("decideFit (no route)", () => {
  it("frames a trip opened with 2+ stops", () => {
    expect(decideFit(base)).toBe("stops");
  });
  it("frames when a trip reaches its 2nd stop, even if already fitted", () => {
    expect(decideFit({ ...base, prevCount: 1, fitted: true })).toBe("stops");
  });
  it("does not frame fewer than 2 stops, nor later adds", () => {
    expect(decideFit({ ...base, count: 1 })).toBeNull();
    expect(decideFit({ ...base, prevCount: 2, count: 3, fitted: true })).toBeNull();
  });
});

describe("decideFit (route)", () => {
  it("frames the route when it appears, even though the stops were already framed", () => {
    expect(decideFit({ ...base, prevCount: 2, fitted: true, route: "r1" })).toBe("route");
  });
  it("frames a new route (re-Optimize or Undo) but not the same one again", () => {
    expect(decideFit({ ...base, prevCount: 2, fitted: true, route: "r2", fittedRoute: "r1" })).toBe("route");
    expect(decideFit({ ...base, prevCount: 2, fitted: true, route: "r1", fittedRoute: "r1" })).toBeNull();
  });
});

describe("selectionPadding", () => {
  const base = { top: 72, right: 64, bottom: 64, left: 400 };
  it("keeps the base padding when no drawer covers the map", () => {
    expect(selectionPadding(base, 0)).toEqual(base);
  });
  it("adds the docked Edit drawer's width on the right", () => {
    expect(selectionPadding(base, 448)).toEqual({ ...base, right: 464 });
  });
  it("never shrinks an already larger right padding", () => {
    expect(selectionPadding({ ...base, right: 500 }, 40)).toEqual({ ...base, right: 500 });
  });
});
