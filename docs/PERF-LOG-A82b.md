# A82b: suggestion-pipeline algorithm benchmark

Rule: a candidate is adopted only if its output is deep-equal (`assert.deepStrictEqual`: same order, same floats, same tie-breaking) to the original on every corpus case, median at least 15% faster at realistic sizes, and not slower on small inputs.

Re-run (about 3 minutes; the CPU is shared, so absolute numbers are noisy, ratios are interleaved medians of 51 repetitions):

    SHOW=1 CASES=8000 REPS=51 OUT=/tmp/perf-b.json perl -e 'alarm 900; exec @ARGV' npx vitest run --config scripts/perf-b/bench.config.mts

`OUT` gets the profile, every ratio and the first mismatching input per failing strategy. Frozen originals: `scripts/perf-b/baseline/`; candidates: `scripts/perf-b/cand/`; corpus and timer: `scripts/perf-b/bench.test.ts`. `REAL` rows run the code now in `src/` against the frozen baseline.

## Profile of the original code (median ms, realistic input)

| Function | Input | ms |
|---|---|---|
| buildCorridorShape (turf, not rewritten) | 4000-point cross-country route | 13.4 |
| createRingTester + 8000 point tests | 477-point corridor | 9.2 |
| parseOverpassResponse (with origin / without) | 3000 elements | 8.1 / 2.7 |
| fanOffsets | 500 markers | 3.7 |
| toElements | 8000 rows | 2.7 |
| cellsForRing | 477-point corridor | 0.93 |
| filterCircle (haversine per row) | 8000 rows | 0.50 |
| cellRuns | 2702 cells | 0.41 |
| unwrapForFit | 2000 points | 0.78 |
| rankByScore | 300 suggestions | 0.011 |
| cellsForCircle | 24 km | 0.004 |
| downsampleRoute | 4000 points | 0.024 |

Not hot (microseconds, not touched): cellsForCircle, rankByScore at real sizes, downsample, map-bounds, cache.ts (Map operations), popularity.ts (network bound; its CPU part is rankByScore), corridor.ts (all time is in turf; `toOverpassPoly` is a 300-element map/join).

## Results

Ratio = candidate / baseline (below 1 is faster). Sizes listed small / medium / large.

