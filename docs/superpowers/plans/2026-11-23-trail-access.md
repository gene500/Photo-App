# Road end and trail for stops with no parking lot (F3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stop with no parking lot that is more than 100 m from a drivable road is routed to the nearest road point that a trail connects to the stop, and that trail is drawn dashed on the map, share page and PDF.

**Architecture:** The road end is a second kind of the existing saved access point (`Stop.access*` columns, `AccessPoint` DTO), so `routePoint`/`routePoints`, the `P` marker, the park line, Maps links, the schedule walk time and Optimize pick it up with no new concept. A new server module finds it from one Overpass query (roads plus walkable ways, reusing `findHikePath` from `src/server/hike/graph.ts`) and `resolveStopAccess` saves it only when no real lot was found. The trail polyline is stored as a capped JSON string on the stop.

**Tech Stack:** Next.js 16, Prisma 7 + libsql (additive migration applied by `scripts/migrate-turso.mjs` at `vercel-build`), vitest (DB tests in the `db-and-server` project), Playwright e2e with fake externals, mapbox-gl, jsPDF.

**Spec:** `docs/superpowers/specs/2026-11-23-trail-access-design.md` (binding). Everything under its "Calls" is the assistant's, not owner-confirmed: keep it as stated. Owner decision: "have it go to the nearest road with a trail that leads to the stop".

## Global Constraints

- A resolved real lot always wins; the road end is looked up only when the hike lookup finished with no lot (`failed === false`, `access === null`).
- Threshold: a stop more than 100 m from a drivable road with no lot gets a road end; a stop within 100 m keeps today's behaviour (nothing saved except `accessResolvedAt`).
- The road end and trail are found when the access lookup runs (`POST /api/stops/:id/access`, called by `use-access-resolver.ts` after a stop is added and when a trip opens) and are stored on the stop. No lookup on page view, share view or PDF.
- A lookup that fails (service down, deadline) saves nothing and is retried, exactly like the lot lookup; it is never treated as "no road".
- Free data first: Overpass (OpenStreetMap) for the road and trail. Mapbox walking Directions is the fallback for the trail line only, and every Mapbox call added is counted: `spendBudget` (inside `getJson` in `src/server/external/mapbox.ts`) and `spendUserShare("mapbox-directions", userId)` (by the caller, as `src/app/api/directions/route.ts` does).
- No trail found: draw a straight dashed line road end to stop and say "no mapped trail" on the stop.
- Walk time: existing 4 km/h estimate (`walkMinutes` in `src/lib/walk-time.ts`) over the trail length, as for lots. Do not change `walk-time.ts`.
- The trail is drawn dashed, in the route-line family colour, thinner than the route, under the markers; colour is a token in `src/lib/map-theme.ts`.
- Stop card line: `Park at Road end, walk N` (the existing `parkText` format with name "Road end").
- Moving a stop clears the road end and trail like the lot (`src/server/stops.ts`).
- Do not change Optimize's algorithm. Do not spend a Mapbox call per stop per page view.
- The working tree has other uncommitted work (A7 budgets in `src/server/budget*.ts` and routes, native app under `apps/native`, `.github/workflows/native-windows.yml`). Do not depend on it, edit it, revert it or stage it. Stage only the files each task names. Only `src/server/external/mapbox.ts` is shared (it already imports `spendBudget`); add to it, change nothing else there.
- Repo rules: typecheck (`npm run typecheck`) and `npm run lint` clean; run the full vitest suite alone; e2e on its own port; never print or commit secrets (Mapbox `pk.` token, `TURSO_*`); no commit or push unless the owner says so (the commit steps below are for when the owner has asked for commits); legal pages review before any push (Task 9).

## Decisions made here (the implementer does not decide these)

- **Data model.** `AccessPoint` (in `src/lib/types.ts`) gains optional `kind?: "lot" | "road-end"` (absent = `"lot"`) and `trail?: LngLat[] | null`. Optional so existing fixtures and offline copies stay valid; the mapper always sets both. Prisma `Stop` gains `accessKind String?` (null = lot) and `accessTrail String?` (JSON `[[lng,lat],...]`, null = none). Road end = `kind "road-end"`, `name "Road end"`, `walkMeters` = trail length (or straight distance when no trail). "No mapped trail" is `kind "road-end"` with `trail` null.
- **Trail size cap.** Coordinates rounded to 5 decimals, at most `ACCESS_TRAIL_MAX_POINTS = 120` points (via `simplifyLine`), serialized at most `ACCESS_TRAIL_MAX_CHARS = 4000`; over either cap the trail is simplified harder, and if still over it is dropped (null) rather than stored. The reader (`toAccess`) re-validates and degrades a bad value to null.
- **Migration.** Hand-written folder `prisma/migrations/20261123140000_stop_road_end/migration.sql` in the repo's style (see `20261117130000_stop_access_walk`): `-- AlterTable` then `ALTER TABLE "Stop" ADD COLUMN "accessKind" TEXT;` and `... "accessTrail" TEXT;`. Additive and nullable so the previous app version keeps working. `scripts/migrate-turso.mjs` applies it once per name at `vercel-build` (production builds only), splitting on `;` with no semicolons inside literals. After editing `prisma/schema.prisma` run `npx prisma generate` (and commit `src/generated/prisma` only if `git ls-files src/generated` shows it is tracked).
- **Overpass.** One query per stop through `fetchOverpass` (`src/server/suggestions/overpass.ts`: mirrors, `User-Agent: road-trip-photo-planner/0.1`, `stopOnHeavy`), timeout 10 s, deadline 12 s, `maxsize` 6 MB, in a box of radius `ROAD_SEARCH_M = 5000` (a box, not `around:`, as `osmHikeQuery` does). It asks for drivable highways (`motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street` plus `*_link`, excluding `access=private|no`, `motor_vehicle=no`, and `service=driveway|parking_aisle|alley|emergency_access|drive-through`) and for walkable ways (same `WALKABLE` set and exclusions as `osm.ts`, plus `highway=track` that is not road-named). `OverpassTooHeavyError` counts as failed here (not "no road").
- **Choosing the road end.** (1) `nearestRoadDistanceM` of the stop to any road segment; if `<= 100` return `near-road` (no access). (2) `findHikePath(trailSegments, stop, { trailheadTiers: [roadVertices], tierMaxM: [5000], snapTrailheadM: 25, minM: 0 })`: the nearest road vertex reachable by trail is the road end and the path is the trail. (3) No trail reaches a road: the road end is the nearest point on the nearest road segment, trail null, then one Mapbox walking call may supply a trail (Task 4). (4) No road within 5000 m, or the walk would exceed 5000 m (`LOT_MAX_WALK_M`): `none` (no access saved, resolved).
- **Failure handling for Mapbox.** A Mapbox error or a budget refusal in the walking fallback makes the whole lookup count as failed (nothing saved, retried), not "no mapped trail". Only "OSM and Mapbox both answered and found no trail" saves a road end with null trail.
- **Caching.** In-memory, like `createHikeLookup`: bounded map keyed by `hikeKey(lat,lng)`, TTL 24 h found, 1 h none/near-road, 5 min failure, shared in-flight requests, `HIKE_CACHE_MAX` 500. Mapbox walking results have their own `TtlCache` in `mapbox.ts`.
- **Hike line vs trail.** A stop with a mapped road-end trail does not also draw its green dotted hike line (the trail replaces it); a stop with a straight no-trail road end keeps its hike line if it has one.

