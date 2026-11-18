# Parking-lot routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stop with a hike drives to its nearest real parking lot (saved on the stop) and the trail is drawn from that lot.

**Architecture:** The hike lookup (`src/server/hike`) is changed to prefer OSM parking lots, and now also returns the lot it started from (`Hike.access`). A new owner-only endpoint copies that onto the stop (four nullable columns). One shared helper `routePoints(stops)` makes every drive calculation (editor directions, Optimize, share page) use the lot instead of the stop. Itinerary text and PDF say "Park at X, walk N to Y".

**Tech Stack:** Next.js 16, Prisma + libsql (additive migration, applied by `vercel-build`), vitest (`db-and-server` project for DB tests), Playwright e2e with fake externals.

**Spec:** `docs/superpowers/specs/2026-11-17-parking-access-point-design.md` (read its "Calls made after the builder check": they win over the earlier text). One deliberate refinement of the spec, decided here: the lookup tries OpenStreetMap first and NPS second (see Task 2), so the drawn walk always starts at the lot the car goes to.

## Global Constraints

- Migration is additive and nullable only (previous app version must keep working against the new schema).
- Access point rules: lot within 2.5 km of the stop (existing `HIKE_RADIUS_M`), within 150 m of a trail (existing `snapTrailheadM`), nearest by walking distance first; parking first, then trailhead markers; a trail dead end is never an access point; null when the lot is within 150 m of the stop.
- Lookup never blocks saving a stop. Failed lookup (service down) leaves `accessResolvedAt` null; a finished lookup with or without a lot sets it. Moving a stop (PATCH with `lat`/`lng`) clears `accessLat`, `accessLng`, `accessName`, `accessResolvedAt`.
- At most 3 resolve calls in flight from the editor. Share-page viewers never trigger resolves or writes.
- `accessName`: OSM `name` tag, trimmed, at most 120 characters, null when absent.
- Stop markers stay at the stop's own coordinates; a parking marker is added at the access point for the selected stop.
- Never print or commit secrets. No new third party and no new data sent anywhere (same Overpass/NPS lookups), so no legal wording change is expected; the daily legal review still runs before the push.
- Repo rules: the migration folder is named `20261117120000_stop_access_point`. Run the full vitest suite alone; e2e on its own port; typecheck and `npm run lint` clean. Agents work in the main tree on disjoint files (see Execution order), never run more than 3 at once, and stop every server and browser they start. Do not push; the owner says "push".

## Execution order (owner: split across agents if it makes a better product)

Each task goes to a fresh Sonnet implementer, then a fresh Sonnet reviewer, before the next gate. Tasks share interfaces, so they run in these batches:

1. **Batch 1, in parallel:** Task 1 (database, types, mapper) and Task 2 (hike lookup). Different files, no shared interface.
2. **Batch 2, in parallel:** Task 3 (resolve endpoint; needs 1 and 2) and Task 5 (itinerary text; needs only 1). Different files.
3. **Batch 3:** Task 4 (editor, Optimize, share page; needs 3).
4. **Batch 4:** Task 6 (e2e and docs), alone, because it runs the browser suite.
5. Then SEC and FINAL (Opus), run by the lead.

Parallel agents edit different files in the same tree; the lead runs typecheck between batches and resolves any fixture conflicts from the new required `Stop` fields in Task 1 (Task 1 owns all fixture updates).

## Review Focus

- Moving a stop (PATCH `lat`/`lng`) with an access point set: all four columns must clear (Task 3 test).
- Overpass down or timing out during resolve: stop saved fine, `accessResolvedAt` stays null, route still goes to the stop, next open retries (Task 3 test).
- Lot within 150 m of the stop: stored as "resolved, no access point" (Task 2 + Task 3 tests).
- A trail whose only start is a dead end: no access point, hike line still drawn as today (Task 2 test).
- Opening a trip with 25 stops needing resolves: never more than 3 requests in flight, a deleted stop mid-resolve is ignored (Task 4 test).
- Optimize and light/sunrise maths receive lot coordinates instead of stop coordinates; a lot is at most a few km away so sun times shift by seconds; accepted, noted in the README.

---

### Task 1: Database columns, types and mapper

**Files:**
- Create: `prisma/migrations/20261117120000_stop_access_point/migration.sql`
- Modify: `prisma/schema.prisma` (model `Stop`), `src/lib/types.ts` (`Stop`, `PublicStop`), `src/server/mappers.ts` (`toStopDto`, `toPublicTripDto`), `src/lib/api-shapes.ts` (stop shape check), the fixtures/builders that construct a `Stop` in tests (typecheck lists them)
- Test: `src/server/mappers.test.ts`

