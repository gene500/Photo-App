import { describe, expect, it } from "vitest";
import { routePoint, routePoints } from "./route-points";

describe("routePoint", () => {
  it("uses the stop when there is no access point", () => {
    expect(routePoint({ lat: 1, lng: 2 })).toEqual([2, 1]);
    expect(routePoint({ lat: 1, lng: 2, access: null })).toEqual([2, 1]);
  });
  it("uses the access point as [lng, lat] when set", () => {
    expect(routePoint({ lat: 1, lng: 2, access: { lat: 3, lng: 4 } })).toEqual([4, 3]);
  });
});

describe("routePoints", () => {
  it("keeps the order and swaps only stops with a lot", () => {
    expect(routePoints([{ lat: 1, lng: 2 }, { lat: 5, lng: 6, access: { lat: 7, lng: 8 } }, { lat: 9, lng: 10, access: null }])).toEqual([[2, 1], [8, 7], [10, 9]]);
  });
});