## Review Focus

Input classes the spec implies but no spec line tests; each has its test in the owning task.

- Stop exactly on the 100 m boundary and a road 99 m vs 101 m away: 99 stays unchanged, 101 gets a road end (Task 2).
- Road found but only a private/driveway/parking-aisle road nearby: those are not drivable roads for this purpose (Task 2).
- Hike lookup failed (`failed: true`) while no lot: nothing saved, road lookup not run (Task 5).
- A stop moved after a road end was saved: road end and trail cleared, looked up again; a late answer for the old position does not overwrite (Task 1 and 5).
- Offline copy saved before this feature, or with a corrupt `trail`: opens as a lot or a straight line, never crashes (Task 1).
- Trail over the size cap: simplified, then dropped, never stored oversized (Task 1 and 3).
- Two stops sharing one road end: one merged `P` marker, two dashed lines (Task 7).
- A user at their Mapbox directions share: the fallback is skipped as a failed lookup, nothing saved (Task 5).

## File structure

- Create `src/server/hike/road-end.ts` (+ test, fixture `src/server/hike/fixtures/overpass-arches-road-end.json`): query, parse, choose.
- Create `src/server/hike/road-end-lookup.ts` (+ test): cached/deduped lookup, fake mode.
- Create `src/lib/trail-lines.ts` (+ test): what to draw, shared by map, share view and PDF.
- Create `src/components/editor/trail-layer.ts` (+ test): Mapbox dashed layer, mirrors `hike-layer.ts`.
- Modify `prisma/schema.prisma`, new migration folder, `src/lib/types.ts`, `src/server/mappers.ts`, `src/server/stops.ts`, `src/server/stop-access.ts`, `src/server/external/mapbox.ts`, `src/server/external/fake.ts`, `src/lib/offline-store.ts`, `src/lib/itinerary.ts`, `src/lib/map-theme.ts`, `src/lib/static-map.ts`, `src/lib/itinerary-download.ts`, `src/lib/itinerary-pdf.ts`, `src/components/editor/{MapPanel,FakeMapPanel,TripEditor}.tsx`, `src/components/share/SharedTripView.tsx`.

---

### Task 1: Data model, migration, mapper, offline copy

**Files:**
- Modify: `prisma/schema.prisma` (Stop, after `accessWalkMeters`), `src/lib/types.ts:19`, `src/server/mappers.ts:46-49`, `src/server/stops.ts:123`, `src/lib/offline-store.ts:246-250`
- Create: `prisma/migrations/20261123140000_stop_road_end/migration.sql`, `src/lib/access-trail.ts` (+ `src/lib/access-trail.test.ts`)
- Test: `src/server/mappers.test.ts`, `src/server/stops.test.ts`, `src/lib/offline-store.test.ts`

**Interfaces:**
- Produces: `AccessPoint = { lat; lng; name; walkMeters; kind?: "lot" | "road-end"; trail?: LngLat[] | null }`; `ACCESS_TRAIL_MAX_POINTS = 120`, `ACCESS_TRAIL_MAX_CHARS = 4000`; `parseAccessTrail(raw: unknown): LngLat[] | null` (valid points in range, 2..120 of them, else null); `serializeAccessTrail(trail: LngLat[] | null): string | null` (5-decimal rounding, null over the caps). All in `src/lib/access-trail.ts` (shared by server mapper and offline store).
- Consumes: nothing.

