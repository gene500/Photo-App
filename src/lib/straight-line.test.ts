import { describe, expect, it } from "vitest";
import { estimateLegDurations } from "./straight-line";

describe("estimateLegDurations", () => {
  it("returns one leg per consecutive pair", () => {
    const stops = [{ lat: 36, lng: -120 }, { lat: 36.5, lng: -120 }, { lat: 37, lng: -120 }];
    const legs = estimateLegDurations(stops);
    expect(legs).toHaveLength(2);
    // ~55.6 km * 1.3 / 80 km/h = ~54 min
    expect(legs[0]).toBeGreaterThan(50 * 60);
    expect(legs[0]).toBeLessThan(58 * 60);
  });
  it("is empty for fewer than two stops", () => {
    expect(estimateLegDurations([])).toEqual([]);
    expect(estimateLegDurations([{ lat: 1, lng: 1 }])).toEqual([]);
  });
});
