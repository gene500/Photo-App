import { describe, expect, it, vi } from "vitest";
import { departureTime, getSunWindows } from "./best-time";
import { lightWindows } from "./light-windows";
import { optimizeOrder } from "./optimize-order";
import { optimizeSchedule, optimizeScheduleAsync, isExactOptimization, optimizeScheduleExact, scheduleCost } from "./optimize-schedule";
import type { LightPref, StopPriority } from "./types";

const DATE = "2026-07-01";
const base = { lat: 37.7, lng: -119.6 };
const stop = (lightPref: LightPref, dwellMinutes = 30, over: Partial<typeof base> = {}) => ({ ...base, ...over, lightPref, dwellMinutes });
const flat = (n: number, secs: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : secs)));
const defaultDeparture = departureTime(base, DATE);

describe("priority", () => {
  const withPriority = (lightPref: LightPref, priority: StopPriority) => ({ ...base, lightPref, dwellMinutes: 30, priority });

  it("lets the must-have stop keep its light when two stops cannot both have theirs", () => {
    const d = flat(2, 2700);
    const sunriseWins = optimizeSchedule({ durations: d, stops: [withPriority("sunrise", "must"), withPriority("sunset", "normal")], plannedDate: DATE, defaultDeparture });
    expect(sunriseWins.misses.map((m) => m.stopIndex)).toEqual([1]);
    const sunsetWins = optimizeSchedule({ durations: d, stops: [withPriority("sunrise", "normal"), withPriority("sunset", "must")], plannedDate: DATE, defaultDeparture });
    expect(sunsetWins.misses.map((m) => m.stopIndex)).toEqual([0]);
    expect(sunsetWins.misses[0]!.priority).toBe("normal");
  });

  it("treats high priority as a heavier weight than normal", () => {
    const d = flat(2, 2700);
    const r = optimizeSchedule({ durations: d, stops: [withPriority("sunrise", "normal"), withPriority("sunset", "high")], plannedDate: DATE, defaultDeparture });
    expect(r.misses.map((m) => m.stopIndex)).toEqual([0]);
  });

  it("with time priority, a stop's priority no longer changes which stop misses its light", () => {
    const d = flat(2, 2700);
    const run = (a: StopPriority, b: StopPriority, focus?: "priority" | "time") =>
      optimizeSchedule({ durations: d, stops: [withPriority("sunrise", a), withPriority("sunset", b)], plannedDate: DATE, defaultDeparture, focus }).misses.map((m) => m.stopIndex);
    expect(run("must", "normal", "time")).toEqual(run("normal", "must", "time"));
    // Priority focus (and no focus at all) still lets the must-have stop win.
    expect(run("must", "normal", "priority")).toEqual([1]);
    expect(run("normal", "must", "priority")).toEqual([0]);
    expect(run("must", "normal")).toEqual([1]);
  });

  it("defaults a stop without a priority to normal", () => {
    const d = flat(2, 2700);
    const r = optimizeSchedule({ durations: d, stops: [stop("sunrise"), stop("sunset")], plannedDate: DATE, defaultDeparture });
    expect(r.misses.every((m) => m.priority === "normal")).toBe(true);
  });
});

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

  it("keeps a preferred departure that already meets every window", () => {
    const stops = [stop("any"), stop("any"), stop("sunset", 30)];
    const preferredDeparture = new Date(defaultDeparture.getTime() + 11 * 3600_000 + 7 * 60_000);
    const r = optimizeSchedule({ durations: flat(3, 3600), stops, plannedDate: DATE, defaultDeparture, preferredDeparture });
    expect(r.misses).toEqual([]);
    expect(r.departAt).toEqual(preferredDeparture);
  });

  it("still searches from the default when the preferred departure is too late to help", () => {
    // A trip created in the evening is saved with a late start; earlier departures must stay reachable.
    const stops = [stop("any"), stop("any"), stop("sunset", 30)];
    const preferredDeparture = new Date(defaultDeparture.getTime() + 20 * 3600_000);
    const r = optimizeSchedule({ durations: flat(3, 3600), stops, plannedDate: DATE, defaultDeparture, preferredDeparture });
    expect(r.misses).toEqual([]);
    expect(r.departAt.getTime()).toBeLessThan(preferredDeparture.getTime());
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

  it("local search beats the sunrise-first baseline objective on a mixed 12-stop trip", () => {
    const prefs: LightPref[] = ["any", "sunset", "sunrise", "any"];
    const stops = Array.from({ length: 12 }, (_, i) => stop(prefs[i % 4], 30));
    const input = { durations: flat(12, 1800), stops, plannedDate: DATE, defaultDeparture };
    const r = optimizeSchedule(input);
    // Sunrise stops first, sunset stops last, leaving at sunrise: the obvious plan the search must at least match.
    const baseline = [0, ...[2, 6, 10, 1, 3, 4, 5, 7, 8, 9, 11]];
    expect(scheduleCost(input, r.order, r.departAt)).toBeLessThanOrEqual(scheduleCost(input, baseline, defaultDeparture));
    // Drive time is the same for every order here, so the cost difference is all missed light (weighted minutes).
    const missed = (order: number[], at: Date) => (scheduleCost(input, order, at) - order.slice(1).reduce((sum, v, k) => sum + input.durations[order[k]!]![v]!, 0)) / 180;
    expect(missed(r.order, r.departAt)).toBeLessThanOrEqual(missed(baseline, defaultDeparture));
  });

  it("puts sunrise stops before sunset stops when a day of stops lies between them", () => {
    // Short drives and long stays at the unconstrained stops fill the day, so driving overnight cannot be cheaper.
    const kinds: LightPref[] = ["any", "sunrise", "any", "sunset", "sunrise", "any", "sunset", "any", "any", "sunrise", "any", "sunset"];
    const stops = kinds.map((k, i) => stop(k, i === 0 ? 10 : k === "any" ? 150 : 20, { lat: base.lat + i * 0.01 }));
    const r = optimizeSchedule({ durations: flat(12, 300), stops, plannedDate: DATE, defaultDeparture });
    const pos = (p: LightPref) => r.order.map((i, k) => (stops[i]!.lightPref === p ? k : -1)).filter((k) => k >= 0);
    expect(r.misses).toEqual([]);
    expect(Math.max(...pos("sunrise"))).toBeLessThan(Math.min(...pos("sunset")));
  });
});

