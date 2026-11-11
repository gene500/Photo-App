# Performance log

Measured 2026-11-11 on the owner's Mac (8 cores). Behavior-neutral changes only.

## A78 baselines (before)
- Client JS for `/trips/[id]` page chunks: about 292 KB raw, 100 KB gzip. Mapbox GL (1.8 MB raw, 520 KB gzip) and jsPDF (409 KB raw) are both already lazy (`next/dynamic` and `await import`), so no bundle change was needed. No zod in client chunks.
- vitest full run: 216 files, 2282 tests, about 220 s wall (sum of test time 142 s; the rest was per-file environment setup, run one file at a time). Slowest files: TripEditor.test.tsx 42 s, optimize-schedule.test.ts 38 s, TripEditor.auto-optimize 9 s, SearchBar 9 s.
- CI run (check + e2e in parallel jobs): about 6.5 min total; e2e is about 6 min. Sharding e2e would save little after runner setup, so it was not done.

## A81 result
`vitest.config.mts` now has two projects: `db-and-server` (everything outside `src/components` and `src/lib`; one file at a time because the tests share one SQLite file) and `no-database` (`src/components`, `src/lib`; run in parallel). Same 216 files, 2282 tests, all pass, three runs: 151 s, 96 s, 97 s (CI=1) wall, down from about 220 s. A later run under load took 108 s.

## A79
Removed the never-used `quiet` argument of `addStop` and `saveFirstStart` (TripEditor) and six unused re-exports from `src/lib/validation.ts`. knip's other findings are false positives (scripts, `public/sw.js`, `@prisma/client` used by the generated client) or are used by `scripts/bench-optimize.ts`.

## A82a optimizer

Goal: faster `src/lib/optimize-order.ts` and `src/lib/optimize-schedule.ts` with byte-identical output. The frozen baseline copies are in `scripts/perf/baseline/`, the candidates in `scripts/perf/cand/`, the corpus generator in `scripts/perf/corpus.ts`, the harness in `scripts/bench-optimize-equiv.ts`. "Identical" = `JSON.stringify` of the whole result equal (order, ETAs/departAt, misses, dark, timed), no tolerance. Corpora: sizes 2 to 40 stops (55% up to 14), clustered plus outliers, duplicate points, asymmetric / integer-tied / NaN / Infinity / missing / rarely negative durations, all light prefs, must/high/normal, many latitudes (including polar), dates, start hours, preferred and fixed departures, time focus, tuning overrides. Timing: warm-up, 20 reps, baseline and candidates interleaved, median / p95 ms per call, on a busy Mac (load 4 to 8, another job running), so read the percentages, not the absolute ms.

### optimize-order (5,000 cases each, 0 mismatches for every row)

| Strategy | Equivalent | median ms n=4 / 8 / 12 / 13 / 20 / 30 / 40 | Verdict |
|---|---|---|---|
| baseline | - | 0.0029 / 0.031 / 0.956 / 1.57 / 4.59 / 20.9 / 46.3 | reference |
| E1 Held-Karp, flat Float64Array/Int8Array tables, same push loops | yes, 0 / 5000 | 54% / 51% / 61% / 100% / 99% / 100% / 100% of baseline | superseded by E3 |
| E2 flat + iterate set bits only (push form) | yes, 0 / 5000 | 110% (noisy) / 32% / 30% / 97% / 99% / 100% / 100% | superseded by E3 |
| E3 flat + pull form (per state, scan predecessors ascending, strict `<`) | yes, 0 / 5000 | 54% / 26% / 31% / 100% / 98% / 100% / 100% | adopted (exact part) |
| H1 heuristic: scratch Int32Array candidates, no allocation, full sum | yes, 0 / 5000 | n/a (exact path) / 95% / 99% / 37% / 44% / 41% / 43% | superseded by H3 |
| H2 H1 + reuse the unchanged leading partial sum + early abort at the threshold | yes, 0 / 5000 | n/a / 86% / 96% / 34% / 41% / 37% / 39% | superseded (abort slower than H3) |
| H3 H1 + reuse the unchanged leading partial sum (`pre`), skip the duplicate reversed single stop | yes, 0 / 5000 | n/a / 84% / 96% / 33% / 38% / 36% / 37% | adopted (heuristic part) |
| src (E3 + H3 in `src/lib/optimize-order.ts`) | yes, 0 / 5000 | 56% / 24% / 31% / 33% / 39% / 35% / 37% | adopted |