- [ ] **Step 1: Write failing tests**
  - `access-trail.test.ts`: `parseAccessTrail("[[ -109.5,38.7],[-109.51,38.71]]")` returns two points; `parseAccessTrail("not json")`, `"[[1,2]]"` (one point), `"[[200,0],[0,0]]"` (out of range), a 121-point string all return `null`; `serializeAccessTrail(121 points)` returns `null`; a 100-point trail with 8-decimal values round-trips to 5 decimals and its string length is `<= 4000`.
  - `mappers.test.ts`: a row with `accessKind: "road-end"`, `accessTrail` valid, name "Road end" gives `access.kind === "road-end"` and `access.trail` equal to the parsed array; a row with `accessKind: null` gives `kind "lot"` and `trail` null; `toPublicTripDto` carries `kind` and `trail` too; a corrupt `accessTrail` gives `trail === null` without throwing.
  - `stops.test.ts`: after `updateStop` with a new `lat`, `accessKind` and `accessTrail` are null as well as the existing four columns and `accessResolvedAt`.
  - `offline-store.test.ts`: a stored copy with `access` lacking `kind`/`trail` normalizes to `kind "lot"`, `trail null`; with `kind: "road-end"` and a valid trail keeps both; with `kind: "banana"` becomes `"lot"`; with a corrupt trail array becomes `trail null`.
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/lib/access-trail.test.ts src/server/mappers.test.ts src/server/stops.test.ts src/lib/offline-store.test.ts`. Expected: FAIL (module/columns missing).
- [ ] **Step 3: Schema and migration.** Add `accessKind String?` ("lot" | "road-end", null = lot) and `accessTrail String?` (JSON, capped, null = none) with `///` comments to `Stop`; write the migration SQL exactly as in Decisions; run `npx prisma generate`. Confirm how the DB test setup applies migrations (`grep -rn "migrat" vitest.config.mts tests/ src/server/db.test.ts`) and that a fresh test DB has the new columns.
- [ ] **Step 4: Implement** `access-trail.ts` (signatures above); extend `toAccess` in `mappers.ts` to read both columns through `parseAccessTrail` (kind: `"road-end"` only for that exact string); add the two columns to the clearing object in `stops.ts`; extend `normalizeAccess` in `offline-store.ts` using `parseAccessTrail` (accept an array, not a string, there: reuse a shared `isLngLatList` helper exported from `access-trail.ts`); widen `AccessPoint`.
- [ ] **Step 5: Run to verify pass**, then `npm run typecheck`. Expected: PASS, typecheck 0.
- [ ] **Step 6: Commit** (only when the owner has asked for commits): `git add prisma src/lib/types.ts src/lib/access-trail.ts src/lib/access-trail.test.ts src/server/mappers.ts src/server/mappers.test.ts src/server/stops.ts src/server/stops.test.ts src/lib/offline-store.ts src/lib/offline-store.test.ts` and `git commit -m "feat(F3): road-end kind and trail on the stop access point"`.

---

### Task 2: Road-end finder (pure, Overpass query and parse)

**Files:**
- Create: `src/server/hike/road-end.ts`, `src/server/hike/road-end.test.ts`, `src/server/hike/fixtures/overpass-arches-road-end.json`

**Interfaces:**
- Produces:
  - `ROAD_NEAR_M = 100`, `ROAD_SEARCH_M = 5000`
  - `roadEndQuery(lat: number, lng: number, radiusM: number): string`
  - `parseRoadEnd(json: unknown): RoadData | null` where `RoadData = { roads: LngLat[][]; trails: LngLat[][] }` (null when the answer has no `elements` array)
  - `chooseRoadEnd(data: RoadData, at: { lat: number; lng: number }): RoadEndChoice` where `RoadEndChoice = { kind: "near-road" } | { kind: "none" } | { kind: "road-end"; point: LngLat; trail: LngLat[] | null; walkMeters: number }` (`walkMeters` rounded to 10 m; `trail` is the full-resolution path road end first, stop last, not yet simplified)
  - `nearestRoadDistanceM(roads: LngLat[][], at): number` (Infinity when no roads)
- Consumes: `findHikePath`, `lineLengthMeters` from `./graph`; `haversineMeters` from `@/lib/geo`; `LOT_MAX_WALK_M` from `./service`.

