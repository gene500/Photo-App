import { deepStrictEqual } from "node:assert";
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import * as bParse from "./baseline/parse";
import * as bRank from "./baseline/suggestion-rank";
import * as bGrid from "./baseline/places-grid";
import * as bFan from "./baseline/marker-fan";
import * as bLocal from "./baseline/local-pure";
import * as bDown from "./baseline/downsample";
import * as bBounds from "./baseline/map-bounds";
import * as cParse from "./cand/parse";
import * as cRank from "./cand/rank";
import * as cGrid from "./cand/grid";
import * as cMisc from "./cand/misc";
import { buildCorridorShape } from "@/server/suggestions/corridor";
import type { LngLat } from "@/lib/types";
import * as rParse from "@/server/suggestions/parse";
import * as rGrid from "@/server/suggestions/places-grid";
import * as rLocal from "@/server/suggestions/local-places";
import * as rFan from "@/lib/marker-fan";
import * as rRank from "@/lib/suggestion-rank";

const CASES = Number(process.env.CASES ?? 5000);
const REPS = Number(process.env.REPS ?? 31);

// ---------- rng ----------
function rngOf(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
  };
}
type Rng = ReturnType<typeof rngOf>;
const size = (r: Rng, big: number) => {
  const k = r.next();
  return k < 0.1 ? 0 : k < 0.2 ? 1 : k < 0.5 ? r.int(2, 12) : k < 0.85 ? r.int(13, 200) : r.int(201, big);
};

// ---------- generators ----------
const NAMES = ["Overlook", "Mount Hood", "Bench", "In memory of Bob", "Foundation Point", "Café Vista", "  spaced  ", "a\tb\nc", "‮bidi", "", "x".repeat(300), "Ünïcode Peak", "\u{1F600} emoji", "Lookout"];
const TYPES = ["node", "way", "relation", "node", "node", "Node", "ä"];
function genParse(r: Rng, maxN: number) {
  const n = size(r, maxN);
  const els: unknown[] = [];
  const cluster = r.chance(0.5);
  const base = r.chance(0.1) ? { lat: r.pick([89.9995, -89.9995, 0, 40]), lng: r.pick([179.9995, -179.9995, 0, -105]) } : { lat: r.range(-80, 80), lng: r.range(-179, 179) };
  const tight = r.pick([0.0001, 0.0005, 0.002, 0.01, 1]);
  for (let i = 0; i < n; i++) {
    const roll = r.next();
    if (roll < 0.01) { els.push(r.pick([null, undefined, 5, "x", [], {}])); continue; }
    const lat = cluster ? base.lat + r.range(-tight, tight) : r.range(-90, 90);
    const lng = cluster ? base.lng + r.range(-tight, tight) : r.range(-180, 180);
    const kind = r.next();
    const tags: Record<string, unknown> = {};
    if (kind < 0.4) tags.tourism = "viewpoint";
    else if (kind < 0.55) tags.natural = "peak";
    else if (kind < 0.9) tags.tourism = "attraction";
    else if (kind < 0.93) tags.tourism = r.pick(["museum", 5, null]);
    if (r.chance(0.6)) tags.name = r.chance(0.05) ? r.pick([5, null, true]) : r.chance(0.5) ? `${r.pick(NAMES)} ${r.int(0, 50)}` : r.pick(NAMES);
    if (r.chance(0.05)) tags.extra = 7;
    const e: Record<string, unknown> = { type: r.chance(0.02) ? r.pick([1, undefined]) : r.pick(TYPES), id: r.chance(0.03) ? r.pick(["1", undefined, NaN]) : r.chance(0.2) ? r.int(1, Math.max(2, n >> 1)) : r.int(1, 1e9), tags: r.chance(0.02) ? r.pick([null, 5, "s", []]) : tags };
    const place = r.next();
    if (place < 0.7) { e.lat = lat; e.lon = lng; }
    else if (place < 0.95) e.center = { lat, lon: lng };
    else if (place < 0.97) { e.lat = r.pick([NaN, Infinity, 91, -91, undefined, "5"]); e.lon = lng; }
    else if (place < 0.99) { e.lat = lat; e.lon = r.pick([NaN, 181, -181, 180, -180]); }
    else { e.lat = r.pick([90, -90]); e.lon = r.pick([180, -180]); }
    els.push(e);
    if (r.chance(0.08)) els.push({ ...e }); // duplicate id
  }
  const json = r.chance(0.02) ? r.pick([null, {}, { elements: 5 }, []]) : { elements: els };
  const cap = r.pick([0, 1, 3, 40, 40, 40, 100, 100000, NaN, -1, 2.5]);
  const origin = r.chance(0.4) ? undefined : r.chance(0.05) ? { lat: r.pick([NaN, Infinity]), lng: 0 } : { lat: base.lat + r.range(-0.1, 0.1), lng: base.lng + r.range(-0.1, 0.1) };
  return [json, cap, origin] as const;
}

