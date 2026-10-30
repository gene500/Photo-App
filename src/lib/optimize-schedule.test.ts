import { describe, expect, it, vi } from "vitest";
import { daylightInterval, departureTime, getSunWindows } from "./best-time";
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
    const stops = [0, 3, 1, 2].map((i) => stop("any", 30, { lat: base.lat + i * 0.01 }));
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
    const missed = (order: number[], at: Date) => (scheduleCost(input, order, at) - order.slice(1).reduce((sum, v, k) => sum + input.durations[order[k]!]![v]!, 0)) / 60;
    expect(missed(r.order, r.departAt)).toBeLessThanOrEqual(missed(baseline, defaultDeparture));
  });

  it("puts sunrise stops before sunset stops when a day of stops lies between them", () => {
    // Short drives and long stays at the unconstrained stops fill the day (but still fit in its daylight), so driving overnight cannot be cheaper.
    const kinds: LightPref[] = ["any", "sunrise", "any", "sunset", "sunrise", "any", "sunset", "any", "any", "sunrise", "any", "sunset"];
    const stops = kinds.map((k, i) => stop(k, i === 0 ? 10 : k === "any" ? 140 : 20, { lat: base.lat + i * 0.01 }));
    const r = optimizeSchedule({ durations: flat(12, 300), stops, plannedDate: DATE, defaultDeparture });
    const pos = (p: LightPref) => r.order.map((i, k) => (stops[i]!.lightPref === p ? k : -1)).filter((k) => k >= 0);
    // Leaving before dawn would have met every sunrise window but put the first stop in the dark, so a few minutes of light are traded for daylight.
    expect(r.dark).toEqual([]);
    expect(Math.max(...r.misses.map((m) => m.minutes))).toBeLessThan(60);
    expect(Math.max(...pos("sunrise"))).toBeLessThan(Math.min(...pos("sunset")));
  });
});

describe("fixed departure", () => {
  const d = flat(3, 3600);
  const stops = [stop("any"), stop("sunrise"), stop("sunrise")];
  // A mid-afternoon start the search would otherwise move to the early morning to catch the sunrise stop.
  const afternoon = new Date(defaultDeparture.getTime() + 9 * 3_600_000);

  it("keeps the given start and orders the stops for it", () => {
    const free = optimizeSchedule({ durations: d, stops, plannedDate: DATE, defaultDeparture, preferredDeparture: afternoon });
    expect(free.departAt.getTime()).not.toBe(afternoon.getTime());
    const fixed = optimizeSchedule({ durations: d, stops, plannedDate: DATE, defaultDeparture, preferredDeparture: afternoon, fixedDeparture: true });
    expect(fixed.departAt.getTime()).toBe(afternoon.getTime());
    expect(fixed.timed).toBe(true);
    // The sunrise stops cannot be met from an afternoon start, and the result says so instead of moving the start.
    expect(fixed.misses.length).toBeGreaterThan(0);
  });

  it("falls back to the default start when none is given", () => {
    const fixed = optimizeSchedule({ durations: d, stops, plannedDate: DATE, defaultDeparture, fixedDeparture: true });
    expect(fixed.departAt.getTime()).toBe(defaultDeparture.getTime());
  });
});