**Interfaces:**
- Produces: `type AccessPoint = { lat: number; lng: number; name: string | null }` in `src/lib/types.ts`; `Stop` gains `access: AccessPoint | null` and `accessResolvedAt: string | null` (ISO); `PublicStop` gains `access` (not `accessResolvedAt`). Prisma `Stop` gains `accessLat Float?`, `accessLng Float?`, `accessName String?`, `accessResolvedAt DateTime?`.

- [ ] **Step 1: Failing test** in `mappers.test.ts`: `toStopDto` of a row with `accessLat: 1, accessLng: 2, accessName: "North lot", accessResolvedAt: <Date>` returns `access: { lat: 1, lng: 2, name: "North lot" }` and an ISO `accessResolvedAt`; a row with null lat or lng returns `access: null` even if a name is set; `toPublicTripDto` stops carry `access` and no `accessResolvedAt`.
- [ ] **Step 2: Run** `npx vitest run src/server/mappers.test.ts`; expect FAIL.
- [ ] **Step 3:** Add the four nullable columns to `schema.prisma`; write the migration SQL as four `ALTER TABLE "Stop" ADD COLUMN` statements (no defaults, no NOT NULL); run `npx prisma generate`; update types, mapper and the API shape validator (a stop without the new fields from an old cached response must still validate: treat missing as null).
- [ ] **Step 4:** Fix every typecheck error from the new required `Stop` fields in test fixtures (use `access: null, accessResolvedAt: null`). Run `npm run typecheck` and the mapper test; expect PASS.
- [ ] **Step 5: Commit** `git add prisma src && git commit -m "feat: stop access point columns, types and mapper"`

### Task 2: Hike lookup returns the lot it starts from

**Files:**
- Modify: `src/server/hike/osm.ts` (query + `parseOsm` + `OsmTrails`), `src/server/hike/graph.ts` (`HikePath`, `FindOptions`), `src/server/hike/service.ts` (`lookupHike`, `toHike`), `src/lib/hike.ts` (`Hike`, `isHike`), `src/server/external/fake.ts` (`fakeHike`), `src/lib/hike-cache.ts` only if it re-validates the shape
- Test: `src/server/hike/osm.test.ts`, `graph.test.ts`, `service.test.ts` (existing files; update expectations that change), fixture `src/server/hike/fixtures/osm-delicate-arch.json` stays

**Interfaces:**
- Produces: `type Lot = { point: LngLat; name: string | null }`; `OsmTrails = { segments: LngLat[][]; trailheads: Lot[]; parking: Lot[] }`; `HikePath` gains `start: { kind: "dead-end" } | { kind: "tier"; tier: number; index: number }` where `index` is the position in the `trailheadTiers[tier]` array passed in; `Hike` gains `access: { lat: number; lng: number; name: string | null } | null`.
- Consumes: Task 1 none (independent). Later tasks read `Hike.access` from `getHike(lat, lng)` in `src/server/hike/service.ts`.

