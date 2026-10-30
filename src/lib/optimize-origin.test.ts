import { describe, expect, it } from "vitest";
import { optimizeOrder } from "./optimize-order";
import { originNearStops, orderWithoutOrigin, stopIndexWithoutOrigin, withOrigin } from "./optimize-origin";
import { fakeDurationMatrix } from "@/server/external/fake";
import type { LngLat } from "./types";

describe("optimize-origin", () => {
  it("puts the position first and maps the answer back to the submitted stops", () => {
    expect(withOrigin([[1, 2], [3, 4]], { lat: 9, lng: 8 })).toEqual([[8, 9], [1, 2], [3, 4]]);
    expect(orderWithoutOrigin([0, 3, 1, 2])).toEqual([2, 0, 1]);
    expect(stopIndexWithoutOrigin(0)).toBeNull();
    expect(stopIndexWithoutOrigin(3)).toBe(2);
  });

  it("changes the best first stop when the origin is nearer the other end of the line", () => {
    // Stops on one meridian at lat 0, 1, 2. Without an origin stop 0 stays first.
    const stops: LngLat[] = [[0, 0], [0, 1], [0, 2]];
    expect(optimizeOrder(fakeDurationMatrix(stops))).toEqual([0, 1, 2]);
    // From a point just beyond lat 2, starting at the far end is cheaper: first stop is the one at lat 2.
    const from = withOrigin(stops, { lat: 2.2, lng: 0 });
    expect(orderWithoutOrigin(optimizeOrder(fakeDurationMatrix(from)))).toEqual([2, 1, 0]);
  });
});

describe("originNearStops", () => {
  const yosemite = { lat: 37.75, lng: -119.59 };
  it("accepts a position within 500 km of the nearest stop and rejects a far one", () => {
    expect(originNearStops({ lat: 37.4, lng: -122.1 }, [{ lat: 10, lng: 10 }, yosemite])).toBe(true); // Bay Area, ~230 km
    expect(originNearStops({ lat: 40.7, lng: -74 }, [yosemite, { lat: 36, lng: -118 }])).toBe(false); // New York
  });
  it("is false with no stops", () => expect(originNearStops({ lat: 0, lng: 0 }, [])).toBe(false));
});