describe("daylight", () => {
  const anyStops = (n: number, dwell: number, over: Partial<typeof base> = {}) => Array.from({ length: n }, () => stop("any", dwell, over));
  const lateStart = new Date(defaultDeparture.getTime() + 15 * 3600_000); // about 9 pm, after sunset

  it("keeps the shortest order at the default start, and says nothing is dark, when every visit is in daylight", () => {
    const stops = anyStops(4, 30);
    const d = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => Math.abs(i - j) * 600));
    const r = optimizeSchedule({ durations: d, stops, plannedDate: DATE, defaultDeparture });
    expect(r.order).toEqual(optimizeOrder(d));
    expect(r.dark).toEqual([]);
    expect(r.timed).toBe(false);
    expect(r.departAt).toEqual(defaultDeparture);
  });

  it("moves a start that would put visits in the dark, even when no stop has a light preference", () => {
    const input = { durations: flat(3, 1800), stops: anyStops(3, 30), plannedDate: DATE, defaultDeparture, preferredDeparture: lateStart };
    const r = optimizeSchedule(input);
    expect(r.timed).toBe(true);
    expect(r.dark).toEqual([]);
    expect(r.departAt.getTime()).toBeLessThan(lateStart.getTime());
    const [rise, set] = daylightInterval(base.lat, base.lng, DATE)!;
    expect(r.departAt.getTime()).toBeGreaterThanOrEqual(rise.getTime() - 3600_000);
    expect(r.departAt.getTime() + 3600_000 + 2 * 1800_000).toBeLessThanOrEqual(set.getTime());
  });

  it("with the time focus only reports the dark visits: the order and start stay as they were", () => {
    const input = { durations: flat(3, 1800), stops: anyStops(3, 30), plannedDate: DATE, defaultDeparture, preferredDeparture: lateStart, focus: "time" as const };
    const r = optimizeSchedule(input);
    expect(r.order).toEqual(optimizeOrder(input.durations));
    expect(r.timed).toBe(false);
    expect(r.dark.map((m) => m.stopIndex).sort()).toEqual([0, 1, 2]);
    expect(r.dark.every((m) => m.minutes > 0 && m.priority === "normal")).toBe(true);
  });

  it("does not call a visit dark while it touches the stop's own preferred light", () => {
    const [rise] = daylightInterval(base.lat, base.lng, DATE)!;
    const preferredDeparture = new Date(rise.getTime() - 8 * 60_000); // inside the 20 min before sunrise that a sunrise shot starts in; the next stop is reached as the sun comes up
    const r = optimizeSchedule({ durations: flat(2, 60), stops: [stop("sunrise", 5), stop("any", 5)], plannedDate: DATE, defaultDeparture, preferredDeparture });
    expect(r.misses).toEqual([]);
    expect(r.dark.map((m) => m.stopIndex)).toEqual([]);
    expect(r.departAt).toEqual(preferredDeparture);
  });

  it("applies no daylight rule where the sun does not rise or set that day (polar day and night)", () => {
    const polar = { lat: 78, lng: 15 };
    for (const date of ["2026-06-21", "2026-12-21"]) {
      const dep = departureTime(polar, date);
      const r = optimizeSchedule({ durations: flat(3, 1800), stops: anyStops(3, 600, polar), plannedDate: date, defaultDeparture: dep, preferredDeparture: new Date(dep.getTime() + 15 * 3600_000) });
      expect(r.dark, date).toEqual([]);
      expect(r.timed, date).toBe(false);
    }
  });

  it("at high latitude in midwinter, fits visits in the few hours of light and reports the ones that cannot", () => {
    const fairbanks = { lat: 64.8, lng: -147.7 };
    const date = "2026-12-21";
    const dep = departureTime(fairbanks, date);
    const fits = optimizeSchedule({ durations: flat(3, 1800), stops: anyStops(3, 30, fairbanks), plannedDate: date, defaultDeparture: dep });
    expect(fits.dark).toEqual([]);
    expect(fits.timed).toBe(false);
    // Two 2 h drives and three stays need over 5 h of the ~3.7 h of light: something is left in the dark, and it is reported rather than dropped.
    const tooLong = optimizeSchedule({ durations: flat(3, 7200), stops: anyStops(3, 30, fairbanks), plannedDate: date, defaultDeparture: dep });
    expect(tooLong.dark.length).toBeGreaterThan(0);
    expect(tooLong.dark.every((m) => m.minutes > 0 && m.stopIndex >= 0 && m.stopIndex < 3)).toBe(true);
    expect([...tooLong.order].sort()).toEqual([0, 1, 2]);
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

describe("light windows across solar midnight", () => {
  const winsOn = (pref: LightPref, date: string) => lightWindows(pref, getSunWindows(base.lat, base.lng, date)).map(([a, b]) => [a.getTime(), b.getTime()] as [number, number]);
  const missFrom = (arrival: number, wins: [number, number][], dwell: number) => Math.min(...wins.map(([a, b]) => (arrival + dwell * 60_000 < a ? a - arrival - dwell * 60_000 : Math.max(0, arrival - b)))) / 60_000;
  const run = (pref: LightPref, arrival: Date) =>
    optimizeSchedule({
      durations: flat(2, 600),
      stops: [stop("any", 0), stop(pref, 30)],
      plannedDate: DATE,
      defaultDeparture: new Date(arrival.getTime() - 600_000),
      fixedDeparture: true,
    });

  it("measures a sunrise miss to the nearest sunrise, which can be the next day's", () => {
    const arrival = new Date("2026-07-02T05:00:00Z");
    const r = run("sunrise", arrival);
    const expected = missFrom(arrival.getTime(), [...winsOn("sunrise", "2026-07-01"), ...winsOn("sunrise", "2026-07-02")], 30);
    expect(expected).toBeLessThan(500);
    expect(r.misses).toHaveLength(1);
    expect(r.misses[0]!.minutes).toBeCloseTo(expected, 5);
  });

  it("measures a sunset miss to the previous evening's sunset just after solar midnight", () => {
    const arrival = new Date("2026-07-02T08:30:00Z");
    const r = run("sunset", arrival);
    const expected = missFrom(arrival.getTime(), [...winsOn("sunset", "2026-07-01"), ...winsOn("sunset", "2026-07-02")], 30);
    expect(expected).toBeLessThan(400);
    expect(r.misses[0]!.minutes).toBeCloseTo(expected, 5);
  });
});

describe("lost-cause light misses do not pull the route into a detour (Yosemite, late October)", () => {
  type Spot = { lat: number; lng: number; branch: "valley" | "glacier" | "tioga"; hub: number };
  const spot = (lat: number, lng: number, branch: Spot["branch"], hub: number): Spot => ({ lat, lng, branch, hub });
  // hub = minutes of road from the Valley floor; the Glacier Point and Tioga roads are separate spurs.
  const spots: Spot[] = [
    spot(37.8651, -119.5383, "tioga", 50), // 0 park centroid, the start
    spot(37.716, -119.67, "valley", 0),
    spot(37.7227, -119.637, "valley", 0),
    spot(37.7305, -119.5737, "glacier", 62), // Glacier Point
    spot(37.8836, -119.3593, "tioga", 105), // Lembert Dome, ~1 h east of the Valley
    spot(37.7567, -119.5966, "valley", 0),
    spot(37.7163, -119.6466, "valley", 0),
    spot(37.7158, -119.6775, "valley", 0),
    spot(37.7219, -119.5846, "glacier", 55),
  ];
  const km = (a: Spot, b: Spot) => {
    const r = Math.PI / 180;
    const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  };
  const secs = (a: Spot, b: Spot) =>
    a === b ? 0 : a.branch === b.branch && a.branch === "valley" ? Math.max(120, ((km(a, b) * 1.4) / 40) * 3600) : a.branch === b.branch ? Math.abs(a.hub - b.hub) * 60 + 120 : (a.hub + b.hub) * 60 + 120;
  const d = spots.map((a) => spots.map((b) => secs(a, b)));
  const day = "2026-10-28";
  const mk = (priorities: StopPriority[] = []) =>
    spots.map((s, i) => ({ lat: s.lat, lng: s.lng, lightPref: (i === 0 ? "any" : "golden") as LightPref, dwellMinutes: i === 0 ? 0 : 30, priority: priorities[i] ?? ("normal" as StopPriority) }));
  const drive = (order: number[]) => order.slice(1).reduce((s, x, k) => s + d[order[k]!]![x]!, 0);

  it("stays near the shortest drive instead of zigzagging to Lembert Dome mid-valley", () => {
    const stops = mk();
    const r = optimizeSchedule({ durations: d, stops, plannedDate: day, defaultDeparture: departureTime(stops[0]!, day) });
    const best = drive(optimizeOrder(d));
    expect(drive(r.order)).toBeLessThanOrEqual(best * 1.3);
    // Lembert Dome (4) is first or last of the trip, never between valley stops.
    const at = r.order.indexOf(4);
    expect(at === 1 || at === r.order.length - 1).toBe(true);
  });

  it("still lets a Must stop pull the route far out of its way", () => {
    const priorities: StopPriority[] = [];
    priorities[4] = "must";
    const stops = mk(priorities);
    const r = optimizeSchedule({ durations: d, stops, plannedDate: day, defaultDeparture: departureTime(stops[0]!, day) });
    expect(r.misses.find((m) => m.stopIndex === 4)).toBeUndefined(); // met whatever the drive
  });

  it("caps a Normal stop's miss but not a High or Must stop's", () => {
    const noon = new Date(`${day}T20:00:00Z`); // far from any golden hour at Lembert Dome
    const extra = (p: StopPriority) => {
      const priorities: StopPriority[] = [];
      priorities[4] = p;
      const input = { durations: d, stops: mk(priorities), plannedDate: day, defaultDeparture: noon };
      return scheduleCost(input, [0, 4], noon) - d[0]![4]!;
    };
    // Uncapped, a High miss costs exactly 8 x a Normal miss; the Normal one is capped, so the ratio is far larger.
    expect(extra("high") / extra("normal")).toBeGreaterThan(8.5);
    expect(extra("must") / extra("high")).toBeCloseTo(1000 / 8, 5);
  });
});
