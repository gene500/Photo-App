# Perf log A82c (geo / hike / itinerary / weather helpers)

Rule: adopt only if output is exactly equal (deep equality plus JSON bit/-0/NaN check) on the whole randomized corpus, median >= 15% faster on realistic sizes, never slower on small ones.

Profiling: hot spot is `Graph.nearestEdge` in `src/server/hike/graph.ts` (linear scan of every edge with a closure and an allocated result object per edge, called once per trail end, snap point and trailhead; roughly O(ends x edges)). A 40-case large set (60-180 segments) took about 2.5 s. Everything else (itinerary, opening-hours, weather, static-map, visited-run, hike-cache, weather-cache, geo.ts) is microseconds at realistic sizes (30 stops) and was not worth a candidate; geo.ts is untouched (its callers in other agents' files are unaffected).

Corpus: 6000 hike cases (empty/1/many segments, lattice coordinates for equal-weight ties, disconnected graphs, loops, duplicate points, antimeridian, near poles, NaN/Infinity coordinates, option overrides), 6000 cases per small helper (sizes 0, 1, 2, 3, 30, 200, 2000; NaN/+-90 lat, +-180 lng).

| Strategy | Identical on | Mismatches | Median ratio (small / medium / large) and ms | Verdict |
|---|---|---|---|---|
| hike C1: flat loop, squared-distance prune, hypot only for survivors | 6000 | 0 | 0.81 / 0.57 / 0.35; large 2454 ms -> 849 ms | ADOPTED in `src/server/hike/graph.ts` |
| hike C2: C1 plus per-edge bbox lower bound | 6000 | 0 | 0.86 / 0.69 / 0.38 | rejected: slower than C1 |
| hike C3: inlined projection only, hypot always | 6000 | 0 | 0.87 / 0.87 / 0.77 | rejected: smaller gain than C1 |
| legs E1: cos(lat) of previous stop reused (`estimateLegDurations`) | 6000 | 0 | 30 stops-ish (n=200) 0.78, n=3 0.54-0.70; 0.48 ms | ADOPTED in `src/lib/straight-line.ts` |
| legs E2: plain loop over real haversine | 6000 | 0 | 0.87 / 0.66 | rejected: E1 faster |
| legs E3: E1 with s*s instead of **2 | 6000 | 0 | 0.77 / 0.62 | rejected: no gain over E1, extra risk |
| diffIds D1 single pass / D2 empty shortcut / D3 | 6000 | 0 | n=2000 0.70-0.73, n=3 0.81-0.95 (first run 0.88-1.47, noisy) | rejected: absolute cost microseconds, unstable at small sizes |
| routeSignature R1 (one-pass dual hash) / R2 (template string) | 6000 | 0 | n=200 0.93-0.98, n=3 0.91-0.93 | rejected: under 15% |

Timing caveat: CPU shared with other agents; baseline runs first in each interleaved repetition (warm-up reps discarded, median of repetitions); two full runs gave consistent ordering for the adopted items.

Re-run: `perl -e 'alarm 900; exec @ARGV' npx vitest run --config scripts/perf-c/equiv.config.mts` (writes `scripts/perf-c/results.txt`; `N=6000` env sets hike cases). The "real" rows compare the adopted `src/` code against the frozen baseline in `scripts/perf-c/baseline/`.
