/* Compares optimizer settings on random Bryce/Arches-style trips (one tight cluster plus far outliers, mixed light
 * preferences, all Normal priority). Road times are a model (haversine x 1.4 at 70 km/h), not Mapbox. */
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { DEFAULT_TUNING, optimizeSchedule, type OptimizeTuning, type ScheduleStop } from "@/lib/optimize-schedule";
import { optimizeOrder } from "@/lib/optimize-order";
import type { LightPref } from "@/lib/types";

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const km = (a: ScheduleStop, b: ScheduleStop) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const PREFS: LightPref[] = ["sunrise", "golden", "sunset", "golden", "any"];

function makeCase(n: number) {
  const centre = { lat: 37.6, lng: -112.17 };
  const stops: ScheduleStop[] = [];
  for (let i = 0; i < n; i++) {
    const outlier = i > 0 && rnd() < 0.3;
    const spread = outlier ? 0.9 : 0.06; // degrees
    stops.push({
      lat: centre.lat + (rnd() - 0.5) * 2 * spread,
      lng: centre.lng + (rnd() - 0.5) * 2 * spread,
      lightPref: i === 0 ? "any" : PREFS[Math.floor(rnd() * PREFS.length)]!,
      dwellMinutes: 20 + Math.floor(rnd() * 3) * 10,
      priority: i > 0 && process.env.MIX && rnd() < 0.15 ? "high" : "normal",
    });
  }
  const durations = stops.map((a) => stops.map((b) => (a === b ? 0 : ((km(a, b) * 1.4) / 70) * 3600)));
  return { stops, durations };
}

const drive = (d: number[][], o: number[]) => o.slice(1).reduce((s, x, k) => s + d[o[k]!]![x]!, 0);
/** Legs longer than 40 min that go back toward somewhere already visited: counts "out and back" trips. */
function backtracks(stops: ScheduleStop[], o: number[]) {
  let c = 0;
  for (let k = 2; k < o.length; k++) {
    const a = stops[o[k - 1]!]!, b = stops[o[k]!]!;
    if (km(a, b) < 25) continue;
    for (let j = 0; j < k - 1; j++) if (km(stops[o[j]!]!, b) < 8) { c++; break; }
  }
  return c;
}

const ALL_VARIANTS: Record<string, Partial<OptimizeTuning>> = {
  "A current (60 s/min, cap 60, dark x3)": {},
  "B light weight 30": { missWeight: 30 },
  "C light weight 20, dark x2": { missWeight: 20, darkFactor: 2 },
  "D light weight 10, dark x1": { missWeight: 10, darkFactor: 1 },
  "E drive budget 1.3x": { driveBudgetRatio: 1.3 },
  "F drive budget 1.5x": { driveBudgetRatio: 1.5 },
  "G weight 30 + budget 1.5x": { missWeight: 30, driveBudgetRatio: 1.5 },
  "H weight 20 + budget 1.3x": { missWeight: 20, driveBudgetRatio: 1.3 },
  "I weight 10 + budget 1.3x, dark x1": { missWeight: 10, driveBudgetRatio: 1.3, darkFactor: 1 },
  "J weight 15, dark x2, budget 1.25x": { missWeight: 15, darkFactor: 2, driveBudgetRatio: 1.25 },
  "K weight 20, dark x9, budget 1.3x": { missWeight: 20, darkFactor: 9, driveBudgetRatio: 1.3 },
  "L weight 20, dark x9, budget 1.5x": { missWeight: 20, darkFactor: 9, driveBudgetRatio: 1.5 },
  "M H, drive budget also applies to High/Must trips": { priorityBudgetRatio: 1.3 },
  "Q H, priority trips budget 1.6x": { priorityBudgetRatio: 1.6 },
  "R H, priority trips budget 2x": { priorityBudgetRatio: 2 },
  "N H, tail slope 0.1": { tailSlope: 0.1 },
  "O H, tail slope 0.05": { tailSlope: 0.05 },
  "P H, tail slope 0": { tailSlope: 0 },
};
const ONLY = process.env.ONLY?.split(",");
const VARIANTS = Object.fromEntries(Object.entries(ALL_VARIANTS).filter(([k]) => !ONLY || ONLY.includes(k[0]!)));

it("compares optimizer settings", () => {
  const cases = Array.from({ length: Number(process.env.CASES ?? 60) }, (_, i) => makeCase(10 + (i % 3) * 3));
  const date = "2026-11-10";
  const rows: string[] = [];
  for (const [name, tuning] of Object.entries(VARIANTS)) {
    const ratios: number[] = [], misses: number[] = [], back: number[] = [], hi: number[] = [], dark: number[] = [];
    for (const c of cases) {
      const base = optimizeOrder(c.durations);
      const dep = new Date(`${date}T15:00:00Z`);
      const r = optimizeSchedule({ ...c, plannedDate: date, defaultDeparture: dep, tuning });
      ratios.push(drive(c.durations, r.order) / drive(c.durations, base));
      misses.push(r.misses.reduce((s, m) => s + Math.min(m.minutes, 240), 0) / (c.stops.length - 1));
      back.push(backtracks(c.stops, r.order));
      dark.push(r.dark.reduce((s, m) => s + Math.min(m.minutes, 240), 0));
      hi.push(r.misses.filter((m) => m.priority === "high").reduce((s, m) => s + Math.min(m.minutes, 240), 0));
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    rows.push(`${name.padEnd(40)} drive ratio median ${med(ratios).toFixed(2)} mean ${mean(ratios).toFixed(2)} worst ${Math.max(...ratios).toFixed(2)} | missed light min/stop ${mean(misses).toFixed(0)} | dark min/trip ${mean(dark).toFixed(0)} | backtracks/trip ${mean(back).toFixed(2)}${process.env.MIX ? ` | High-stop missed min/trip ${mean(hi).toFixed(0)}` : ""}`);
  }
  writeFileSync(process.env.RESULT ?? "/tmp/bench-optimize.txt", rows.join("\n") + "\n");
  void DEFAULT_TUNING;
});
