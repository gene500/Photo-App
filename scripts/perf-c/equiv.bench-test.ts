import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { findHikePath as base } from "./baseline/graph";
import { findHikePath as c1 } from "./cand/graph-c1";
import { findHikePath as c2 } from "./cand/graph-c2";
import { findHikePath as c3 } from "./cand/graph-c3";
import { findHikePath as real } from "@/server/hike/graph";
import { estimateLegDurations as realLegs } from "@/lib/straight-line";
import { estimateLegDurations } from "./baseline/straight-line";
import { diffIds } from "./baseline/diff-ids";
import { routeSignature } from "./baseline/route-signature";
import { legsE1, legsE2, legsE3, diffD1, diffD2, diffD3, sigR1, sigR2 } from "./cand/misc";

// deterministic PRNG
let seed = 12345;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n: number) => Math.floor(rnd() * n);
const bits = (v: unknown): string => JSON.stringify(v, (_, x) => (typeof x === "number" ? (Object.is(x, -0) ? "-0" : Number.isNaN(x) ? "NaN" : !Number.isFinite(x) ? String(x) : x) : x));
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b) && bits(a) === bits(b);
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;

type LL = [number, number];
function genHike(kind: "small" | "medium" | "large") {
  const centres: [number, number][] = [[-119.5, 37.7], [179.9995, 0.5], [-179.9998, -10], [10, 89.95], [0, 0], [100, -89.9]];
  const [lng0, lat0] = centres[ri(centres.length)]!;
  const lattice = rnd() < 0.35; // integer-metre lattice => many equal weights / ties
  const M = 1 / 111_320;
  const cosl = Math.max(1e-6, Math.cos((lat0 * Math.PI) / 180));
  const pt = (x: number, y: number): LL => {
    let lng = lng0 + x * M / cosl; if (lng > 180) lng -= 360; if (lng < -180) lng += 360;
    return [lng, lat0 + y * M];
  };
  const nSeg = kind === "small" ? ri(6) : kind === "medium" ? 5 + ri(40) : 60 + ri(120);
  const segLen = kind === "large" ? 20 + ri(120) : 2 + ri(25);
  const R = kind === "small" ? 400 : 3000;
  const step = lattice ? 50 : 20 + rnd() * 60;
  const segments: LL[][] = [];
  const shared: [number, number][] = [];
  for (let s = 0; s < nSeg; s++) {
    let x = rnd() < 0.4 && shared.length ? shared[ri(shared.length)]![0] : (lattice ? ri(Math.floor(R / 50)) * 50 : (rnd() - 0.5) * R) - 0;
    let y = shared.length && rnd() < 0.4 ? shared[ri(shared.length)]![1] : (lattice ? ri(Math.floor(R / 50)) * 50 : (rnd() - 0.5) * R);
    const seg: LL[] = [];
    const n = rnd() < 0.05 ? ri(2) : 2 + ri(segLen);
    let dir = rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      seg.push(pt(x, y));
      if (rnd() < 0.1) shared.push([x, y]);
      if (lattice) { const d = ri(4); x += [50, -50, 0, 0][d]!; y += [0, 0, 50, -50][d]!; }
      else { dir += (rnd() - 0.5) * 1.2; x += Math.cos(dir) * step; y += Math.sin(dir) * step; if (rnd() < 0.02) { x += (rnd() - 0.5) * 12; } }
    }
    if (rnd() < 0.15 && seg.length > 1) seg.push(seg[0]!); // loop
    if (rnd() < 0.05 && seg.length) seg.push(seg[seg.length - 1]!); // duplicate point
    segments.push(seg);
  }
  if (rnd() < 0.02 && segments.length) segments[0]![0] = [NaN, 1];
  if (rnd() < 0.01 && segments.length) segments[0]![0] = [Infinity, 1];
  const poi = { lat: lat0 + ((rnd() - 0.5) * R * M) * 0.5, lng: lng0 };
  const tiers: LL[][] = [];
  const nt = ri(3);
  for (let t = 0; t < nt; t++) { const tier: LL[] = []; for (let i = 0, m = ri(5); i < m; i++) tier.push(pt((rnd() - 0.5) * R, (rnd() - 0.5) * R)); tiers.push(tier); }
  const opts: Record<string, unknown> = { trailheadTiers: tiers };
  if (rnd() < 0.2) opts.maxM = [200, 1000, 100000][ri(3)];
  if (rnd() < 0.1) opts.minM = [0, 50, 1000][ri(3)];
  if (rnd() < 0.1) opts.snapPoiM = [5, 50, 5000][ri(3)];
  if (rnd() < 0.05) opts.joinM = [1, 20][ri(2)];
  return { segments, poi, opts };
}
const strip = (a: any) => a;

