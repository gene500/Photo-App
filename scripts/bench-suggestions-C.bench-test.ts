/**
 * Benchmark for suggestion loading (cold / warm / overlapping routes).
 * Local seeded SQLite test DB; the popularity source is a fake fetch with a fixed latency; Overpass is never called
 * (the seeded area is covered by the local copy). Run:
 *   npx vitest run --config scripts/bench-suggestions-C.config.mts
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import { prisma } from "@/server/db";
import { cellOf } from "@/server/suggestions/places-grid";
import { clearSuggestionCache, findSuggestions } from "@/server/suggestions/service";
import type { LngLat } from "@/lib/types";

const RUNS = 12;
const FETCH_LATENCY_MS = 25;
const KINDS = ["viewpoint", "peak", "attraction"];

// Seeded Utah/Colorado band, west to east.
const lineA = (n: number, lngEnd: number): LngLat[] =>
  Array.from({ length: n }, (_, i) => [-112.5 + ((lngEnd + 112.5) * i) / (n - 1), 38.5 + Math.sin(i / 7) * 0.15] as LngLat);
const routeA = lineA(300, -107);
const routeB = lineA(300, -107).map(([x, y]) => [x, y + 0.002] as LngLat).slice(0, 270); // overlaps A almost entirely, ends earlier, offset
const routeC = lineA(150, -109.8); // a shorter trip on the same road

let calls = 0;
const fakeFetch = (async () => {
  calls++;
  await new Promise((r) => setTimeout(r, FETCH_LATENCY_MS));
  const n = Math.floor(Math.random() * 20);
  return new Response(JSON.stringify({ query: { geosearch: Array.from({ length: n }, () => ({})) } }), { status: 200 });
}) as unknown as typeof fetch;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function time(fn: () => Promise<unknown>) {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

describe("suggestions benchmark", () => {
  beforeAll(async () => {
    await prisma.place.deleteMany({});
    const rows = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40_000; i++) {
      const lng = -112.6 + rnd() * 6, lat = 38.1 + rnd() * 0.9;
      rows.push({ id: `node/${100000 + i}`, name: i % 5 ? `Spot ${i}` : "", kind: KINDS[i % 3], lat, lng, cell: cellOf(lat, lng) });
    }
    for (let i = 0; i < rows.length; i += 5000) await prisma.place.createMany({ data: rows.slice(i, i + 5000) });
  });
  afterAll(async () => {
    await prisma.place.deleteMany({});
  });

  it("reports medians", async () => {
    const cold: number[] = [], warm: number[] = [], overlapB: number[] = [], overlapC: number[] = [], coldCalls: number[] = [], overlapCalls: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      clearSuggestionCache();
      calls = 0;
      cold.push(await time(() => findSuggestions(routeA, { fetchImpl: fakeFetch })));
      coldCalls.push(calls);
      warm.push(await time(() => findSuggestions(routeA, { fetchImpl: fakeFetch })));
      calls = 0;
      overlapB.push(await time(() => findSuggestions(routeB, { fetchImpl: fakeFetch })));
      overlapCalls.push(calls);
      overlapC.push(await time(() => findSuggestions(routeC, { fetchImpl: fakeFetch })));
    }
    const f = (x: number[]) => median(x).toFixed(1) + " ms";
    process.stderr.write(`BENCH-C median of ${RUNS}: cold=${f(cold)} warm=${f(warm)} overlapB=${f(overlapB)} overlapC=${f(overlapC)} popularityFetches(cold)=${median(coldCalls)} (overlapB)=${median(overlapCalls)}\n`);
  });
});