- [ ] **Step 1: Failing tests:**
  - `osm.test.ts`: `osmHikeQuery` contains `nwr["amenity"="parking"]` with `out tags geom center` semantics (way/relation parking returned with a `center`), and `parseOsm` reads a parking way with `center: {lat, lon}` and `tags.name: "Arch lot"` into `parking: [{ point: [lon, lat], name: "Arch lot" }]`; a parking way without `center` is skipped; a parking with `access=private`/`access=no` is skipped; name trimmed and cut to 120 characters.
  - `graph.test.ts`: with tiers `[parkingPoints, trailheadPoints]` and a parking point snapped within 150 m of a trail, `findHikePath` returns `start: { kind: "tier", tier: 0, index: <i> }` even when a trailhead is closer by walking; with no tier point snapping, `start.kind` is `"dead-end"`.
  - `service.test.ts`: OSM answer with a reachable parking lot gives `hike.access = { lat, lng, name }` (the lot's own coordinates, not the trail node); a dead-end start gives `access: null` and the same hike line as before; a lot within 150 m of the place gives `access: null`; with NPS trails available too, the OSM lot walk is returned (source `"osm"`); with OSM down and NPS up, the NPS hike is returned with `access: null`.
- [ ] **Step 2: Run** the three files; expect FAIL.
- [ ] **Step 3: Implement:**
  - `osm.ts`: query uses `nwr["amenity"="parking"]` and `out tags geom center qt`; `parseOsm` builds `Lot` values (nodes use `lat`/`lon`, ways and relations use `center`).
  - `graph.ts`: `findHikePath` reports `start` as above (record which tier and index produced the chosen start node).
  - `service.ts`, new order in `lookupHike`: (1) OSM with `trailheadTiers = [parking points, trailhead points]`; if the path starts at a tier, return it with `access` from that lot unless the lot is within 150 m of the place (then `access: null` but keep the hike); (2) otherwise NPS trails (`access: null`); (3) otherwise the OSM dead-end path (`access: null`). `failed` semantics unchanged. `toHike` gets the optional lot.
  - `hike.ts`: `isHike` accepts a missing `access` (treated as null) and validates it when present.
  - `fake.ts`: `fakeHike` adds `access: { lat: geometry[0][1], lng: geometry[0][0], name: "Fake Trailhead Lot" }`.
- [ ] **Step 4: Run** the hike test files and `npx vitest run src/lib/hike` ; expect PASS. Update snapshots only for the intended tier-order change.
- [ ] **Step 5: Commit** `feat: hike lookup prefers parking lots and returns the lot`

### Task 3: Resolve endpoint and clearing on move

**Files:**
- Create: `src/server/stop-access.ts`, `src/app/api/stops/[id]/access/route.ts`
- Modify: `src/server/stops.ts` (`updateStopCascade` clears the four columns when `patch.lat` or `patch.lng` is present), `src/lib/api-client.ts`, `src/server/rate-limit.ts` usage only (reuse the `hike` limit key)
- Test: `src/server/stop-access.test.ts` (db-and-server project), `src/app/api/stops/[id]/access/route.test.ts`, extend `src/server/stops.test.ts`

**Interfaces:**
- Consumes: `getHike(lat: number, lng: number): Promise<Hike | null>` and its failure behaviour. Because `getHike` returns null both for "no hike" and for "service down", add `lookupHikeStatus(lat, lng): Promise<{ hike: Hike | null; failed: boolean }>` to `src/server/hike/service.ts` as a cached sibling of `getHike` (same cache and in-flight sharing) so the resolver can tell the two apart.
- Produces: `resolveStopAccess(userId: string, stopId: string): Promise<Stop | null>` (null when the stop is not the user's); `api.resolveAccess(stopId: string): Promise<{ stop: Stop }>` in `api-client.ts`; `POST /api/stops/:id/access` returning `{ stop }` (401 signed out, 404 not owner, 429 over the limit).

- [ ] **Step 1: Failing tests:**
  - `stop-access.test.ts` (fake externals or injected lookup): a stop whose hike has a lot gets `access` and `accessResolvedAt` set; a hike with `access: null` and no failure sets `accessResolvedAt` and leaves access null; `failed: true` leaves everything null (including `accessResolvedAt`); another user's stop returns null and writes nothing.
  - `stops.test.ts`: `updateStop` with `{ lat, lng }` on a stop that has all four columns set clears all four; a patch of `{ name }` leaves them.
  - route test: 401 with no session; 200 and `stop.access` for the owner; 404 for a stop of another user.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement** `resolveStopAccess` (read stop, `lookupHikeStatus`, write the four columns in one update only if the stop's `lat`/`lng` are unchanged since read, so a move during the lookup is not overwritten); route uses `requireUserId`, `enforceLimit("access")`, `handle`; `updateStopCascade` adds the clearing columns to `data` when `patch.lat !== undefined || patch.lng !== undefined`; client method added with the stop shape check.
- [ ] **Step 4: Run** the three test files and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat: resolve and save a stop's parking access point`

### Task 4: Routing uses the lot (editor, Optimize, share page)

**Files:**
- Create: `src/lib/route-points.ts`, `src/components/editor/use-access-resolver.ts`
- Modify: `src/components/editor/TripEditor.tsx` (`waypointKey` at ~364, `optimizeOrder` calls at ~807 and ~900 use `routePoints`; mount the resolver; merge returned stops into state), `src/app/s/[token]/page.tsx` (`routeFor`), `src/components/editor/MapPanel.tsx` (parking marker), shared trip view if it draws the route
- Test: `src/lib/route-points.test.ts`, `src/components/editor/use-access-resolver.test.tsx`, extend `TripEditor.f2.test.tsx` or `TripEditor.test.tsx`

**Interfaces:**
- Produces: `routePoint(stop: { lat: number; lng: number; access?: { lat: number; lng: number } | null }): LngLat` (`[access.lng, access.lat]` when set, else `[lng, lat]`); `routePoints(stops: ...[]): LngLat[]`; `useAccessResolver(stops: Stop[], onStop: (s: Stop) => void, opts?: { maxInFlight?: number }): void` (default 3) that calls `api.resolveAccess` for stops with `accessResolvedAt === null`, once per stop id per mount, ignoring results for stops no longer in the list.
- Consumes: `api.resolveAccess` (Task 3), `Stop.access` (Task 1).

- [ ] **Step 1: Failing tests:**
  - `route-points.test.ts`: with and without `access`; order preserved.
  - `use-access-resolver.test.tsx`: 25 stops with `accessResolvedAt: null`, deferred `api.resolveAccess`: never more than 3 pending at once, each stop resolved once; a stop removed from the list while pending is ignored; a rejected call does not retry in the same mount and does not throw.
  - editor test: a stop with `access` makes `api.directions` receive the lot coordinates for that stop; after `onStop` delivers an access point to a stop that had none, `api.directions` is called again with the new coordinates (existing stale-response cancel logic keeps only the latest).
  - share-page test (or `routeFor` unit test): `getDirections` receives lot coordinates.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement** the helper and hook; replace the three coordinate builders; MapPanel draws a small "P" marker at `access` for the selected stop only (own layer, same colour tokens as the hike line; accessible name "Parking for <stop name>"); call `useAccessResolver` in `TripEditor` and merge each returned stop into the stop list the same way `updateStop` results are merged; call `api.resolveAccess` for a newly added stop through the same hook (a new stop has `accessResolvedAt: null`, so the hook covers it).
- [ ] **Step 4: Run** the new tests, the existing editor tests, `npm run typecheck`, `npm run lint`; expect PASS.
- [ ] **Step 5: Commit** `feat: drive routes go to the parking lot`

### Task 5: Itinerary, PDF and share view text

**Files:**
- Modify: `src/lib/itinerary.ts`, `src/lib/itinerary-pdf.ts`, the shared trip view component that lists stops, `src/lib/export.ts` if it lists stops
- Test: `src/lib/itinerary.test.ts`, `src/lib/itinerary-pdf.test.ts`, shared view test

**Interfaces:**
- Consumes: `Stop.access` / `PublicStop.access`. Produces: itinerary stop input accepts `access?: { name: string | null } | null` plus the walk distance (`hike?: { distanceMeters: number }`) already available to callers, or omits the walk part when unknown.

- [ ] **Step 1: Failing tests:** a stop with `access: { name: "North lot" }` renders `Park at North lot, walk 1.2 mi to <stop>` (unit setting honoured); with `name: null` renders `Park at the parking lot, walk ...`; without access nothing changes; the PDF text contains the line (use the existing `itinerary-pdf.test.ts` text extraction style); the line passes through the existing text sanitising for PDF fonts.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement** in the three text outputs using the existing `formatHikeDistance` from `src/lib/hike.ts`.
- [ ] **Step 4: Run** the three test files; expect PASS.
- [ ] **Step 5: Commit** `feat: itinerary says where to park`

### Task 6: End-to-end test, docs and legal review

**Files:**
- Create: `e2e/parking-route.spec.ts`
- Modify: existing specs whose expected route or hike distance shifts (the run will show which), `README.md` (hike/route section; note the sun-time approximation), `docs/design/A53-DESIGN.md` (parking first, OSM first), `docs/HANDOFF.md`, legal pages only if the review finds a claim that changed

**Interfaces:** consumes everything above; produces nothing.

- [ ] **Step 1: Write the e2e** (fake externals, stop near `FAKE_HIKE_POINT`): add the stop; wait for the parking marker named "Parking for <stop>"; assert the route request (`/api/directions` body) ends at the fake lot coordinates and not the stop's; assert the dotted hike line's first point is the lot; assert the share page route request does the same; assert a stop away from the fake hike point still routes to itself.
- [ ] **Step 2: Run** `e2e/parking-route.spec.ts` alone on its own port; expect PASS. Then run the full e2e suite alone and fix expectations that legitimately moved (routes now end at the fake lot); do not weaken assertions that guard other behaviour.
- [ ] **Step 3:** Update docs. Run the project's daily legal review (CLAUDE.md "Privacy Policy and Terms"): this change adds a stored field per stop (access point) and the same provider lookups; update the pages only if a claim changed, bump `LEGAL_UPDATED` to the day of the push, mention the review in the commit message.
- [ ] **Step 4:** Run typecheck, lint, full vitest alone, `npm run build`.
- [ ] **Step 5: Commit** `test: parking route e2e; docs`

### After the tasks (board rows A85 to FINAL)

SEC (`/security-review`, Opus), then FINAL: Opus full check, stop before merge and push with status `(push)`; on the owner's "push": tests and typecheck, push to `main`, check Vercel (`photo-app-pi2o`) and CI (`check`, `e2e`). The Turso migration runs automatically during the Vercel build.