function genRank(r: Rng, maxN: number) {
  const n = size(r, maxN);
  const kinds = ["viewpoint", "peak", "attraction"] as const;
  const pops = [undefined, 0, 1, 2, 3, 10, 100, 5000, NaN, -1, Infinity, 2.5];
  return Array.from({ length: n }, (_, i) => {
    const s: Record<string, unknown> = { osmId: `node/${i}`, name: "n", lat: 0, lng: 0, kind: r.pick(kinds) };
    if (r.chance(0.8)) s.popularity = r.pick(pops);
    if (r.chance(0.8)) s.notable = r.pick([true, false, undefined]);
    return s as never;
  });
}

function wobblyCorridor(r: Rng, n: number, width: number) {
  const lng0 = r.pick([r.range(-125, -70), 179.5, -179.9, 0]);
  const lat0 = r.pick([r.range(-60, 60), 89.5, -89.9, 40]);
  const stepLng = r.range(0.02, 0.4);
  const mid: LngLat[] = [];
  let lat = lat0;
  for (let i = 0; i < n; i++) { lat += r.range(-0.15, 0.15); mid.push([lng0 + i * stepLng * (r.chance(0.5) ? 1 : 0.7), lat]); }
  const top = mid.map(([x, y]) => [x, y + width] as LngLat);
  const bot = mid.map(([x, y]) => [x, y - width] as LngLat).reverse();
  return [...top, ...bot, top[0]];
}
function genRing(r: Rng, maxN: number): { ring: LngLat[]; holes: LngLat[][] } {
  const k = r.next();
  if (k < 0.05) return { ring: [], holes: [] };
  if (k < 0.1) return { ring: Array.from({ length: r.int(1, 2) }, () => [r.range(-180, 180), r.range(-90, 90)] as LngLat), holes: [] };
  if (k < 0.2) { const ring = Array.from({ length: r.int(3, 8) }, () => [r.range(-130, -60), r.range(25, 50)] as LngLat); return { ring, holes: [] }; }
  const n = Math.max(2, Math.min(maxN, size(r, maxN)));
  const ring = wobblyCorridor(r, n, r.pick([0.01, 0.02, 0.08]));
  const holes: LngLat[][] = [];
  if (r.chance(0.3)) {
    const cx = ring[Math.floor(ring.length / 4)][0], cy = ring[Math.floor(ring.length / 4)][1];
    holes.push([[cx, cy], [cx + 0.1, cy], [cx + 0.1, cy + 0.1], [cx, cy + 0.1], [cx, cy]]);
  }
  if (r.chance(0.03)) ring[r.int(0, ring.length - 1)] = [NaN, r.range(0, 10)];
  return { ring, holes };
}