describe("search-size thresholds", () => {
  // Exact search covers up to 7 free stops (8 total); 9 total and beyond use the local search.
  it.each([7, 8, 9, 10])("returns a valid, stable, fast schedule for %i stops", (n) => {
    const prefs: LightPref[] = ["sunrise", "sunset", "any", "golden", "any", "sunrise", "sunset", "any", "sunrise", "any"];
    const stops = Array.from({ length: n }, (_, i) => stop(prefs[i]!, 20, { lat: 37.7 + i * 0.01 }));
    const durations = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 600 + ((i * 7 + j * 13) % 11) * 120)));
    const run = () => optimizeSchedule({ durations, stops, plannedDate: DATE, defaultDeparture });
    const t0 = performance.now();
    const a = run();
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(a.order[0]).toBe(0);
    expect([...a.order].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(run()).toEqual(a);
  });

  it("survives duplicate stops and missing or unreachable durations", () => {
    const stops = [stop("sunrise"), stop("sunrise"), stop("sunset"), stop("any")];
    const durations = [[0, 0, NaN, 600], [0, 0, 600, Infinity], [NaN, 600, 0, 600], [600, 600, 600, 0]];
    const r = optimizeSchedule({ durations, stops, plannedDate: DATE, defaultDeparture });
    expect([...r.order].sort()).toEqual([0, 1, 2, 3]);
    expect(Number.isFinite(r.departAt.getTime())).toBe(true);
  });
});