Rejected idea: delta-cost (O(1)) 2-opt/or-opt evaluation. It changes the floating-point summation order, so a near-tie could flip the `c < cost - 1e-9` test; not tried against the corpus because it cannot be identical in principle.

### optimize-schedule (5,100 cases for S3/S5/S7, 5,100 more for the final src code, 0 mismatches)

| Strategy | Equivalent | median ms n=4 / 8 / 12 / 13 | Verdict |
|---|---|---|---|
| baseline | - | 0.27 / 152 / 1050 / 48.8 | reference |
| S1 fused missed-light and darkness lookup (one sun lookup per visit), flat interval arrays | yes, 0 / 150 (not run on the big corpus) | 88% / 59% / 71% / 71% | part of the adopted code |
| S2 S1 + exact search carries each prefix's per-departure totals down the tree | yes, 0 / 150 | 82% / 20% / 71% / 71% | part of the adopted code |
| S3 S2 + prune branches whose prefix cannot beat the best by more than EPS | yes, 0 / 5100 | 78% / 9% / 71% / 72% | part of the adopted code |
| S4 S1 + local search scores neighbours from the first changed position (prefix sums), no array allocation | yes, 0 / 150 | 88% / 59% / 51% / 55% | part of the adopted code |
| S5 S4 + abandon a neighbour once its partial cost reaches the threshold | yes, 0 / 5100 | 77% / 41% / 36% / 34% | part of the adopted code |
| S6 S3 + S5 | yes, 0 / 150 | 80% / 9% / 36% / 34% | part of the adopted code |
| S7 S6 + the faster optimizeOrder | yes, 0 / 5100 | 80% / 9% / 36% / 30% | adopted |
| src (S7 written cleanly in `src/lib/optimize-schedule.ts`) | yes, 0 / 5100 | 85% / 9% / 36% / 30% | adopted |

Larger sizes (baseline vs src): n=20 155 ms vs 56 ms (36%), n=30 591 ms vs 198 ms (34%), n=40 2353 ms vs 419 ms (18%). Pruning and early abort are only enabled when every cost term is provably non-negative (`Evaluator.monotone`); otherwise the code takes the full-sum path, which is why the corpus includes negative legs. Honest note: at n=4 the gain is 15% (85% of baseline, 0.27 to 0.23 ms; the time there is mostly the sun-window lookups), right at the 15% bar; every size from 8 up is 20% to 91% faster and nothing is slower. `isExactOptimization` and the async/budget path are unchanged.

Tests after the change: `npx vitest run src/lib/optimize-order.test.ts src/lib/optimize-schedule.test.ts tests/api/optimize.test.ts` 3 files, 110 tests passed; `npx tsc --noEmit` and `npx eslint --max-warnings 0` on both changed files clean.

Re-run (equivalence plus timing; `STAGE=schedule` for the scheduler, `CASES` = corpus size, `SEED` = a different corpus, `CANDS` = comma list of name prefixes, `TIME=0` skips timing, `SIZES`/`REPS`/`TIMED_CASES` shape the timing):

```
STAGE=order CASES=5000 REPS=20 perl -e 'alarm 3000; exec @ARGV' npx vitest run --config scripts/bench-optimize-equiv.vitest.mts
STAGE=schedule CASES=1700 SEED=0 REPS=20 perl -e 'alarm 7200; exec @ARGV' npx vitest run --config scripts/bench-optimize-equiv.vitest.mts
```

Results are written to `RESULT` (default `/tmp/bench-optimize-equiv-<stage>.txt`). The schedule stage at 5,000 cases takes about an hour; run three seeds in parallel to shorten it.