function genRows(r: Rng, maxN: number) {
  const n = size(r, maxN);
  const kinds = ["viewpoint", "peak", "attraction", "viewpoint", "peak", "toString", "constructor", "", "bogus"];
  return Array.from({ length: n }, (_, i) => ({
    id: r.pick([`node/${r.int(1, 1e9)}`, `way/${i}`, `relation/${i}/x`, "node/abc", "node/", "/5", "nope", "node/1e3", "node/ 7", "node/-3", "n/0x10"]),
    name: r.pick(["", "Name", "A b", "x".repeat(50)]),
    kind: r.pick(kinds),
    lat: r.range(-90, 90),
    lng: r.range(-180, 180),
  }));
}

function genFan(r: Rng, maxN: number) {
  const n = size(r, maxN);
  const spread = r.pick([10, 60, 400, 1500]);
  const grid = r.chance(0.2);
  const pts = Array.from({ length: n }, (_, i) => ({
    id: r.chance(0.05) ? `p${r.int(0, 5)}` : `p${i}`,
    x: grid ? r.int(0, 20) * 16 : r.range(0, spread),
    y: grid ? r.int(0, 20) * 16 : r.range(0, spread),
  }));
  if (r.chance(0.05) && n) pts[r.int(0, n - 1)].x = r.pick([NaN, Infinity, -0]);
  const minDist = r.pick([32, 32, 32, 16, 1, 0, 100, 0.5, NaN, -5]);
  return [pts, minDist] as const;
}

// ---------- harness ----------
type Result = { algo: string; strategy: string; cases: number; mismatches: number; sizes: { label: string; ratio: number; baseMs: number; candMs: number }[] };
const results: Result[] = [];
const notes: string[] = [];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function equiv<I>(label: string, gen: (r: Rng) => I, base: (i: I) => unknown, cands: Record<string, (i: I) => unknown>) {
  const mism: Record<string, number> = {};
  const rng = rngOf(label.length * 7919 + 13);
  for (const k of Object.keys(cands)) mism[k] = 0;
  for (let c = 0; c < CASES; c++) {
    const input = gen(rng);
    let want: unknown, wantErr: string | null = null;
    try { want = base(structuredCloneSafe(input)); } catch (e) { wantErr = String((e as Error).name); }
    for (const [k, fn] of Object.entries(cands)) {
      try {
        const got = fn(structuredCloneSafe(input));
        if (wantErr) { if (mism[k]++ === 0 && process.env.SHOW) notes.push([label, k, "base threw, cand did not:", JSON.stringify(input).slice(0, 300)].join(" ")); continue; }
        deepStrictEqual(got, want);
      } catch (e) {
        if (!(wantErr && String((e as Error).name) === wantErr)) { if (mism[k]++ === 0 && process.env.SHOW) notes.push([label, k, "first mismatch input:", JSON.stringify(input).slice(0, 300)].join(" ")); }
      }
    }
  }
  return mism;
}
const structuredCloneSafe = <T,>(x: T): T => x; // inputs are never mutated by either side; cloning would mask aliasing bugs

function timeIt<I>(inputs: I[], reps: number, fns: Record<string, (i: I) => unknown>, inner: number) {
  const names = Object.keys(fns);
  const times: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
  const run = (fn: (i: I) => unknown) => { const t = performance.now(); for (let k = 0; k < inner; k++) for (const i of inputs) fn(i); return (performance.now() - t) / inner; };
  for (let w = 0; w < 4; w++) for (const n of names) run(fns[n]);
  for (let rep = 0; rep < reps; rep++) {
    const order = names.map((_, i) => names[(i + rep) % names.length]);
    for (const n of order) times[n].push(run(fns[n]));
  }
  return times;
}