| Algorithm | Strategy | Identical on | Median ratio (small / mid / large) | Baseline ms at large | Verdict |
|---|---|---|---|---|---|
| parse | A latitude prefilter on dedup | 8000 (0) | 0.55 / 0.91 / 1.03 | 5.0 | rejected: no gain at 3000 |
| parse | B A + no tag copy + Intl.Collator tiebreak | 8000 (0) | 0.41 / 0.77 / 0.87 | 5.0 | rejected: under the heap variants |
| parse | C B + lazy heap instead of full sort | 7407 (593) | 0.51 / 0.54 / 0.52 | 5.0 | rejected: differs when `cap` is NaN (fixed in REAL) |
| parse | D C + name-clean fast path + hoisted origin trig | 7407 (593) | 0.47 / 0.47 / 0.45 | 5.0 | same NaN-cap bug; led to REAL |
| parse | REAL (D with the cap loop condition fixed) | 8000 (0) | 0.46 / 0.46 / 0.43 | 5.0 | ADOPTED (parse.ts) |
| rankByScore | A typed keys / B wrapper keys / C skip-if-sorted | 8000 (0) each | A 1.66,0.88,0.23; B 0.69,0.49,0.20; C 2.15,1.08,0.27 | 4.8 (5000 items) | rejected: real size (300 items) is 3 microseconds, small-size ratios flip between runs |
| cellsForCircle | A inlined haversine, hoisted trig | 8000 (0) | 0.72 / 0.37 / 0.30 | 0.11 | rejected: 4 microseconds per call, not hot |
| cellsForCircle | B A + latitude row skip | 8000 (0) | 1.38 / 0.62 / 0.41 | 0.11 | rejected: slower on small |
| cellsForCircle | C threshold compare before asin | 7743 (257) | 0.66 / 0.20 / 0.15 | 0.11 | rejected: not identical |
| cellRuns | A Float64Array sort, one-pass dedupe | 8000 (0) | 0.47 / 0.36 / 0.38 | 4.2 | ADOPTED (places-grid.ts; REAL 0 of 8000 mismatches, 0.47/0.36/0.39) |
| cellRuns | B Array sort no Set | 8000 (0) | 0.73 / 0.80 / 0.82 | 4.2 | rejected: A is faster |
| cellRuns | C Set + typed sort | 8000 (0) | 0.95 / 0.63 / 0.66 | 4.2 | rejected: A is faster |
| cellsForRing | A flat loops, reused xs, no destructuring | 8000 (0) | 0.87 / 0.66 / 0.77 | 0.59 | ADOPTED (REAL 0 mismatches, 0.87 / 0.66 / 0.79) |
| cellsForRing | B Int32 open-addressing hash set | 8000 (0) | 1.10 / 0.66 / 0.64 | 0.59 | rejected: slower on small, complex |
| cellsForRing | C per-row edge buckets | 8000 (0) | 1.01 / 0.78 / 0.75 | 0.59 | rejected: not faster than A |
| createRingTester | A typed arrays, compressed strip rows | 8000 (0) | 0.96 / 0.58-0.82 / 0.32 | 6.3 (8000 queries) | ADOPTED for rings of 32+ points (REAL: 0.88, 0.93, 0.59, 0.70, 0.33) |
| createRingTester | B flat Float64 edge records per strip | 8000 (0) | 2.75 / 2.8 / 0.36 | 6.3 | rejected: slow to build |
| createRingTester | C bounding box + whole-ring ray cast | 8000 (0) | 0.16 / 0.45 / 5.8 | 6.3 | rejected: 5.8x slower on corridors |
| fanOffsets | A pair loop kept, group building without array copy | 8000 (0) | 0.92 / 0.95 / 0.89 | 34.5 (2000 markers) | rejected: little gain |
| fanOffsets | B sort by x, sweep window | 8000 (0) | 0.80 / 0.21 / 0.07 | 34.5 | ADOPTED (marker-fan.ts; REAL 0.52 / 0.20 / 0.08) |
| fanOffsets | C spatial hash grid | 8000 (0) | 1.01 / 0.23 / 0.05 | 34.5 | rejected: slower on small |
| toElements | A single loop, push | 8000 (0) | 0.89 / 0.92 / 0.93 | 5.8 (20000 rows) | rejected: under 15% |
| toElements | B A + literal tag objects | 8000 (0) | 0.99 / 0.98 / 0.94 | 5.8 | rejected: under 15% |
| toElements | C B + indexOf instead of split | 8000 (0) | 0.40 / 0.45 / 0.44 | 5.8 | ADOPTED (local-places.ts; REAL 0.32 / 0.35 / 0.35) |

Calibration: the unchanged `rankByScore` run as REAL against its own baseline measures 1.03 / 1.01 / 1.00, so ratio noise is about +-3% at the large sizes and larger (up to +-15%) for sub-10-microsecond cases.

## Corpus

8000 randomized cases per algorithm, seeded, sizes 0, 1, 2-12, 13-200 and up to 3000 (800 for ranking). Covers: duplicate ids and coordinates, tight clusters inside the 100 m dedup radius, ties on kind/name/distance, ids differing only in type, null/non-object elements, non-string tags and names, control and bidi characters, dedication names, NaN/Infinity/out-of-range coordinates, lat/lng at +-90/+-180 and near the poles and antimeridian, `cap` of 0, 1, 2.5, -1, NaN, 100000, a NaN or infinite origin, NaN popularity, rings of 0-2 points, rings with holes, rings crossing 180 degrees, a ring with a NaN vertex, row kinds such as `toString` and `constructor`, malformed ids, marker `minDist` of 0, NaN and negative, markers at NaN/Infinity/-0, and shared marker ids.

## What changed in src/

- `src/server/suggestions/parse.ts`: tags read directly instead of copied; name-clean regex pre-test; origin cosine hoisted; best-first heap instead of a full sort (stable tie order kept by index); Intl.Collator instead of localeCompare for the id tiebreak; a 0.002 degree latitude gap skips the haversine in the dedup check (distance is at least R times the latitude gap).
- `src/server/suggestions/places-grid.ts`: `cellRuns` (typed sort), `cellsForRing` (flat loops), `createRingTester` (typed arrays; the old code remains for rings under 32 points).
- `src/server/suggestions/local-places.ts`: `toElements` (single loop, indexOf).
- `src/lib/marker-fan.ts`: x-sorted sweep; falls back to the original all-pairs loop for non-finite coordinates or a non-positive/non-finite `minDist`.

Bug found in my own candidates by the corpus: a NaN `cap` returned no results in a heap variant (original keeps everything); and a NaN radius made one circle variant throw. Both were fixed before anything reached src/ and are now in the corpus.
