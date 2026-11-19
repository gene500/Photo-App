import { describe, expect, it } from "vitest";
import { computeArrivals } from "./best-time";
import { fromAnchor, planAnchor } from "./schedule-from-anchor";

const stop = (lng: number, visited = false) => ({ lat: 37, lng, dwellMinutes: 30, visited });

describe("planAnchor", () => {
  it("is the last stop of the visited run at the front", () => {
    expect(planAnchor([])).toBe(0);
    expect(planAnchor([stop(0), stop(1), stop(2)])).toBe(0);
    expect(planAnchor([stop(0, true), stop(1), stop(2)])).toBe(0);
    expect(planAnchor([stop(0, true), stop(1, true), stop(2)])).toBe(1);
    expect(planAnchor([stop(0, true), stop(1, true), stop(2, true), stop(3)])).toBe(2);
  });
  it("is 0 when every stop is visited", () => {
    expect(planAnchor([stop(0, true), stop(1, true)])).toBe(0);
  });
});

describe("fromAnchor", () => {
  const stops = [stop(-120, true), stop(-119.9, true), stop(-119.8), stop(-119.7)];
  const trip = { plannedDate: "2026-07-01", departAt: "2026-07-01T16:00:00.000Z", stops };
  it("is the plain computation with no anchor", () => {
    const legs = [600, 600, 600];
    expect(fromAnchor((t, l) => computeArrivals(t, l), trip, legs, 0, null)).toEqual(computeArrivals(trip, legs));
  });
  it("starts the remaining stops at the anchor's own start time and leaves the visited ones without a time", () => {
    const legs = [600, 900]; // anchor -> 3rd -> 4th
    const base = "2026-07-01T19:00:00.000Z";
    const out = fromAnchor((t, l) => computeArrivals(t, l), trip, legs, 1, base);
    expect(out).toHaveLength(4);
    expect(out[0]).toBeNull();
    expect(out[1]!.toISOString()).toBe(base); // the anchor stop (no walk): the new start
    expect(out[2]!.getTime()).toBe(new Date(base).getTime() + (30 * 60 + 600) * 1000); // dwell at the anchor, then the leg
    expect(out[3]!.getTime()).toBe(out[2]!.getTime() + (30 * 60 + 900) * 1000);
  });
  it("keeps the trip's start when no anchor time is given", () => {
    const out = fromAnchor((t, l) => computeArrivals(t, l), trip, [600, 900], 1, null);
    expect(out[1]!.toISOString()).toBe(trip.departAt);
  });
});