function record<I>(algo: string, equivMism: Record<string, number>, sizesSpec: { label: string; inputs: I[]; inner?: number }[], base: (i: I) => unknown, cands: Record<string, (i: I) => unknown>) {
  const per: Record<string, Result> = {};
  for (const k of Object.keys(cands)) { per[k] = { algo, strategy: k, cases: CASES, mismatches: equivMism[k], sizes: [] }; results.push(per[k]); }
  for (const spec of sizesSpec) {
    const times = timeIt(spec.inputs, REPS, { base, ...cands }, spec.inner ?? 1);
    for (const k of Object.keys(cands)) {
      const ratios = times.base.map((b, i) => times[k][i] / b);
      per[k].sizes.push({ label: spec.label, ratio: median(ratios), baseMs: median(times.base), candMs: median(times[k]) });
    }
  }
}

const many = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
const fixedRng = (s: number) => rngOf(s);

it("profile + equivalence + timing", () => {
  // ----- profile of the baseline code on realistic inputs -----
  const prof: { fn: string; input: string; ms: number }[] = [];
  const t = (fn: string, input: string, f: () => unknown, inner = 5) => { for (let w = 0; w < 3; w++) f(); const xs: number[] = []; for (let i = 0; i < 15; i++) { const s = performance.now(); for (let k = 0; k < inner; k++) f(); xs.push((performance.now() - s) / inner); } prof.push({ fn, input, ms: median(xs) }); };
  const R = fixedRng(5);
  const route: LngLat[] = many(4000, (i) => [-120 + i * 0.011, 38 + Math.sin(i / 40) * 1.5] as LngLat);
  t("buildCorridorShape (turf; not rewritten)", "4000 pts cross-country", () => buildCorridorShape(route), 1);
  const shape = buildCorridorShape(route);
  const bigRing = shape.outer;
  t("cellsForRing", `corridor ring ${bigRing.length} pts`, () => bGrid.cellsForRing(bigRing, shape.holes));
  const cellsBig = bGrid.cellsForRing(bigRing, shape.holes);
  t("cellRuns", `${cellsBig.length} cells`, () => bGrid.cellRuns(cellsBig));
  const rowsBig = many(8000, (i) => ({ id: `node/${i}`, name: "N", kind: "viewpoint", lat: 38 + R.range(-1.5, 1.5), lng: -120 + R.range(0, 44) }));
  t("createRingTester + 8000 queries", "corridor", () => { const f = bGrid.createRingTester(bigRing, shape.holes); return rowsBig.filter((r) => f(r.lng, r.lat)); });
  t("cellsForCircle", "24 km at 40N", () => bGrid.cellsForCircle(40, -105, 24), 200);
  t("toElements", "8000 rows", () => bLocal.toElements(rowsBig));
  t("filterCircle (haversine rows)", "8000 rows", () => bLocal.filterCircle(rowsBig, 38, -110, 24));
  const gp = genParse(fixedRng(77), 3000);
  const bigJson = { elements: many(3000, (i) => ({ type: "node", id: i, lat: 38 + R.range(-1, 1), lon: -110 + R.range(-1, 1), tags: { tourism: "viewpoint", name: `Spot ${i}`, a: "b", c: "d" } })) };
  void gp;
  t("parseOverpassResponse (no origin)", "3000 elements", () => bParse.parseOverpassResponse(bigJson));
  t("parseOverpassResponse (origin)", "3000 elements", () => bParse.parseOverpassResponse(bigJson, 40, { lat: 38, lng: -110 }));
  const sug = genRank(fixedRng(3), 400).slice(0, 300);
  t("rankByScore", "300 suggestions", () => bRank.rankByScore(sug), 50);
  const fanPts = many(500, (i) => ({ id: `p${i}`, x: R.range(0, 1200), y: R.range(0, 800) }));
  t("fanOffsets", "500 markers", () => bFan.fanOffsets(fanPts));
  const longRoute = route;
  t("downsampleRoute", "4000 pts", () => bDown.downsampleRoute(longRoute), 200);
  const fitPts = many(2000, () => [R.range(-180, 180), R.range(-90, 90)] as [number, number]);
  t("unwrapForFit", "2000 pts", () => bBounds.unwrapForFit(fitPts));

  // ----- parse -----
  {
    const eq = equiv("parse", (r) => genParse(r, 3000), (i) => bParse.parseOverpassResponse(...i), { A: (i) => cParse.parseA(...i), B: (i) => cParse.parseB(...i), C: (i) => cParse.parseC(...i), D: (i) => cParse.parseD(...i), REAL: (i) => rParse.parseOverpassResponse(...i) });
    const mk = (n: number, origin: boolean) => { const r = fixedRng(n + (origin ? 1 : 0)); return [{ elements: many(n, (i) => ({ type: "node", id: i + 1, lat: 38 + r.range(-1, 1), lon: -110 + r.range(-1, 1), tags: { tourism: r.pick(["viewpoint", "attraction", "viewpoint"]), name: r.chance(0.7) ? `Spot ${i}` : undefined, source: "x" } })) }, 40, origin ? { lat: 38, lng: -110 } : undefined] as const; };
    record("parseOverpassResponse", eq, [
      { label: "20 el", inputs: [mk(20, false), mk(20, true)], inner: 200 },
      { label: "500 el", inputs: [mk(500, false), mk(500, true)], inner: 4 },
      { label: "3000 el", inputs: [mk(3000, false), mk(3000, true)] },
    ], (i) => bParse.parseOverpassResponse(...i), { A: (i) => cParse.parseA(...i), B: (i) => cParse.parseB(...i), C: (i) => cParse.parseC(...i), D: (i) => cParse.parseD(...i), REAL: (i) => rParse.parseOverpassResponse(...i) });
  }
  // ----- rank -----
  {
    const c = { A: cRank.rankA, B: cRank.rankB, C: cRank.rankC, REAL: rRank.rankByScore };
    const eq = equiv("rank", (r) => genRank(r, 800), bRank.rankByScore, c);
    record("rankByScore", eq, [
      { label: "10", inputs: [genRank(fixedRng(1), 12).concat(genRank(fixedRng(2), 12)).slice(0, 10)], inner: 2000 },
      { label: "300", inputs: [genRank(fixedRng(3), 400).slice(0, 300)], inner: 20 },
      { label: "5000", inputs: [many(5000, (i) => ({ osmId: `n/${i}`, name: "n", lat: 0, lng: 0, kind: "peak" as const, popularity: i % 97, notable: i % 5 === 0 }))] },
    ], bRank.rankByScore, c);
  }
  // ----- circle -----
  {
    const c = { A: (i: number[]) => cGrid.circleA(i[0], i[1], i[2]), B: (i: number[]) => cGrid.circleB(i[0], i[1], i[2]), C: (i: number[]) => cGrid.circleC(i[0], i[1], i[2]) };
    const eq = equiv("circle", (r) => [r.chance(0.2) ? r.pick([90, -90, 89.99, -89.7, 0]) : r.range(-90, 90), r.chance(0.2) ? r.pick([180, -180, 179.99, -179.95, 0]) : r.range(-180, 180), r.pick([0, 0.001, 0.5, 5, 24, 24, 100, 500, -1, NaN]) * (r.chance(0.5) ? 1 : r.next())], (i) => bGrid.cellsForCircle(i[0], i[1], i[2]), c);
    record("cellsForCircle", eq, [
      { label: "5 km", inputs: [[40, -105, 5], [10, 100, 5]], inner: 300 },
      { label: "24 km", inputs: [[40, -105, 24], [64, -150, 24], [0, 179.9, 24]], inner: 100 },
      { label: "300 km", inputs: [[40, -105, 300]], inner: 3 },
    ], (i) => bGrid.cellsForCircle(i[0], i[1], i[2]), c);
  }
  // ----- runs -----
  {
    const c = { A: cGrid.runsA, B: cGrid.runsB, C: cGrid.runsC, REAL: rGrid.cellRuns };
    const eq = equiv("runs", (r) => { const n = size(r, 5000); const spread = r.pick([5, 100, 100000, 18_000_000]); return many(n, () => r.int(0, spread) + (r.chance(0.3) ? 0 : r.pick([0, 10000, 20000]))); }, bGrid.cellRuns, c);
    const mk = (n: number, seed: number) => { const r = fixedRng(seed); return many(n, () => r.int(1000, 1050) * 10000 + r.int(0, 3600)); };
    record("cellRuns", eq, [
      { label: "30 cells", inputs: [mk(30, 1)], inner: 500 },
      { label: "3000 cells", inputs: [mk(3000, 2)], inner: 10 },
      { label: "20000 cells", inputs: [mk(20000, 3)] },
    ], bGrid.cellRuns, c);
  }
  // ----- ring -----
  {
    const c = { A: (i: { ring: LngLat[]; holes: LngLat[][] }) => cGrid.ringA(i.ring, i.holes), B: (i: { ring: LngLat[]; holes: LngLat[][] }) => cGrid.ringB(i.ring, i.holes), C: (i: { ring: LngLat[]; holes: LngLat[][] }) => cGrid.ringC(i.ring, i.holes), REAL: (i: { ring: LngLat[]; holes: LngLat[][] }) => rGrid.cellsForRing(i.ring, i.holes) };
    const eq = equiv("ring", (r) => genRing(r, 300), (i) => bGrid.cellsForRing(i.ring, i.holes), c);
    const mk = (n: number, seed: number) => { const r = fixedRng(seed); return { ring: wobblyCorridor(r, n, 0.02).map(([x, y]) => [Math.min(170, x), y] as LngLat), holes: [] as LngLat[][] }; };
    record("cellsForRing", eq, [
      { label: "ring 10 pts", inputs: [mk(5, 1)], inner: 200 },
      { label: "short 80 pts", inputs: [mk(40, 2)], inner: 20 },
      { label: "corridor shape", inputs: [{ ring: bigRing, holes: shape.holes }] },
    ], (i) => bGrid.cellsForRing(i.ring, i.holes), c);
  }
  // ----- tester -----
  {
    type TI = { ring: LngLat[]; holes: LngLat[][]; pts: [number, number][] };
    const gen = (r: Rng): TI => {
      const { ring, holes } = genRing(r, 300);
      const xs = ring.map((p) => p[0]).filter(Number.isFinite), ys = ring.map((p) => p[1]).filter(Number.isFinite);
      const lo = xs.length ? Math.min(...xs) : 0, hi = xs.length ? Math.max(...xs) : 1, ylo = ys.length ? Math.min(...ys) : 0, yhi = ys.length ? Math.max(...ys) : 1;
      const pts = many(r.int(0, 60), () => (r.chance(0.2) && ring.length ? [ring[r.int(0, ring.length - 1)][0], ring[r.int(0, ring.length - 1)][1]] : [r.range(lo - 0.5, hi + 0.5), r.range(ylo - 0.5, yhi + 0.5)]) as [number, number]);
      return { ring, holes, pts };
    };
    const run = (mk: (ring: LngLat[], holes: LngLat[][]) => (x: number, y: number) => boolean) => (i: TI) => { const f = mk(i.ring, i.holes); return i.pts.map(([x, y]) => f(x, y)); };
    const c = { A: run(cGrid.testerA), B: run(cGrid.testerB), C: run(cGrid.testerC), REAL: run(rGrid.createRingTester) };
    const eq = equiv("tester", gen, run(bGrid.createRingTester), c);
    const mk = (n: number, q: number, seed: number): TI => { const r = fixedRng(seed); const ring = wobblyCorridor(r, n, 0.02).map(([x, y]) => [Math.min(170, x), y] as LngLat); const xs = ring.map((p) => p[0]); const lo = Math.min(...xs), hi = Math.max(...xs); return { ring, holes: [], pts: many(q, () => [r.range(lo, hi), 38 + r.range(-6, 6)] as [number, number]) }; };
    record("createRingTester", eq, [
      { label: "10 pts x 5 queries", inputs: [mk(5, 5, 1)], inner: 500 },
      { label: "30 pts x 100 q", inputs: [mk(15, 100, 4)], inner: 50 },
      { label: "60 pts x 100 q", inputs: [mk(30, 100, 5)], inner: 50 },
      { label: "100 pts x 500 q", inputs: [mk(50, 500, 2)], inner: 5 },
      { label: "corridor x 8000 q", inputs: [{ ring: bigRing, holes: shape.holes, pts: rowsBig.map((x) => [x.lng, x.lat] as [number, number]) }] },
    ], run(bGrid.createRingTester), c);
  }
  // ----- fan -----
  {
    const c = { A: (i: readonly [{ id: string; x: number; y: number }[], number]) => cMisc.fanA(...i), B: (i: readonly [{ id: string; x: number; y: number }[], number]) => cMisc.fanB(...i), C: (i: readonly [{ id: string; x: number; y: number }[], number]) => cMisc.fanC(...i) };
    const c2 = { ...c, REAL: (i: readonly [{ id: string; x: number; y: number }[], number]) => rFan.fanOffsets(i[0], i[1]) };
    const eq = equiv("fan", (r) => genFan(r, 400), (i) => [...bFan.fanOffsets(i[0], i[1])], Object.fromEntries(Object.entries(c2).map(([k, f]) => [k, (i: readonly [{ id: string; x: number; y: number }[], number]) => [...f(i)]])));
    const mk = (n: number, w: number, h: number, seed: number) => { const r = fixedRng(seed); return [many(n, (i) => ({ id: `p${i}`, x: r.range(0, w), y: r.range(0, h) })), 32] as const; };
    record("fanOffsets", eq, [
      { label: "20 markers", inputs: [mk(20, 800, 600, 1)], inner: 500 },
      { label: "200 markers", inputs: [mk(200, 1200, 800, 2)], inner: 10 },
      { label: "2000 markers", inputs: [mk(2000, 1200, 800, 3)] },
    ], (i) => bFan.fanOffsets(i[0], i[1]), c2);
  }
  // ----- toElements -----
  {
    const c = { A: cMisc.elemsA, B: cMisc.elemsB, C: cMisc.elemsC, REAL: rLocal.toElements };
    const eq = equiv("elems", (r) => genRows(r, 2000), bLocal.toElements, c);
    const mk = (n: number, seed: number) => { const r = fixedRng(seed); return many(n, (i) => ({ id: `${r.pick(["node", "way"])}/${r.int(1, 1e9)}`, name: i % 3 ? "Name" : "", kind: r.pick(["viewpoint", "peak", "attraction"]), lat: r.range(30, 40), lng: r.range(-120, -100) })); };
    record("toElements", eq, [
      { label: "20 rows", inputs: [mk(20, 1)], inner: 500 },
      { label: "2000 rows", inputs: [mk(2000, 2)], inner: 5 },
      { label: "20000 rows", inputs: [mk(20000, 3)] },
    ], bLocal.toElements, c);
  }
  writeFileSync(process.env.OUT ?? "/tmp/perf-b-results.json", JSON.stringify({ prof, results, notes }, null, 1));
  console.log("PROFILE\n" + prof.map((p) => `${p.fn} | ${p.input} | ${p.ms.toFixed(3)} ms`).join("\n"));
  console.log("RESULTS\n" + results.map((x) => `${x.algo} ${x.strategy}: mismatches ${x.mismatches}/${x.cases}; ` + x.sizes.map((s) => `${s.label}: ${s.ratio.toFixed(2)}x (${s.baseMs.toFixed(3)}->${s.candMs.toFixed(3)}ms)`).join("; ")).join("\n"));
});