it("equivalence + timing", { timeout: 900_000 }, () => {
  const out: string[] = [];
  const log = (s: string) => { out.push(s); console.log(s); };
  const hikeCands: Record<string, typeof base> = { c1, c2, c3, real };
  // --- hike equivalence ---
  const N = Number(process.env.N ?? 6000);
  const mism: Record<string, number> = { c1: 0, c2: 0, c3: 0, real: 0 };
  let nonNull = 0;
  const corpus: ReturnType<typeof genHike>[] = [];
  for (let i = 0; i < N; i++) {
    const kind = i % 10 < 6 ? "small" : i % 10 < 9 ? "medium" : "large";
    const c = genHike(kind); corpus.push(c);
    const b = base(c.segments, c.poi, c.opts as any);
    if (b) nonNull++;
    for (const k of Object.keys(hikeCands)) { let r; try { r = hikeCands[k]!(c.segments, c.poi, c.opts as any); } catch (e) { r = "THROW"; } if (!same(b, r)) mism[k]!++; }
  }
  log(`hike corpus ${N} cases (${nonNull} non-null results); mismatches ${JSON.stringify(mism)}`);
  // --- hike timing (interleaved) on realistic larger inputs ---
  for (const kind of ["small", "medium", "large"] as const) {
    const set = Array.from({ length: 40 }, () => genHike(kind));
    const tb: number[] = [], tc: Record<string, number[]> = { c1: [], c2: [], c3: [], real: [] };
    for (let rep = 0; rep < 12; rep++) {
      const tm = (f: typeof base) => { const t = performance.now(); for (const c of set) f(c.segments, c.poi, c.opts as any); return performance.now() - t; };
      const b = tm(base);
      if (rep >= 2) { tb.push(b); for (const k of Object.keys(hikeCands)) tc[k]!.push(tm(hikeCands[k]!)); }
      else for (const k of Object.keys(hikeCands)) tm(hikeCands[k]!);
    }
    const mb = median(tb);
    log(`hike ${kind} (40 cases/rep): baseline median ${mb.toFixed(2)}ms; ` + Object.keys(tc).map((k) => `${k} ${median(tc[k]!).toFixed(2)}ms ratio ${(median(tc[k]!) / mb).toFixed(3)}`).join("; "));
  }
  // --- small helpers ---
  const mkStops = (n: number) => Array.from({ length: n }, () => {
    const r = rnd();
    const lat = r < 0.05 ? NaN : r < 0.1 ? 90 : r < 0.15 ? -90 : (rnd() - 0.5) * 180;
    const lng = rnd() < 0.1 ? 180 * (rnd() < 0.5 ? 1 : -1) : (rnd() - 0.5) * 400;
    return { lat, lng, id: "s" + ri(1e6), lightPref: ["any", "sunrise", "sunset"][ri(3)]!, priority: ["normal", "high"][ri(2)]!, dwellMinutes: ri(240) };
  });
  const sizes = [0, 1, 2, 3, 30, 200, 2000];
  const helper = (name: string, base_: (x: any) => unknown, cands: Record<string, (x: any) => unknown>, gen: (n: number) => unknown, timeSize: number) => {
    const mm: Record<string, number> = Object.fromEntries(Object.keys(cands).map((k) => [k, 0]));
    let cases = 0;
    for (let i = 0; i < 6000; i++) { const x = gen(sizes[ri(sizes.length)]!); cases++; const b = base_(x); for (const k of Object.keys(cands)) if (!same(b, cands[k]!(x))) mm[k]!++; }
    for (const sz of [timeSize, 3]) {
      const xs = Array.from({ length: sz === 3 ? 200 : 20 }, () => gen(sz));
      const tb: number[] = [], tc: Record<string, number[]> = Object.fromEntries(Object.keys(cands).map((k) => [k, []]));
      const run = (f: (x: any) => unknown) => { const reps = sz === 3 ? 50 : 1; const t = performance.now(); for (let r = 0; r < reps; r++) for (const x of xs) f(x); return performance.now() - t; };
      for (let rep = 0; rep < 25; rep++) { const b = run(base_); const cs = Object.keys(cands).map((k) => run(cands[k]!)); if (rep >= 5) { tb.push(b); Object.keys(cands).forEach((k, i) => tc[k]!.push(cs[i]!)); } }
      const mb = median(tb);
      log(`${name} size ${sz}: identical on ${cases} cases, mismatches ${JSON.stringify(mm)}; baseline ${mb.toFixed(3)}ms; ` + Object.keys(cands).map((k) => `${k} ${median(tc[k]!).toFixed(3)}ms ratio ${(median(tc[k]!) / mb).toFixed(3)}`).join("; "));
    }
  };
  helper("estimateLegDurations", estimateLegDurations, { real: realLegs, E1: legsE1, E2: legsE2, E3: legsE3 }, (n) => mkStops(n), 200);
  helper("diffIds", ([p, n]: any) => diffIds(p, n), { D1: ([p, n]: any) => diffD1(p, n), D2: ([p, n]: any) => diffD2(p, n), D3: ([p, n]: any) => diffD3(p, n) },
    (n) => { const pool = Array.from({ length: n * 2 + 2 }, (_, i) => "id" + i); const pick = () => pool.filter(() => rnd() < 0.5); const next = pick(); if (n && rnd() < 0.2) next.push(next[0] ?? "x"); return [new Set(pick()), next]; }, 2000);
  helper("routeSignature", ([d, s]: any) => routeSignature(d, s), { R1: ([d, s]: any) => sigR1(d, s), R2: ([d, s]: any) => sigR2(d, s) },
    (n) => ["2026-11-11", mkStops(n).map((s) => ({ ...s, lat: Number.isNaN(s.lat) ? 1.5 : s.lat }))] as unknown, 200);
  void strip;
  writeFileSync(process.env.RESULT ?? "scripts/perf-c/results.txt", out.join("\n") + "\n");
});
