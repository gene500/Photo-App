/* Equivalence + timing of optimizer strategies against the frozen baseline (scripts/perf/baseline).
 * A strategy is only adoptable if it returns exactly what the baseline returns on every corpus case. */
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { exact as baseExact, heuristic as baseHeur, optimizeOrder as baseOrder } from "./perf/baseline/optimize-order.baseline";
import { optimizeSchedule as baseSchedule } from "./perf/baseline/optimize-schedule.baseline";
import { optimizeOrder as srcOrder } from "@/lib/optimize-order";
import { optimizeSchedule as srcSchedule } from "@/lib/optimize-schedule";
import { build, E1, E2, E3, heuristicH1, heuristicH2, heuristicH3 } from "./perf/cand/optimize-order.cand";
import { orderCases, scheduleCases, rng, makeLayout, makeDurations } from "./perf/corpus";

const STAGE = process.env.STAGE ?? "order";
const CASES = Number(process.env.CASES ?? 5000);
const REPS = Number(process.env.REPS ?? 20);
const SIZES = (process.env.SIZES ?? "4,8,12,13,20,30,40").split(",").map(Number);
const SEED = Number(process.env.SEED ?? 0);
const ONLY = process.env.CANDS?.split(",");
const TIME = process.env.TIME !== "0";
const RESULT = process.env.RESULT ?? `/tmp/bench-optimize-equiv-${STAGE}.txt`;

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))]!;

type Fn<I> = (input: I) => unknown;
function run<I>(name: string, baseline: Fn<I>, allCands: Record<string, Fn<I>>, corpus: I[], timed: (n: number) => I[]) {
  const cands = Object.fromEntries(Object.entries(allCands).filter(([k]) => !ONLY || ONLY.some((o) => k.startsWith(o))));
  const lines: string[] = [];
  const log = (s: string) => { lines.push(s); console.log(s); };
  log(`## ${name}: equivalence on ${corpus.length} cases`);
  const mism: Record<string, number> = Object.fromEntries(Object.keys(cands).map((k) => [k, 0]));
  const firstBad: Record<string, number> = {};
  corpus.forEach((c, idx) => {
    const ref = JSON.stringify(baseline(c));
    for (const [k, f] of Object.entries(cands)) {
      if (JSON.stringify(f(c)) !== ref) { mism[k]!++; firstBad[k] ??= idx; }
    }
  });
  for (const k of Object.keys(cands)) log(`${k}: mismatches ${mism[k]} / ${corpus.length}${firstBad[k] !== undefined ? ` (first at case ${firstBad[k]})` : ""}`);
  if (!TIME) { writeFileSync(RESULT, lines.join("\n") + "\n"); return; }
  log(`## ${name}: timing, ms per call (median / p95), ${REPS} reps x cases, interleaved`);
  const all: Record<string, Fn<I>> = { baseline, ...cands };
  for (const n of SIZES) {
    const inputs = timed(n);
    const warm = n <= 13 ? 40 : 2;
    for (let w = 0; w < warm; w++) for (const f of Object.values(all)) for (const c of inputs.slice(0, 2)) f(c); // warm up (small sizes need many calls before the JIT settles)
    const samples: Record<string, number[]> = Object.fromEntries(Object.keys(all).map((k) => [k, []]));
    for (let r = 0; r < REPS; r++) {
      for (const c of inputs) {
        for (const [k, f] of Object.entries(all)) {
          const t0 = performance.now();
          f(c);
          samples[k]!.push(performance.now() - t0);
        }
      }
    }
    const b = median(samples.baseline!);
    log(`n=${String(n).padStart(2)}  ` + Object.entries(samples).map(([k, s]) => `${k} ${median(s).toFixed(4)}/${p95(s).toFixed(4)}${k === "baseline" ? "" : ` (${((median(s) / b) * 100).toFixed(0)}%)`}`).join("  "));
  }
  writeFileSync(RESULT, lines.join("\n") + "\n");
}

const timedOrder = (n: number) => { const g = rng(1000 + n); return Array.from({ length: Number(process.env.TIMED_CASES ?? 5) }, () => makeDurations(g, makeLayout(g, n))); };

it(`optimizer ${STAGE}`, async () => {
  if (STAGE === "order") {
    const cands: Record<string, Fn<number[][]>> = {
      "E1 flat": build(E1, baseHeur), "E2 bits": build(E2, baseHeur), "E3 pull": build(E3, baseHeur),
      "H1 scratch": build(baseExact, heuristicH1), "H2 prefix+abort": build(baseExact, heuristicH2), "H3 prefix": build(baseExact, heuristicH3),
      "SRC (src/lib)": srcOrder,
      "E3+H2": build(E3, heuristicH2), "E3+H3": build(E3, heuristicH3),
    };
    run("optimize-order", baseOrder, cands, orderCases(CASES, 20261111 + SEED), timedOrder);
  } else {
    const mod = await import("./perf/cand/optimize-schedule.cand");
    const cands = { ...mod.candidates, "SRC (src/lib)": srcSchedule } as Record<string, Fn<ReturnType<typeof scheduleCases>[number]>>;
    const timed = (n: number) => scheduleCases(Number(process.env.TIMED_CASES ?? 3), 5000 + n, n, n);
    run("optimize-schedule", baseSchedule as Fn<ReturnType<typeof scheduleCases>[number]>, cands, scheduleCases(CASES, 777 + SEED), timed);
  }
});
