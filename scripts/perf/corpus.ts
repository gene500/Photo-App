/* Seeded randomized corpora for the optimizer equivalence checks. Deterministic: the same seed gives the same cases. */
import type { LightPref, StopPriority } from "@/lib/types";
import type { OptimizeTuning, ScheduleStop } from "@/lib/optimize-schedule";

export function rng(seed: number) {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return { r, int: (a: number, b: number) => a + Math.floor(r() * (b - a + 1)), pick: <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]! };
}
type Rng = ReturnType<typeof rng>;

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
};

export type Layout = { lat: number; lng: number }[];

export function makeLayout(g: Rng, n: number, centre = { lat: 37.6, lng: -112.17 }): Layout {
  const kind = g.int(0, 3);
  const pts: Layout = [];
  for (let i = 0; i < n; i++) {
    let spread = 0.06;
    if (kind === 0) spread = i > 0 && g.r() < 0.3 ? 0.9 : 0.06; // cluster + outliers
    if (kind === 1) spread = 0.5; // uniform
    if (kind === 2) spread = i % 7 === 6 ? 2 : 0.02; // very tight + far outliers
    pts.push({ lat: centre.lat + (g.r() - 0.5) * 2 * spread, lng: centre.lng + (g.r() - 0.5) * 2 * spread });
  }
  // duplicate points (zero-duration ties)
  if (n > 3 && g.r() < 0.4) for (let k = g.int(1, Math.min(4, n - 1)); k > 0; k--) pts[g.int(1, n - 1)] = { ...pts[g.int(0, n - 1)]! };
  return pts;
}

/** Duration matrix variants: symmetric model, asymmetric, integer-valued (ties), with missing/non-finite entries, rarely negative. */
export function makeDurations(g: Rng, pts: Layout): number[][] {
  const n = pts.length;
  const mode = g.int(0, 5);
  const d = pts.map((a, i) =>
    pts.map((b, j) => {
      if (i === j) return 0;
      let v = ((km(a, b) * 1.4) / 70) * 3600;
      if (mode === 1) v *= 0.7 + 0.6 * ((i * 31 + j * 17) % 10) / 10; // asymmetric
      if (mode === 2) v = Math.round(v / 600) * 600; // coarse integers: many ties
      if (mode === 5) v = Math.round(v);
      return v;
    }),
  );
  if (mode === 3 || mode === 4) {
    const bad = [NaN, Infinity, -Infinity, undefined as unknown as number, null as unknown as number, "x" as unknown as number];
    const holes = mode === 3 ? g.int(1, 3) : g.int(1, Math.max(1, Math.floor(n / 2)));
    for (let k = 0; k < holes; k++) {
      const i = g.int(0, n - 1), j = g.int(0, n - 1);
      if (i !== j) d[i]![j] = g.pick(bad);
    }
  }
  if (g.r() < 0.02 && n > 2) d[g.int(0, n - 1)]![g.int(0, n - 1)] = -g.int(1, 300); // a negative leg (disables pruning that assumes >= 0)
  return d;
}

/** Sizes cover 2..40 with the small ones (the real trip sizes) most often. */
export function pickSize(g: Rng, max = 40): number {
  const x = g.r();
  if (x < 0.55) return g.int(2, Math.min(max, 14));
  if (x < 0.8) return g.int(Math.min(max, 15), Math.min(max, 22));
  return g.int(Math.min(max, 23), max);
}

export function orderCases(count: number, seed = 20261111, max = 40): number[][][] {
  const g = rng(seed);
  const out: number[][][] = [];
  for (let c = 0; c < count; c++) {
    const n = c < 39 ? Math.min(max, 2 + c) : pickSize(g, max); // every size at least once
    out.push(makeDurations(g, makeLayout(g, n)));
  }
  return out;
}

export type ScheduleCase = {
  durations: number[][];
  stops: ScheduleStop[];
  plannedDate: string;
  defaultDeparture: Date;
  preferredDeparture?: Date;
  focus?: "priority" | "time";
  fixedDeparture?: boolean;
  tuning?: Partial<OptimizeTuning>;
};
const PREFS: LightPref[] = ["sunrise", "golden", "sunset", "golden", "any", "any"];

export function scheduleCases(count: number, seed = 777, max = 40, fixedN?: number): ScheduleCase[] {
  const g = rng(seed);
  const out: ScheduleCase[] = [];
  for (let c = 0; c < count; c++) {
    const n = fixedN ?? (c < 39 ? Math.min(max, 2 + c) : pickSize(g, Math.min(max, 26)));
    const centre = { lat: g.pick([37.6, 0, -33.9, 48.1, 64.1, 69.6, -54.8, 28.4, 35.7]) + g.r(), lng: g.pick([-112.17, 10, 139.7, -0.1, 151.2, -71, 90]) };
    const pts = makeLayout(g, n, centre);
    const mixed = g.r() < 0.5;
    const stops: ScheduleStop[] = pts.map((p, i) => ({
      ...p,
      lightPref: g.r() < 0.1 ? "any" : i === 0 && g.r() < 0.6 ? "any" : g.pick(PREFS),
      dwellMinutes: g.pick([0, 10, 20, 30, 30, 40, 60, 90]),
      priority: mixed ? (g.pick(["normal", "normal", "normal", "high", "must"]) as StopPriority) : g.r() < 0.5 ? "normal" : undefined,
    }));
    if (g.r() < 0.1) stops.forEach((s) => (s.lightPref = "any"));
    const month = g.int(1, 12), day = g.int(1, 28);
    const plannedDate = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hour = g.pick([4, 5, 6, 7, 8, 9, 12, 15]);
    const defaultDeparture = new Date(`${plannedDate}T${String(hour).padStart(2, "0")}:${g.pick(["00", "15", "30", "07"])}:00Z`);
    const k: ScheduleCase = { durations: makeDurations(g, pts), stops, plannedDate, defaultDeparture };
    if (g.r() < 0.25) k.preferredDeparture = g.r() < 0.3 ? defaultDeparture : new Date(defaultDeparture.getTime() + g.int(-4, 8) * 900_000);
    if (g.r() < 0.25) k.focus = g.pick(["priority", "time"] as const);
    if (g.r() < 0.1) k.fixedDeparture = true;
    if (g.r() < 0.15) k.tuning = g.pick([{ missWeight: 30 }, { darkFactor: 1, driveBudgetRatio: 1.5 }, { driveBudgetRatio: Infinity }, { priorityBudgetRatio: 1.3, tailSlope: 0 }]);
    out.push(k);
  }
  return out;
}