- [ ] **Step 1: Write failing tests** (fixture: a hand-built Overpass `out geom` answer, Arches-like: one `highway=secondary` way about 1,071 m from the stop, a `highway=path` way from that road to the stop with ~10 vertices, plus a `highway=service`+`service=driveway` way 60 m from the stop, plus a `highway=residential` with `access=private` 40 m from the stop):
  - `roadEndQuery` contains `[timeout:10]`, `maxsize`, `"highway"~` with `secondary` and without `driveway`/`track` in the road group, and a box (no `around:`).
  - `parseRoadEnd` puts the secondary road in `roads`, excludes the driveway (`service=driveway`) and the private residential, puts the path in `trails`; returns `null` for `{}`; drops ways with fewer than 2 valid points and points out of range.
  - `chooseRoadEnd` on the Arches fixture: `kind "road-end"`, `point` equals the road vertex where the path meets the road (within 25 m), `trail` is non-null, first point is the road end, last point is within 5 m of the stop, `walkMeters` between 1000 and 1300 and a multiple of 10.
  - Stop 99 m from a road: `{ kind: "near-road" }`; 101 m: road-end (fixture variant built in the test by shifting the stop with a small helper; assert `nearestRoadDistanceM` of both first).
  - Road 3 km away with no connecting path: `kind "road-end"`, `trail === null`, `point` is on the nearest road segment (within 1 m of the segment), `walkMeters` about 3000.
  - No roads in the data: `{ kind: "none" }`. Trail needs more than 5000 m, and the nearest road by straight line is also over 5000 m: `{ kind: "none" }`.
  - The nearest road by straight line is not the one the trail reaches (a nearer road with no trail, a farther road with a trail): the farther road with the trail is chosen (owner: "nearest road with a trail that leads to the stop").
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/server/hike/road-end.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four exports in `road-end.ts` following the Decisions section ("Overpass", "Choosing the road end"); reuse the `WALKABLE` and `ROADLIKE` rules from `osm.ts` by exporting them from there (a one-word `export` each, no behaviour change). Road vertices for the tier list are every vertex of every road within `ROAD_SEARCH_M`, densified to at most 50 m spacing so a trail that meets a road mid-segment still snaps (`snapTrailheadM: 25`).
- [ ] **Step 4: Run to verify pass**, then `npx vitest run src/server/hike` to confirm the existing hike tests are untouched. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/hike/road-end.ts src/server/hike/road-end.test.ts src/server/hike/fixtures/overpass-arches-road-end.json src/server/hike/osm.ts` and `git commit -m "feat(F3): find the nearest road end and connecting trail from OSM"`.

---

### Task 3: Cached lookup with failure semantics and fake mode

**Files:**
- Create: `src/server/hike/road-end-lookup.ts`, `src/server/hike/road-end-lookup.test.ts`
- Modify: `src/server/external/fake.ts` (add `FAKE_ROAD_END_POINT`, `fakeRoadEnd`), `src/server/external/fake.test.ts`

**Interfaces:**
- Produces:
  - `type RoadEndResult = { kind: "near-road" } | { kind: "none" } | { kind: "road-end"; point: LngLat; trail: LngLat[] | null; walkMeters: number }` (same shape as `RoadEndChoice`, with `trail` already simplified to `ACCESS_TRAIL_MAX_POINTS`)
  - `createRoadEndLookup(deps?: { fetchImpl?: typeof fetch; now?: () => number }): (lat: number, lng: number) => Promise<{ result: RoadEndResult | null; failed: boolean }>` (`result` null exactly when `failed`)
  - `lookupRoadEnd` = the default instance. `ROAD_END_TTL_MS = 24h`, `ROAD_END_NONE_TTL_MS = 1h`, `ROAD_END_FAILURE_TTL_MS = 5min`.
  - `fakeRoadEnd(lat, lng): RoadEndResult | null` in `fake.ts`: a canned road end 400 m west with a 4-point trail within 0.05 degrees of `FAKE_ROAD_END_POINT = { lat: 37.2, lng: -119.5 }`, else null (distinct from `FAKE_HIKE_POINT` so the two fake features do not collide).
- Consumes: `roadEndQuery`, `parseRoadEnd`, `chooseRoadEnd` (Task 2); `fetchOverpass`, `OverpassTooHeavyError`; `simplifyLine`; `serializeAccessTrail` (Task 1) to enforce the char cap; `hikeKey`; `isFakeExternal`.

- [ ] **Step 1: Write failing tests** (mock `fetchImpl` returning the Task 2 fixture):
  - Arches fixture answer returns `{ result: { kind: "road-end", trail: non-null, ... }, failed: false }` with `trail.length <= 120` and `serializeAccessTrail(trail) !== null`.
  - `fetchImpl` rejecting for every mirror returns `{ result: null, failed: true }` (never `{ kind: "none" }`); the same for HTTP 500 and for an answer with no `elements`; `OverpassTooHeavyError` returns failed.
  - Failure is remembered 5 min (second call within TTL makes no new fetch), then retried after `now()` advances 5 min + 1 ms and succeeds.
  - Success is cached 24 h; `near-road` and `none` 1 h; concurrent calls for the same key share one fetch.
  - The request body sent has the user agent header `road-trip-photo-planner/0.1` (assert through `fetchImpl` call args) and the stop is snapped to `hikeKey` before querying.
  - A trail longer than 120 vertices comes back simplified; a trail whose JSON would exceed 4000 chars after the point cap comes back with `trail: null` and the road end kept.
  - With `FAKE_EXTERNAL` on, `fakeRoadEnd` answers with no `fetchImpl` call.
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/server/hike/road-end-lookup.test.ts src/server/external/fake.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `createRoadEndLookup` by copying the structure of `createHikeLookup` in `src/server/hike/service.ts` (bounded Map, in-flight Map, TTLs above); overall step deadline 12 s through `Promise.race` with `{ result: null, failed: true }`; simplify with `simplifyLine(trail, 120, stop)` and, if `serializeAccessTrail` returns null, retry once with cap 60 then set `trail: null`.
- [ ] **Step 4: Run to verify pass**. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/hike/road-end-lookup.ts src/server/hike/road-end-lookup.test.ts src/server/external/fake.ts src/server/external/fake.test.ts` and `git commit -m "feat(F3): cached road-end lookup, failed lookups retried"`.

---

### Task 4: Mapbox walking fallback for the trail line

**Files:**
- Modify: `src/server/external/mapbox.ts`, `src/server/external/mapbox.test.ts`

**Interfaces:**
- Produces: `getWalkingTrail(from: LngLat, to: LngLat, fetchImpl?: typeof fetch): Promise<{ geometry: LngLat[]; distanceMeters: number } | null>`: Mapbox `directions/v5/mapbox/walking`, `geometries=geojson&overview=full`; returns null when Mapbox answers `NoRoute` or the walk is over `LOT_MAX_WALK_M` (5000 m); throws `ExternalServiceError` on any other failure; cached in its own `TtlCache` (10 min, 100 entries) and cleared by `clearMapboxCaches`; in fake mode returns null.
- Consumes: `getJson` with `{ product: "mapbox-directions", units: 1 }` (so `spendBudget` counts it), `TtlCache`, `isFakeExternal`.