describe("9-stop local search against the exact search", () => {
  // Deterministic generator so the instances are the same on every run.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const prefs: LightPref[] = ["any", "sunrise", "sunset", "golden", "sunset", "sunrise"];
  const priorities: StopPriority[] = ["normal", "normal", "high", "must"];

  function instance(seed: number, n: number) {
    const r = rng(seed);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
    const stops = Array.from({ length: n }, (_, i) => ({
      lat: 37 + r() * 1.5,
      lng: -120 + r() * 1.5,
      lightPref: i === 0 ? ("any" as const) : pick(prefs),
      dwellMinutes: 20 + Math.floor(r() * 70),
      priority: pick(priorities),
    }));
    const durations = stops.map((a, i) => stops.map((b, j) => (i === j ? 0 : Math.round((Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111_000) / 15 * (0.9 + r() * 0.2)))));
    return { durations, stops, plannedDate: DATE, defaultDeparture: departureTime(stops[0]!, DATE) };
  }

  it("is within a small tolerance of exact on seeded random 9-stop instances", () => {
    let worst = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const input = instance(seed, 9);
      const exact = optimizeScheduleExact(input);
      const local = optimizeSchedule(input);
      const ce = scheduleCost(input, exact.order, exact.departAt);
      const cl = scheduleCost(input, local.order, local.departAt);
      worst = Math.max(worst, cl / ce);
      expect(cl, `seed ${seed}`).toBeLessThanOrEqual(ce * 1.02 + 600);
    }
    console.log("worst local/exact cost ratio", worst);
  }, 120_000);

  it.each([15, 25])("gives identical output for %i stops however fast the machine is", (n) => {
    const input = instance(7, n);
    input.stops.forEach((s, i) => { if (i > 0) s.lightPref = prefs[1 + (i % 5)]!; });
    const first = optimizeSchedule(input);
    expect(optimizeSchedule(input)).toEqual(first);
    // A clock that jumps a second per reading (a very slow machine) must not change the answer.
    let t = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => (t += 1000));
    try {
      expect(optimizeSchedule(input)).toEqual(first);
    } finally {
      spy.mockRestore();
    }
  });

  it("stays under about 400 ms for 25 stops with light preferences on every stop", () => {
    const input = instance(99, 25);
    input.stops.forEach((s, i) => { if (i > 0) s.lightPref = prefs[1 + (i % 5)]!; });
    const t0 = performance.now();
    const r = optimizeSchedule(input);
    const ms = performance.now() - t0;
    console.log("25 stops ms", Math.round(ms));
    expect(r.order).toHaveLength(25);
    expect(ms).toBeLessThan(1500); // loose: slower CI machines
  });
});

describe("isExactOptimization", () => {
  it("is true only where the answer is provably the best, by stop count", () => {
    expect(isExactOptimization(3, false)).toBe(true);
    expect(isExactOptimization(12, false)).toBe(true);
    expect(isExactOptimization(13, false)).toBe(false);
    expect(isExactOptimization(8, true)).toBe(true);
    expect(isExactOptimization(9, true)).toBe(false);
    expect(isExactOptimization(25, true)).toBe(false);
  });
});

describe("optimizeScheduleAsync (shared-server solver)", () => {
  const prefs: LightPref[] = ["sunrise", "sunset", "any", "golden", "any", "sunrise", "sunset"];
  const make = (n: number) => ({
    stops: Array.from({ length: n }, (_, i) => stop(i === 0 ? "any" : prefs[i % prefs.length]!, 20, { lat: 37.7 + i * 0.01 })),
    durations: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 600 + ((i * 7 + j * 13) % 11) * 120))),
    plannedDate: DATE,
    defaultDeparture,
  });

  it.each([5, 8, 12, 25])("gives the same answer as the synchronous solver when no budget applies (%i stops)", async (n) => {
    const input = make(n);
    expect(await optimizeScheduleAsync(input)).toEqual({ ...optimizeSchedule(input), complete: true });
  });

  it("with an exhausted time budget still returns a complete valid schedule, quickly", async () => {
    for (const n of [8, 25]) {
      const input = make(n);
      const t0 = performance.now();
      const r = await optimizeScheduleAsync(input, { budgetMs: 0 });
      expect(performance.now() - t0).toBeLessThan(n === 8 ? 600 : 400);
      expect(r.order[0]).toBe(0);
      expect([...r.order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("flags a budget-cut search as incomplete, and an uncut one as complete", async () => {
    expect((await optimizeScheduleAsync(make(12), { budgetMs: 0 })).complete).toBe(false);
    expect((await optimizeScheduleAsync(make(12))).complete).toBe(true);
  });

  it("is never worse for having more time (a cut-short search is a valid, not-better answer)", async () => {
    const input = make(12);
    const cut = await optimizeScheduleAsync(input, { budgetMs: 0 });
    const full = await optimizeScheduleAsync(input);
    expect(scheduleCost(input, full.order, full.departAt)).toBeLessThanOrEqual(scheduleCost(input, cut.order, cut.departAt) + 1e-6);
  });

  it("lets other work run while it solves: the event loop is never held for long", async () => {
    let worst = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
    }, 1);
    try {
      await optimizeScheduleAsync(make(25));
      await optimizeScheduleAsync(make(8));
      await new Promise((r) => setTimeout(r, 10)); // let the timer record a gap that ended with the work
    } finally {
      clearInterval(timer);
    }
    // The synchronous solver holds the loop for hundreds of ms on these inputs.
    expect(worst).toBeLessThan(250);
  });
});
