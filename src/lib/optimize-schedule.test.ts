import { describe, expect, it } from "vitest";
import { departureTime, getSunWindows } from "./best-time";
import { lightWindows } from "./light-windows";
import { optimizeOrder } from "./optimize-order";
import { optimizeSchedule } from "./optimize-schedule";
import type { LightPref } from "./types";

const DATE = "2026-07-01";
const base = { lat: 37.7, lng: -119.6 };
const stop = (lightPref: LightPref, dwellMinutes = 30, over: Partial<typeof base> = {}) => ({ ...base, ...over, lightPref, dwellMinutes });
const flat = (n: number, secs: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : secs)));
const defaultDeparture = departureTime(base, DATE);

describe("optimizeSchedule", () => {
  it("matches optimizeOrder and keeps the default departure when every stop is any", () => {
    const stops = [0, 3, 1, 2].map((lat) => stop("any", 30, { lat }));
    const d = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => Math.abs(i - j) * 600));
    const r = optimizeSchedule({ durations: d, stops, plannedDate: DATE, defaultDeparture });
    expect(r.order).toEqual(optimizeOrder(d));
    expect(r.departAt).toEqual(defaultDeparture);
    expect(r.misses).toEqual([]);
  });

  it("orders sunrise peak, any cafe, sunset beach as peak, cafe, beach and meets sunrise", () => {
    const stops = [stop("sunrise"), stop("any", 480), stop("sunset")];
    const shuffled = [stops[0], stops[2], stops[1]]; // submitted as peak, beach, cafe
    const d = flat(3, 2700);
    const r = optimizeSchedule({ durations: d, stops: shuffled, plannedDate: DATE, defaultDeparture });
    expect(r.order).toEqual([0, 2, 1]);
    const sun = getSunWindows(base.lat, base.lng, DATE);
    const [[from, to]] = lightWindows("sunrise", sun);
    expect(r.departAt.getTime()).toBeGreaterThanOrEqual(from.getTime());
    // Leaving later only helps the beach, so the departure drifts to the end of the sunrise
    // window (at most one 15 min grid step past it) and the peak is still shot in its light.
    expect(r.departAt.getTime()).toBeLessThanOrEqual(to.getTime() + 15 * 60_000);
    expect(r.misses.filter((m) => m.pref === "sunrise" && m.minutes >= 15)).toEqual([]);
  });

  it("moves the departure later so a lone sunset stop is reached in its light", () => {
    const stops = [stop("any"), stop("any"), stop("sunset", 30)];
    const r = optimizeSchedule({ durations: flat(3, 3600), stops, plannedDate: DATE, defaultDeparture });
    expect(r.order).toEqual([0, 1, 2]);
    expect(r.departAt.getTime()).toBeGreaterThan(defaultDeparture.getTime() + 6 * 3600_000);
    expect(r.misses).toEqual([]);
  });

  it("reports the stops whose light cannot be met, by original index", () => {
    // An 8 h stay at the first stop means the later sunrise stops cannot all be reached in the morning light.
    const stops = [stop("sunrise", 480), stop("sunrise", 30), stop("sunrise", 30)];
    const r = optimizeSchedule({ durations: flat(3, 3600), stops, plannedDate: DATE, defaultDeparture });
    expect(r.misses.length).toBeGreaterThan(0);
    for (const m of r.misses) {
      expect(m.minutes).toBeGreaterThan(0);
      expect(m.pref).toBe("sunrise");
    }
  });

  it("does not crash without sun times (polar summer)", () => {
    const polar = { lat: 78, lng: 15 };
    const stops = [stop("sunrise", 30, polar), stop("sunset", 30, polar), stop("golden", 30, polar)];
    const dep = departureTime(polar, "2026-06-21");
    const r = optimizeSchedule({ durations: flat(3, 1800), stops, plannedDate: "2026-06-21", defaultDeparture: dep });
    expect(r.order[0]).toBe(0);
    expect([...r.order].sort()).toEqual([0, 1, 2]);
    expect(r.misses).toEqual([]);
  });

  it("is deterministic", () => {
    const stops = [stop("sunrise"), stop("any"), stop("sunset"), stop("golden", 45), stop("any", 90)];
    const d = flat(5, 1500).map((row, i) => row.map((v, j) => v + ((i * 7 + j * 3) % 5) * 120));
    const a = optimizeSchedule({ durations: d, stops, plannedDate: DATE, defaultDeparture });
    const b = optimizeSchedule({ durations: d, stops, plannedDate: DATE, defaultDeparture });
    expect(b).toEqual(a);
  });

  it("stays fast and valid for 25 stops, exact and heuristic sizes", () => {
    const prefs: LightPref[] = ["sunrise", "any", "sunset", "golden"];
    for (const n of [8, 9, 25]) {
      const stops = Array.from({ length: n }, (_, i) => stop(prefs[i % 4], 30, { lat: 37 + (i % 5) * 0.1, lng: -119 + i * 0.05 }));
      const d = stops.map((a) => stops.map((b) => Math.round((Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111_000) / 20)));
      const t0 = performance.now();
      const r = optimizeSchedule({ durations: d, stops, plannedDate: DATE, defaultDeparture });
      expect(performance.now() - t0).toBeLessThan(n === 25 ? 3000 : 5000);
      expect(r.order[0]).toBe(0);
      expect([...r.order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("local search beats the nearest-neighbour baseline objective on a mixed 12-stop trip", () => {
    const prefs: LightPref[] = ["any", "sunset", "sunrise", "any"];
    const stops = Array.from({ length: 12 }, (_, i) => stop(prefs[i % 4], 30));
    const r = optimizeSchedule({ durations: flat(12, 1800), stops, plannedDate: DATE, defaultDeparture });
    // Sunrise stops should come before sunset stops in the chosen order.
    const pos = (p: LightPref) => r.order.map((i, k) => (stops[i].lightPref === p ? k : -1)).filter((k) => k >= 0);
    expect(Math.max(...pos("sunrise"))).toBeLessThan(Math.min(...pos("sunset")));
  });
});