- [ ] **Step 1: Write failing tests** in `mapbox.test.ts`: success returns geometry and distance and the request URL contains `/directions/v5/mapbox/walking/`; the budget counter for `mapbox-directions` goes up by exactly 1 per uncached call (use the existing `spendBudget` mock/spy pattern in that file) and by 0 on a cached repeat; `NoRoute` returns null; a 500 throws `ExternalServiceError`; a 6 km walk returns null; budget exhausted (`spendBudget` rejecting with `HttpError` 429) propagates the rejection and does not call `fetch`.
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/server/external/mapbox.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `getWalkingTrail` next to `getDirections`, reusing `isLngLat`/`isNonNegative` response checks and `BAD_ROUTING_RESPONSE`.
- [ ] **Step 4: Run to verify pass**. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/external/mapbox.ts src/server/external/mapbox.test.ts` and `git commit -m "feat(F3): Mapbox walking trail fallback, counted in the budget"`. If `git diff` of `mapbox.ts` shows changes not made by this task (A7 work), stage hunks with `git add -p` instead.

---

### Task 5: Resolve and save the road end (the lot always wins)

**Files:**
- Modify: `src/server/stop-access.ts`, `src/server/stop-access.test.ts`, `src/app/api/stops/[id]/access/route.test.ts`

**Interfaces:**
- Produces: `resolveStopAccess(userId, stopId, deadlineMs?)` unchanged signature; new behaviour below. Saved columns for a road end: `accessKind "road-end"`, `accessName "Road end"`, `accessLat/Lng` = road end, `accessWalkMeters` = `walkMeters`, `accessTrail` = `serializeAccessTrail(trail)`, `accessResolvedAt` = now.
- Consumes: `lookupHikeStatus`, `lookupRoadEnd` (Task 3), `getWalkingTrail` (Task 4), `serializeAccessTrail` (Task 1), `spendUserShare` from `@/server/budget` (existing export; do not modify it), `withDeadline`.

Behaviour (decided): (1) hike lookup as today. (2) `failed` -> return the stop, save nothing. (3) A hike lot -> save the lot with `accessKind` null, `accessTrail` null, and never call the road lookup (a resolved real lot wins). (4) No lot -> `lookupRoadEnd`; failed -> save nothing; `near-road` or `none` -> save nothing but `accessResolvedAt` (as today's no-lot case, all access columns null). (5) `road-end` with `trail === null` -> `await spendUserShare("mapbox-directions", userId)` then `getWalkingTrail(point, stop)`; a non-null answer becomes the trail and its `distanceMeters` the walk (rounded to 10 m); null answer keeps trail null and the straight distance; any throw (Mapbox down, budget 429/503) -> whole lookup failed, nothing saved. (6) The whole chain runs inside the one `withDeadline` (17 s); a lookup still running at the deadline saves nothing (the hike result stays cached so the retry only repeats the road step). (7) The write keeps its `lat`/`lng` guard so an answer for an old position is dropped.

- [ ] **Step 1: Write failing tests** in `stop-access.test.ts` (mock `lookupHikeStatus`, `lookupRoadEnd`, `getWalkingTrail`, `spendUserShare`):
  - Arches-like: hike `{ hike: null, failed: false }`, road end with trail, stop 1,071 m away: saved `accessKind "road-end"`, `accessName "Road end"`, `accessWalkMeters` 1100-ish, `accessTrail` parses to the trail, `accessResolvedAt` set, DTO `access.kind === "road-end"`; `getWalkingTrail` and `spendUserShare` not called.
  - Stop within 100 m of a road (`near-road`): nothing saved except `accessResolvedAt`; all access columns null; routing unchanged.
  - No trail found: `trail null` from the lookup, `getWalkingTrail` returns null: saved road end with `accessTrail` null and `accessWalkMeters` the straight distance; `spendUserShare` called once with `("mapbox-directions", userId)`.
  - No trail found, Mapbox returns a 700 m path: saved trail is that geometry (<=120 points), walk 700.
  - Lookup failure retried: `lookupRoadEnd` returns `failed: true` -> `accessResolvedAt` stays null, no access columns written; a second `resolveStopAccess` with a succeeding lookup then saves it.
  - Hike lookup `failed: true` and no lot: `lookupRoadEnd` never called, nothing saved.
  - A resolved real lot always wins: hike returns a lot and the road lookup mock is set to return a road end: saved row is the lot (`accessKind` null, name from the lot), `lookupRoadEnd` not called.
  - Mapbox walking throws `HttpError(429)` and separately `ExternalServiceError`: nothing saved, `accessResolvedAt` null.
  - Stop moved while the lookup ran (PATCH lat between read and write): the write does not land.
  - Deadline: a road lookup that never resolves with `deadlineMs` 20 returns the unchanged stop and saves nothing.
  - Route test: `POST /api/stops/:id/access` returns `{ stop }` with `access.kind "road-end"` and `access.trail` for the Arches case; another user's stop still 404.
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/server/stop-access.test.ts "src/app/api/stops/[id]/access/route.test.ts"`. Expected: FAIL.
- [ ] **Step 3: Implement** the behaviour list in `resolveStopAccess`; extract a small `saveAccess(row, data)` helper only if the two write paths otherwise duplicate the `updateMany` guard.
- [ ] **Step 4: Run to verify pass**, then the full `db-and-server` project: `npx vitest run --project db-and-server`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/stop-access.ts src/server/stop-access.test.ts "src/app/api/stops/[id]/access/route.test.ts"` and `git commit -m "feat(F3): save a road end and trail for stops with no lot"`.

---

### Task 6: Text, walk time, routing and links (mostly pinned by tests)

**Files:**
- Modify: `src/lib/itinerary.ts:76-82` (`parkText`), `src/components/editor/ParkLine.tsx` and `src/components/editor/TripPlanList.tsx:105` and `src/components/share/SharedTripView.tsx:168` (pass the new fields through)
- Test: `src/lib/itinerary.test.ts`, `src/lib/route-points.test.ts`, `src/lib/walk-time.test.ts`, `src/lib/export.test.ts`, `src/components/editor/ParkLine.test.tsx`, `src/components/editor/TripPlanList.test.tsx`, `src/components/share/SharedTripView.test.tsx`, `src/components/editor/TripEditor.access.test.tsx`

**Interfaces:**
- Consumes: `AccessPoint.kind/trail` (Task 1).
- Produces: `parkText` accepts `access?: { name: string | null; kind?: "lot" | "road-end"; trail?: LngLat[] | null }`. For `kind "road-end"` with `trail` null the line ends with `" (no mapped trail)"` after the existing text; otherwise the existing format. `routePoint`, `routePoints`, `walkMinutes`, `stopWalkMinutes`, `googleMapsUrl`, `appleMapsUrls`, the Optimize request builder need no code change (they already read `access`); this task pins them.

- [ ] **Step 1: Write failing tests:**
  - `parkText({ name: "Delicate Arch", access: { name: "Road end", kind: "road-end", trail: [[...],[...]] }, walkMeters: 1070 }, "km")` returns `"Park at Road end, walk 1.1 km (~20 min) to Delicate Arch"`; the same with `trail: null` returns that string plus `" (no mapped trail)"`; a lot (no `kind`) is byte-identical to today; with `parkAt` the clock goes after "Road end" as for lots; unknown walk length: `"Park at Road end"` (plus the note when no trail).
  - `routePoint({ lat: 38.74, lng: -109.52, access: { lat: 38.75, lng: -109.51 } })` returns `[-109.51, 38.75]` (the road end, not the stop); `routePoints` maps the same.
  - `walkMinutes(1070)` is 20 and `walkMinutes(1559)` is 30 (4 km/h, rounded up to 5); `stopWalkMinutes({ access: { walkMeters: 1070, kind: "road-end" } })` is 20.
  - `googleMapsUrl`/`appleMapsUrls` for a stop with a road end use the road-end coordinates (follow the existing lot assertions in `export.test.ts`).
  - `ParkLine`, `TripPlanList` (My trip row) and `SharedTripView` (`data-testid="shared-park"`) render the "(no mapped trail)" text for a no-trail road end and the plain line for a mapped one; the My trip walk block shows the walk time (`hasWalkLength`).
  - `TripEditor.access.test.tsx`: Optimize's request carries `walkMinutes: 20` for the road-end stop and the coordinate sent is the road end (follow the existing lot test there).
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/lib/itinerary.test.ts src/components/editor/ParkLine.test.tsx` and the other files above. Expected: only the `parkText`/render tests FAIL; the `routePoint`, walk and links pins already PASS (they confirm no code change is needed).
- [ ] **Step 3: Implement** the `parkText` change and pass `kind`/`trail` from the three call sites.
- [ ] **Step 4: Run to verify pass** for the files above, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/itinerary.ts src/lib/itinerary.test.ts src/lib/route-points.test.ts src/lib/walk-time.test.ts src/lib/export.test.ts src/components/editor/ParkLine.tsx src/components/editor/ParkLine.test.tsx src/components/editor/TripPlanList.tsx src/components/editor/TripPlanList.test.tsx src/components/share/SharedTripView.tsx src/components/share/SharedTripView.test.tsx src/components/editor/TripEditor.access.test.tsx` and `git commit -m "feat(F3): park line for a road end, no mapped trail note"`.

---

### Task 7: Draw the trail on the map

**Files:**
- Create: `src/lib/trail-lines.ts` (+ `.test.ts`), `src/components/editor/trail-layer.ts` (+ `.test.ts`)
- Modify: `src/lib/map-theme.ts`, `src/components/editor/MapPanel.tsx` (init near line 269-335 and the effect near 443-454, mirroring `ensureHikeLayer`), `src/components/editor/FakeMapPanel.tsx`, `src/components/editor/TripEditor.tsx:1580` (`mapHikes`), `src/lib/lot-markers.ts` (only if the `P` label needs "Road end" handling; `lotLabel(null)` gives "Parking", so the road end's name "Road end" already shows)
- Test: `src/lib/map-theme.test.ts`, `src/components/editor/FakeMapPanel.test.tsx`, `src/components/editor/TripEditor.hike.test.tsx`, `src/lib/lot-markers.test.ts`

**Interfaces:**
- Produces:
  - `ACCESS_TRAIL_COLOR = "#8c6a35"` exported from `map-theme.ts` (a darker step of the route colour `#a8834b` in `MapPanel.tsx`, readable on the beige `path: "#978968"` roads; a hex because Mapbox paint cannot read CSS variables). If `MapPanel` switches `ROUTE_COLOR` by theme, follow the same switch.
  - `trailLines(stops: Pick<Stop, "id" | "lat" | "lng" | "access">[]): TrailLine[]` with `TrailLine = { id: string; geometry: LngLat[]; mapped: boolean }`: one per stop whose `access.kind === "road-end"`; mapped = the saved trail (geometry from road end to stop, forced to end exactly at the stop), unmapped = the straight `[road end, stop]`. Lots and stops without access produce none.
  - `ACCESS_TRAIL_SOURCE = "access-trail"`, `ACCESS_TRAIL_LAYER = "access-trail"`, `trailData(lines: TrailLine[]): FeatureCollection`, `ensureTrailLayer(map: mapboxgl.Map, lines: TrailLine[]): void` in `trail-layer.ts`: line layer, `line-dasharray [2, 1.5]`, `line-width` interpolate zoom 8 -> 2, 14 -> 3 (thinner than the route's `routeLineWidth()`), colour `ACCESS_TRAIL_COLOR`, inserted before `"route-casing"` when it exists (so it is under the route and, being a layer, under every DOM marker).
- Consumes: `AccessPoint.kind/trail` (Task 1).

- [ ] **Step 1: Write failing tests:**
  - `trailLines`: mapped road end gives its trail with `mapped true`; `trail: null` gives exactly two points `[road end, stop]` with `mapped false`; a lot and a stop with `access: null` give none; a trail not ending at the stop gets the stop appended.
  - `trailData` has one `LineString` feature per line with `properties.id` and `properties.mapped`.
  - `ensureTrailLayer` (a stub map object like `hike-layer` tests use): adds source and layer once, a second call only `setData`s, layer paint has the `ACCESS_TRAIL_COLOR` and a `line-dasharray`, `addLayer` called with `beforeId "route-casing"` when `getLayer("route-casing")` is truthy.
  - `map-theme.test.ts`: `ACCESS_TRAIL_COLOR` is a 7-char hex distinct from `MAP_COLORS.path`.
  - `FakeMapPanel.test.tsx`: a road-end stop renders an element `data-testid="access-trail"` per trail (dashed stroke), a no-trail one renders the straight one with `data-mapped="false"`, and a lot stop renders none.
  - `lot-markers.test.ts`: two stops sharing one road end (within 30 m) give one group with `count 2` and label `Parking ×2` (existing rule), and a single road end's label is `Road end`.
  - `TripEditor.hike.test.tsx`: with a stop whose access is a mapped road end, `mapHikes` (the hikes passed to the map) omits that stop's hike; a no-trail road end still passes its hike.
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/lib/trail-lines.test.ts src/components/editor/trail-layer.test.ts src/components/editor/FakeMapPanel.test.tsx src/lib/map-theme.test.ts src/lib/lot-markers.test.ts src/components/editor/TripEditor.hike.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules and wiring: in `MapPanel.tsx` call `ensureTrailLayer(map, trailsRef.current)` at the same two places `ensureHikeLayer` is called (map init and the style-reload effect) with `trailLines(stops)` kept in a ref; `FakeMapPanel` renders SVG polylines; filter `mapHikes` in `TripEditor.tsx` per Decisions ("Hike line vs trail").
- [ ] **Step 4: Run to verify pass**, then `npm run typecheck`. Expected: PASS. (The real Mapbox layer is exercised in e2e only against the fake map; the dashed paint is covered by the stub test; a visual check on the real map is an owner follow-up.)
- [ ] **Step 5: Commit** `git add src/lib/trail-lines.ts src/lib/trail-lines.test.ts src/components/editor/trail-layer.ts src/components/editor/trail-layer.test.ts src/lib/map-theme.ts src/lib/map-theme.test.ts src/components/editor/MapPanel.tsx src/components/editor/FakeMapPanel.tsx src/components/editor/FakeMapPanel.test.tsx src/components/editor/TripEditor.tsx src/components/editor/TripEditor.hike.test.tsx src/lib/lot-markers.test.ts` and `git commit -m "feat(F3): dashed trail layer from the road end to the stop"`. (`MapPanel.tsx` and `TripEditor.tsx` may carry other uncommitted work: use `git add -p`.)

---

### Task 8: Share page and PDF

**Files:**
- Modify: `src/components/share/SharedTripView.tsx` (no new prop: `MapView` already receives `stops`, which carry `access.trail`; confirm `mapStops` keeps `access`), `src/lib/static-map.ts`, `src/lib/itinerary-download.ts:93-100`, `src/lib/itinerary-pdf.ts:65-72, 133-140, 280-283`
- Test: `src/components/share/SharedTripView.test.tsx`, `src/app/s/[token]/page.test.tsx`, `src/lib/static-map.test.ts`, `src/lib/itinerary-download.test.ts`, `src/lib/itinerary-pdf.test.ts`, `src/server/mappers.test.ts`

**Interfaces:**
- Consumes: `trailLines` (Task 7), `TrailLine`.
- Produces: `staticMapUrl(a)` gains optional `trails?: LngLat[][]`; each trail is added as `path-2+<color>-0.9(<encoded polyline>)` after the route path (Mapbox static images have no dashes, so a thin solid line in `ACCESS_TRAIL_COLOR` without `#`), each downsampled to at most 20 points, dropped first (all of them) when the URL would pass `STATIC_MAP_MAX_URL`. `createItineraryPdf` and `renderItineraryPdf` gain `trails: TrailLine[]` (default `[]`); `drawFallbackMap` draws each trail with `doc.setLineDashPattern([1.5, 1], 0)` and resets the pattern afterwards.

- [ ] **Step 1: Write failing tests:**
  - `SharedTripView.test.tsx` (the test file uses `FakeMapPanel`): a shared trip with a road-end stop shows `data-testid="access-trail"`; the page text shows the "(no mapped trail)" note for a no-trail one; a share page never calls `api.resolveAccess` (no write or lookup from viewers).
  - `page.test.tsx`: `routeFor` passes road-end coordinates to `getDirections` (assert the coordinate argument).
  - `mappers.test.ts`: the public DTO exposes `access.trail` and `kind` but still no ids or tokens.
  - `static-map.test.ts`: with one 3-point trail the URL has one extra `path-2+8c6a35-0.9(` segment after the route path and `length <= STATIC_MAP_MAX_URL`; with enough long trails to exceed the limit the URL equals the no-trail URL; trails of 200 points are cut to 20.
  - `itinerary-pdf.test.ts`: rendering with a trail calls `setLineDashPattern` with `[1.5, 1]` and then resets it to `[]` (spy on the jsPDF doc as the existing tests do); rendering with no trails never calls it.
  - `itinerary-download.test.ts`: the PDF input's park line for a road-end stop equals `parkText` output including "(no mapped trail)".
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/components/share src/app/s src/lib/static-map.test.ts src/lib/itinerary-pdf.test.ts src/lib/itinerary-download.test.ts src/server/mappers.test.ts`. Expected: FAIL for the new assertions.
- [ ] **Step 3: Implement** the two signature changes and compute `trailLines(stops)` in the callers of `createItineraryPdf` (find them with `grep -rn "createItineraryPdf" src`).
- [ ] **Step 4: Run to verify pass**, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/components/share/SharedTripView.tsx src/components/share/SharedTripView.test.tsx "src/app/s/[token]/page.test.tsx" src/lib/static-map.ts src/lib/static-map.test.ts src/lib/itinerary-download.ts src/lib/itinerary-download.test.ts src/lib/itinerary-pdf.ts src/lib/itinerary-pdf.test.ts src/server/mappers.test.ts` and `git commit -m "feat(F3): trail on the share page map and in the PDF"`.

---

### Task 9: End-to-end check, docs, handoff and legal review

**Files:**
- Create: `e2e/trail-access.spec.ts`
- Modify: `README.md`, `docs/HANDOFF.md`, `docs/BACKLOG.md` (owner follow-ups), `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/components/legal/LegalPage.tsx` (`LEGAL_UPDATED`), `src/app/legal-pages.test.tsx`, `src/app/privacy/page.test.tsx` (as the review requires)

**Interfaces:** Consumes everything above through the fake externals (`fakeRoadEnd`, Task 3). Produces nothing new.

- [ ] **Step 1: Write the e2e spec** `e2e/trail-access.spec.ts` (pattern of `e2e/parking-route.spec.ts`, port 3100, fresh `e2e.db`): add a stop at `FAKE_ROAD_END_POINT`; wait for the access lookup; assert the stop card line matches `/Park at Road end, walk .* to /`, a `P` marker labelled "Road end" exists, and `[data-testid="access-trail"]` is visible; reload the trip and assert the line and trail persist (stored, not re-fetched: the second open makes no `POST /api/stops/:id/access`); add a stop near `FAKE_HIKE_POINT` and assert it still gets "Fake Trailhead Lot" (the lot wins) and no `access-trail`.
- [ ] **Step 2: Run it alone.** `npx playwright test e2e/trail-access.spec.ts` (own port, one browser; stop servers and browsers after, then `pgrep -fl "next|chrome-headless-shell"` shows none of yours). Expected: PASS.
- [ ] **Step 3: Docs.** README: one paragraph under the parking-lot feature: stops with no lot and more than 100 m from a road are routed to the nearest road a trail connects (OpenStreetMap), the trail is shown dashed, "no mapped trail" when none is found, the Mapbox walking fallback and its budget use. HANDOFF: task board row F3 moved to Archive with the verification numbers, "Just finished" line, the new migration name `20261123140000_stop_road_end` (applied to Turso by `vercel-build` on the next production deploy), owner follow-ups (look at a real Arches trip on the real map; confirm the five calls below), and the legal line. BACKLOG: any follow-up found.
- [ ] **Step 4: Legal review (CLAUDE.md privacy rule).** A stored trail polyline is a new stored field (and a new Overpass query and, as fallback, a Mapbox walking request carrying stop coordinates). Review `src/app/privacy/page.tsx` and `src/app/terms/page.tsx` against the code: say that a stop's saved parking spot may also be a road end with a short trail line from OpenStreetMap or Mapbox, stored with the stop and shown on shared pages; Mapbox now also receives a stop's coordinates and a road-end point for walking directions (only when OpenStreetMap has no trail); OpenStreetMap/Overpass receives the stop's area. Keep the section structure; update `LEGAL_UPDATED` to the day of the review (today is 2026-11-23); run `npx vitest run src/app/legal-pages.test.tsx src/app/privacy/page.test.tsx`. Mention "legal pages reviewed/updated" in the commit message and the HANDOFF line, and add a one-line owner note for the new stored data.
- [ ] **Step 5: Full verification.** `npm run typecheck`, `npm run lint`, full `npx vitest run` alone, `npm run build`, full e2e on its own port. Expected: all pass; report any skipped or failed item plainly.
- [ ] **Step 6: Commit** `git add e2e/trail-access.spec.ts README.md docs/HANDOFF.md docs/BACKLOG.md src/app/privacy/page.tsx src/app/terms/page.tsx src/components/legal/LegalPage.tsx src/app/legal-pages.test.tsx src/app/privacy/page.test.tsx` and `git commit -m "docs(F3): trail access, handoff, legal pages reviewed"`. No push until the owner says "push"; then the usual main push, tests and typecheck first, Vercel `photo-app-pi2o` and CI (`check`, `e2e`) checks.

---

## Self-review

- **Spec coverage:** nearest road + trail routing (Tasks 2, 3, 5); trail drawn dashed (7); road end acts like a lot in stop card, drive-time matrix for Optimize, share page, PDF, Maps links, schedule walk time (6, 8; routing, links, walk pinned by tests since they already read `access`); no-trail straight line + "no mapped trail" (2, 5, 6, 7); resolved lot wins (5, e2e in 9); one-time lookup stored, no Mapbox per view (5); 100 m threshold (2, 5); failure retried not "no road" (3, 5); Mapbox counted (4, 5); legal review (9).
- **Types:** `RoadEndChoice` (Task 2) and `RoadEndResult` (Task 3) have the same shape; `AccessPoint.kind/trail` (Task 1) are what Tasks 5-8 read; `TrailLine` (Task 7) is what Task 8 consumes; `trailLines` and `ensureTrailLayer` names are used consistently.
- **Proportion:** signatures, tests and assertions; no function bodies.
