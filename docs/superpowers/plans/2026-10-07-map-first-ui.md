# Map-First UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the app into a Google-Maps-style planner: a full-screen map with search-as-you-type, click-to-add places, draggable numbered stops, a floating stops panel (bottom sheet on phones), and trips that are just ordered stops (no start/end fields).

**Architecture:** Evolve the existing Next.js editor. Keep the data layer, API routes, best-time logic, suggestions and tests; change the `Trip` model (drop start/end), add geocode proximity/autocomplete plus reverse-geocode, give the map components a richer contract, and rebuild `TripEditor` as map + overlays (search bar, place/stop cards, `StopsPanel`).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Prisma 7 (SQLite locally, Turso on Vercel), Mapbox GL + Mapbox Geocoding/Directions, Tailwind v4, dnd-kit, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-map-first-ui-design.md`

## Global Constraints

- A trip has **no start/end**: it is an ordered list of stops; first stop = start, last = end. `Trip` keeps only `id`, `name`, `plannedDate` (+ timestamps in the DB).
- Best-time: departure is sunrise at the **first stop** on the planned date; arrival at stop *i* = departure + sum of leg durations before it. With fewer than 2 stops (or no route) fall back to the evening-golden-hour default.
- Route is drawn only with 2+ stops; Mapbox Directions waypoint cap stays `MAX_ROUTE_WAYPOINTS = 25`.
- Search: debounce 250 ms, minimum 2 characters, up to 5 results, biased to the map center; stale responses are ignored. Reverse-geocode only on a map click.
- Add-stop popup is an on-map card (`PlaceCard`) with one **Add stop** button that appends to the end of the list (no set-as-start/end).
- Photo limit stays 4 MB; photos stay behind the ownership-checked `/api/uploads/` route.
- Offline fake mode (`EXTERNAL_APIS_FAKE=1`, `NEXT_PUBLIC_MAP_FAKE=1`) must keep working for the e2e test: fake geocode results fall in lat 36–38, lng −121…−118, and the fake map's fixed viewport is exactly that box.
- Out of scope: turn-by-turn directions, alternative routes, offline map downloads, caching reverse-geocode results.
- Read `AGENTS.md` first: this Next.js has breaking changes; consult `node_modules/next/dist/docs/` before touching Next-specific APIs.
- TDD for every task (RED then GREEN, one behaviour at a time). The `tdd-guard` plugin is disabled for this project; reviewers check the RED/GREEN evidence instead.
- Standing rules (from `HANDOFF.md`): all implementers and reviewers run on Sonnet; after the last task run the whole-branch review plus the two extra read-only passes (bug-hunting, security); log progress in `PROGRESS.md` at each phase boundary.
- Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run e2e`. Work on branch `map-first-ui`; merge to `main` only when all of them pass (pushing `main` auto-deploys to Vercel and applies migrations to Turso).
- The Playwright test is intentionally broken between Task 1 and Task 9; do not run `npm run e2e` before Task 9.

## File Structure

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/20261007120000_drop_trip_start_end/` | Drop the six start/end columns from `Trip` |
| `src/lib/types.ts`, `src/lib/validation.ts` | `Trip` DTO and trip/stop/geocode schemas without start/end; stop PATCH accepts `lat`/`lng` |
| `src/lib/best-time.ts` | Departure from first stop; `computeArrivals`; `computeBestTimes` |
| `src/lib/geo.ts` | `coordsLabel` helper |
| `src/lib/use-debounced-value.ts` | Debounce hook |
| `src/server/external/mapbox.ts`, `fake.ts` | `geocode` with proximity/autocomplete, `reverseGeocode`, fakes |
| `src/app/api/geocode/route.ts`, `src/app/api/reverse-geocode/route.ts` | HTTP endpoints |
| `src/lib/api-client.ts` | `geocode(q, proximity?)`, `reverseGeocode(lat, lng)` |
| `src/components/editor/map-types.ts`, `FakeMapPanel.tsx`, `MapPanel.tsx` | Map contract + fake and real implementations |
| `src/components/editor/SearchBar.tsx` | As-you-type search overlay |
| `src/components/editor/PlaceCard.tsx`, `StopCard.tsx` | On-map cards for a candidate place / an existing stop |
| `src/components/editor/StopsPanel.tsx` | Floating panel / bottom sheet with Stops + Suggestions tabs |
| `src/components/editor/StopList.tsx`, `SuggestionsPanel.tsx` | Start/End labels; hover callback |
| `src/components/editor/TripEditor.tsx` | Orchestrates map + overlays + panel |
| `src/components/trips/NewTripForm.tsx`, `editor/TripHeader.tsx` | Name + date only |
| `e2e/golden-path.spec.ts` | Rewritten golden path |

---

## Phase 1 — Data model, API and logic

### Task 1: Drop start/end from Trip (atomic, whole-app)

This task must leave the app compiling and every unit test green, so it touches every layer. Do the steps in order.

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/types.ts`, `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/lib/best-time.ts`, `src/lib/best-time.test.ts`, `src/lib/geo.ts`, `src/server/mappers.ts`, `src/server/trips.ts`, `src/server/db.test.ts`, `tests/helpers/db.ts`, `src/components/editor/TripEditor.tsx`, `src/components/editor/TripEditor.test.tsx`, `src/components/editor/map-types.ts`, `src/components/editor/MapPanel.tsx`, `src/components/editor/FakeMapPanel.tsx`, `src/components/editor/FakeMapPanel.test.tsx`, `src/components/editor/TripHeader.tsx`, `src/components/editor/TripHeader.test.tsx`, `src/components/trips/NewTripForm.tsx`, `src/components/trips/NewTripForm.test.tsx`, `src/components/trips/TripList.test.tsx`
- Create: `prisma/migrations/20261007120000_drop_trip_start_end/migration.sql`
- Delete: `src/components/PlaceSearch.tsx`, `src/components/PlaceSearch.test.tsx`

**Interfaces:**
- Produces: `Trip = { id: string; name: string; plannedDate: string }`; `tripInputSchema = { name, plannedDate }`; `departureTime(first: {lat; lng}, plannedDate): Date`; `estimateArrivals(departure, legDurations, stopCount): Date[] | null` where legs = `stopCount - 1`; `computeArrivals(trip: {plannedDate; stops}, legDurations: number[] | null): (Date | null)[]`; `computeBestTimes(trip: {plannedDate; stops}, legDurations)`; `coordsLabel({lat, lng}): string` in `src/lib/geo.ts`.

- [ ] **Step 1: Write failing best-time tests**

In `src/lib/best-time.test.ts` replace the `estimateArrivals` and `computeBestTimes` describe blocks with:

```ts
describe("estimateArrivals", () => {
  it("departs at the first stop and accumulates leg durations (seconds)", () => {
    expect(estimateArrivals(at("06:00"), [3600, 1800], 3)).toEqual([at("06:00"), at("07:00"), at("07:30")]);
  });

  it("returns an empty list for no stops", () => {
    expect(estimateArrivals(at("06:00"), [], 0)).toEqual([]);
  });

  it("returns null when the legs don't line up with the stops", () => {
    expect(estimateArrivals(at("06:00"), [3600], 3)).toBeNull();
  });
});

describe("computeBestTimes", () => {
  const stops = [TUNNEL_VIEW, { lat: 37.75, lng: -119.6 }];

  it("returns one result per stop, defaulting to golden hour without legs", () => {
    const result = computeBestTimes({ plannedDate: "2026-07-01", stops }, null);
    expect(result).toHaveLength(2);
    expect(result[0]!.window).toBe("golden hour");
  });

  it("departs at sunrise from the first stop, so it is a sunrise shot", () => {
    const [first, second] = computeBestTimes({ plannedDate: "2026-07-01", stops }, [3600]);
    expect(first!.window).toBe("sunrise");
    expect(second!.window).toBe("midday"); // ~1 h after sunrise, after morning golden hour
  });

  it("uses the default for a single stop even if legs are given", () => {
    const [only] = computeBestTimes({ plannedDate: "2026-07-01", stops: [TUNNEL_VIEW] }, []);
    expect(only!.window).toBe("golden hour");
  });
});

describe("computeArrivals", () => {
  it("returns null entries without a usable route", () => {
    expect(computeArrivals({ plannedDate: "2026-07-01", stops: [TUNNEL_VIEW, FRESNO] }, null)).toEqual([null, null]);
  });

  it("returns the departure for the first stop and later arrivals after it", () => {
    const [a, b] = computeArrivals({ plannedDate: "2026-07-01", stops: [TUNNEL_VIEW, FRESNO] }, [3600]);
    expect(b!.getTime() - a!.getTime()).toBe(3600_000);
  });
});
```

Update the import line at the top of the file to `import { classifyBestTime, computeArrivals, computeBestTimes, describeBestTime, estimateArrivals, getSunWindows, solarDayAnchor } from "./best-time";` (keep any other names already imported). `FRESNO` and `TUNNEL_VIEW` are already defined in that test file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/best-time.test.ts`
Expected: FAIL (`computeArrivals` is not exported, and the new expectations for `estimateArrivals` differ).

- [ ] **Step 3: Implement best-time changes**

In `src/lib/best-time.ts` replace everything from the `estimateArrivals` doc comment to the end of `computeBestTimes` with:

```ts
/**
 * Arrival at each stop. The first stop is the departure point; each later stop is
 * departure + cumulative leg durations (seconds). Legs run stop1 -> stop2 -> ...,
 * so there must be stopCount - 1 of them.
 */
export function estimateArrivals(
  departure: Date,
  legDurations: number[],
  stopCount: number,
): Date[] | null {
  if (stopCount === 0) return [];
  if (legDurations.length !== stopCount - 1) return null;
  const arrivals: Date[] = [departure];
  let elapsedMs = 0;
  for (const seconds of legDurations) {
    elapsedMs += seconds * 1000;
    arrivals.push(new Date(departure.getTime() + elapsedMs));
  }
  return arrivals;
}

/** D1: depart at sunrise from the first stop; ~8 AM solar time when there is no sunrise. */
export function departureTime(first: Pick<Stop, "lat" | "lng">, plannedDate: string): Date {
  const w = getSunWindows(first.lat, first.lng, plannedDate);
  return w.sunrise ?? new Date(solarDayAnchor(plannedDate, first.lng).getTime() - 4 * 3_600_000);
}

type TripForTimes = { plannedDate: string; stops: Pick<Stop, "lat" | "lng">[] };

/** Estimated arrival per stop, or nulls when there are fewer than 2 stops or no matching route. */
export function computeArrivals(trip: TripForTimes, legDurations: number[] | null): (Date | null)[] {
  const none = trip.stops.map(() => null);
  if (!legDurations || trip.stops.length < 2) return none;
  return estimateArrivals(departureTime(trip.stops[0], trip.plannedDate), legDurations, trip.stops.length) ?? none;
}

export function computeBestTimes(trip: TripForTimes, legDurations: number[] | null): BestTime[] {
  const arrivals = computeArrivals(trip, legDurations);
  return trip.stops.map((s, i) => classifyBestTime(getSunWindows(s.lat, s.lng, trip.plannedDate), arrivals[i] ?? null));
}
```

Also change the import at the top of `best-time.ts` to `import type { Stop } from "./types";` (drop `Place`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/best-time.test.ts`
Expected: PASS.

- [ ] **Step 5: Schema, migration and generated client**

In `prisma/schema.prisma` delete the six lines `startName`, `startLat`, `startLng`, `endName`, `endLat`, `endLng` from `model Trip`.

Create `prisma/migrations/20261007120000_drop_trip_start_end/migration.sql`:

```sql
-- Trips are now just ordered stops; the start/end columns are no longer used.
ALTER TABLE "Trip" DROP COLUMN "startName";
ALTER TABLE "Trip" DROP COLUMN "startLat";
ALTER TABLE "Trip" DROP COLUMN "startLng";
ALTER TABLE "Trip" DROP COLUMN "endName";
ALTER TABLE "Trip" DROP COLUMN "endLat";
ALTER TABLE "Trip" DROP COLUMN "endLng";
```

Run: `DATABASE_URL=file:./dev.db npx prisma generate`
Expected: "Generated Prisma Client". (SQLite 3.35+ supports `DROP COLUMN`; none of these columns are indexed.)

- [ ] **Step 6: Types, validation and server layer**

`src/lib/types.ts`: change `Trip` to

```ts
export type Trip = {
  id: string;
  name: string;
  /** Calendar date, "YYYY-MM-DD". */
  plannedDate: string;
};
```
and change the `RouteResult.legs` comment to `/** One leg per consecutive stop pair: stop1 -> stop2 -> ... */`.

`src/lib/validation.ts`: delete `placeSchema`; change `tripInputSchema` to

```ts
export const tripInputSchema = z.object({
  name: z.string().trim().min(1, "Trip name is required").max(120),
  plannedDate: dateOnlySchema,
});
```
and change the directions message `"A route needs a start and an end"` to `"A route needs at least 2 stops"`.

`src/lib/validation.test.ts`: set `validTrip = { name: "Sierra loop", plannedDate: "2026-07-01" }` and replace the "rejects out-of-range coordinates" test with:

```ts
  it("ignores legacy start/end fields", () => {
    const parsed = tripInputSchema.parse({ ...validTrip, start: { name: "x", lat: 95, lng: 0 } });
    expect(parsed).toEqual(validTrip);
  });
```

`src/server/mappers.ts`: `toTripDto` returns only `{ id, name, plannedDate: utcToDateOnly(row.plannedDate) }`.

`src/server/trips.ts`: `patchData` becomes

```ts
function patchData(patch: TripPatch) {
  return {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.plannedDate && { plannedDate: dateOnlyToUtc(patch.plannedDate) }),
  };
}
```
and `createTrip`'s `data` becomes `{ userId, name: input.name, plannedDate: dateOnlyToUtc(input.plannedDate) }`.

`tests/helpers/db.ts`: `sampleTripInput = { name: "Sierra loop", plannedDate: "2026-07-01" }`.

`src/server/db.test.ts`: the `prisma.trip.create` data becomes `{ userId: user.id, name: "t", plannedDate: new Date("2026-07-01T00:00:00Z") }`.

`src/lib/geo.ts`: append

```ts
export function coordsLabel(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}
```

- [ ] **Step 7: Run server and lib tests**

Run: `npx vitest run src/lib src/server tests/api`
Expected: PASS (UI tests are fixed next; ignore `typecheck` until Step 10).

- [ ] **Step 8: UI — editor, maps, header, new-trip form**

Delete `src/components/PlaceSearch.tsx` and `src/components/PlaceSearch.test.tsx`.

`src/components/editor/map-types.ts`: remove `start`/`end` and the `Place` import:

```ts
import type { LngLat, Stop } from "@/lib/types";

export type MapViewProps = {
  stops: Stop[];
  routeGeometry: LngLat[] | null;
  onMapClick: (p: { lat: number; lng: number }) => void;
  onStopClick: (stopId: string) => void;
};
```

`src/components/editor/FakeMapPanel.tsx`: drop `start`/`end` props and the two `<Dot>` usages (delete the `Dot` helper too); compute `const bounds = boundsFor(stops.length ? stops : DEFAULT_POINTS);` with `const DEFAULT_POINTS = [{ lat: 36, lng: -121 }, { lat: 38, lng: -118 }];`.

`src/components/editor/FakeMapPanel.test.tsx`: remove `start`/`end` constants and props; the click test now expects `lat` ≈ 37 and `lng` ≈ −119.5 (default bounds centre); the stop-click test is unchanged apart from props. Rename the first test to "converts a click position into lat/lng within the default bounds".

`src/components/editor/MapPanel.tsx`: remove `start`/`end` from the props and the two start/end markers; `initialCenterRef` becomes `useRef<LngLat>(stops[0] ? [stops[0].lng, stops[0].lat] : [-98.5, 39.8])` and the initial zoom is `stops.length ? 7 : 3.5`; the markers effect depends on `[stops]`.

`src/components/editor/TripHeader.tsx`: remove the `PlaceSearch` import, the `start`/`end` state, their reset in `beginEdit`, the two `<PlaceSearch>` elements and the `{trip.start.name} → {trip.end.name}` line; `onSave({ name, plannedDate })`.

`src/components/editor/TripHeader.test.tsx`: `trip` has only `id`, `name`, `plannedDate`; delete the `getByText("Fresno → Lee Vining")` assertion; the save assertion becomes `toHaveBeenCalledWith({ name: "Eastern Sierra", plannedDate: "2026-07-01" })`.

`src/components/trips/NewTripForm.tsx`: remove `PlaceSearch`, `Place`, the `start`/`end` state, the start/end validation and the two `<PlaceSearch>` elements; `api.createTrip({ name, plannedDate })`.

`src/components/trips/NewTripForm.test.tsx`: delete the `PlaceSearch` mock and the "requires start and end" test; the create test becomes:

```tsx
  it("creates the trip and opens the editor", async () => {
    vi.mocked(api.createTrip).mockResolvedValue({ trip: { id: "t9" } as never });
    render(<NewTripForm today="2026-07-01" />);
    await userEvent.type(screen.getByLabelText("Trip name"), "Sierra loop");
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
    expect(api.createTrip).toHaveBeenCalledWith({ name: "Sierra loop", plannedDate: "2026-07-01" });
    expect(push).toHaveBeenCalledWith("/trips/t9");
  });
```

`src/components/trips/TripList.test.tsx`: delete the `start:`/`end:` line from the fixture.

`src/components/editor/TripEditor.tsx` (interim edits; Task 8 rewrites this file):
- Replace the `waypointKey` block and the directions effect with:

```tsx
  const waypointKey = JSON.stringify(stops.map((s) => [s.lng, s.lat]));

  useEffect(() => {
    const coordinates = JSON.parse(waypointKey) as LngLat[];
    if (coordinates.length < 2) return;
    let cancelled = false;
    api.directions(coordinates).then(
      ({ route: next }) => {
        if (cancelled) return;
        setRoute(next);
        setRouteError(null);
      },
      (e: unknown) => {
        if (cancelled) return;
        setRoute(null);
        setRouteError(errorMessage(e, "Couldn't load the route"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [waypointKey]);

  const enoughForRoute = stops.length >= 2;
  const activeRoute = enoughForRoute ? route : null;
  const activeRouteError = enoughForRoute ? routeError : null;
```
- Use `activeRoute`/`activeRouteError` everywhere `route`/`routeError` were read (summary text, `ErrorBanner`, `canSearch`, `routeGeometry`, `findSuggestions`), and compute best times with `computeBestTimes({ plannedDate: trip.plannedDate, stops }, activeRoute ? activeRoute.legs.map((l) => l.duration) : null)` (dependency array `[trip.plannedDate, stops, activeRoute]`).
- The summary line becomes `{activeRoute ? \`${formatDistance(activeRoute.distance)} · ${formatDuration(activeRoute.duration)}\` : activeRouteError ? "Route unavailable" : enoughForRoute ? "Loading route…" : "Add 2 stops to see the route"}`.
- Remove `start`/`end` from the `<MapView>` call.

`src/components/editor/TripEditor.test.tsx` (interim edits): remove `start`/`end` from the `trip` fixture; add
`const seed = [newStop({ id: "a", order: 0, name: "A", lat: 36.74, lng: -119.79 }), newStop({ id: "b", order: 1, name: "B", lat: 37.96, lng: -119.12 })];`
then: the first test renders `{ ...trip, stops: seed }` and expects `directions` called with `[[-119.79, 36.74], [-119.12, 37.96]]`; the route-error test and the suggestions test render with `stops: seed` (the error test then ends with 3 rows after dropping a pin); the "adds a manual stop" test renders with `stops: [seed[0]]`, expects `addStop` to be called with `name: "Pin 2"` and `directions` last called with `[[-119.79, 36.74], [-119.5, 37.5]]`; add a test that no directions request is made and the status reads "Add 2 stops to see the route" for an empty trip. Other tests are unchanged.

- [ ] **Step 9: Run the whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS. Fix any remaining references to `trip.start`, `trip.end`, `startName` etc. (`grep -rnE "\.start\b|\.end\b|startLat|startName" src tests` must show nothing relevant).

- [ ] **Step 10: Verify the migration against a real database and commit**

Run: `rm -f /tmp/mig-check.db && DATABASE_URL=file:/tmp/mig-check.db npx prisma migrate deploy && sqlite3 /tmp/mig-check.db ".schema Trip"`
Expected: the `Trip` table has no `start*`/`end*` columns. (If `sqlite3` is missing, `npm test` already proves it: the global setup runs `migrate deploy` and the data layer round-trips without those columns.)

```bash
git add -A
git commit -m "feat: drop start/end from trips; best time departs from the first stop"
```

### Task 2: Stop PATCH accepts coordinates

**Files:**
- Modify: `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/server/stops.test.ts`

**Interfaces:**
- Produces: `stopPatchSchema` accepts optional `lat`, `lng` (so `api.updateStop(id, { lat, lng })` type-checks and works).

- [ ] **Step 1: Write the failing tests**

In `src/lib/validation.test.ts`, inside the existing `describe("stopPatchSchema", ...)` (or add one if absent):

```ts
  it("accepts a coordinate move", () => {
    expect(stopPatchSchema.parse({ lat: 37.5, lng: -119.5 })).toEqual({ lat: 37.5, lng: -119.5 });
  });

  it("rejects out-of-range coordinates", () => {
    expect(stopPatchSchema.safeParse({ lat: 95, lng: 0 }).success).toBe(false);
  });
```

In `src/server/stops.test.ts`, inside `describe("stops data access", ...)`, add (uses that file's `tripWithStops` helper):

```ts
  it("moves a stop", async () => {
    const { user, stops } = await tripWithStops(["a"]);
    const moved = await updateStop(user.id, stops[0].id, { lat: 38.25, lng: -118.5 });
    expect(moved).toMatchObject({ lat: 38.25, lng: -118.5, name: "a" });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/validation.test.ts src/server/stops.test.ts`
Expected: FAIL (coordinates are stripped by the schema; `moved` keeps the old values).

- [ ] **Step 3: Implement**

In `src/lib/validation.ts`, add to the `stopPatchSchema` object: `lat,` and `lng,` (the existing `lat`/`lng` constants). `updateStop` already writes `data: patch`, so no server change is needed.

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat: allow moving a stop by patching lat/lng"
```

### Task 3: Geocode with proximity and autocomplete; reverse geocode

**Files:**
- Modify: `src/server/external/mapbox.ts`, `src/server/external/mapbox.test.ts`, `src/server/external/fake.ts`, `src/server/external/fake.test.ts`, `src/app/api/geocode/route.ts`, `tests/api/directions.test.ts`, `src/lib/api-client.ts`, `src/lib/api-client.test.ts`
- Create: `src/app/api/reverse-geocode/route.ts`, `tests/api/reverse-geocode.test.ts`

**Interfaces:**
- Consumes: `coordsLabel` from `src/lib/geo.ts` (Task 1).
- Produces: `geocode(query, options?: { proximity?: { lat; lng } }, fetchImpl?)`, `reverseGeocode(p: { lat; lng }, fetchImpl?) : Promise<Place>`, `fakeReverseGeocode(p)`; `GET /api/geocode?q=&proximity=lng,lat`; `GET /api/reverse-geocode?lat=&lng=` → `{ place: Place }`; `api.geocode(q, proximity?)`, `api.reverseGeocode(lat, lng)`.

- [ ] **Step 1: Write failing tests**

`src/server/external/mapbox.test.ts`: update the existing calls to the new signature (`geocode("Fresno, CA", {}, fetchImpl)`, `geocode("Alpha", {}, fetchImpl)`), import `reverseGeocode`, and add:

```ts
  it("asks for autocomplete results biased to a proximity", async () => {
    const fetchImpl = vi.fn(async () => json({ features: [] }));
    await geocode("Spring", { proximity: { lat: 36.74, lng: -119.79 } }, fetchImpl);
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("autocomplete")).toBe("true");
    expect(url.searchParams.get("proximity")).toBe("-119.790000,36.740000");
  });

  it("reverse geocodes a click, keeping the clicked coordinates", async () => {
    const fetchImpl = vi.fn(async () => json({
      features: [{ geometry: { coordinates: [-119.5, 37.5] }, properties: { name: "Tunnel View", full_address: "Tunnel View, Yosemite, California" } }],
    }));
    expect(await reverseGeocode({ lat: 37.5001, lng: -119.5001 }, fetchImpl)).toEqual({
      name: "Tunnel View, Yosemite, California", lat: 37.5001, lng: -119.5001,
    });
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/search/geocode/v6/reverse");
    expect(url.searchParams.get("longitude")).toBe("-119.500100");
    expect(url.searchParams.get("latitude")).toBe("37.500100");
  });

  it("falls back to coordinates when nothing is found at a spot", async () => {
    const fetchImpl = vi.fn(async () => json({ features: [] }));
    expect((await reverseGeocode({ lat: 37.5, lng: -119.5 }, fetchImpl)).name).toBe("37.5000, -119.5000");
  });

  it("reverse geocodes with fake data in fake mode", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const fetchImpl = vi.fn();
    expect(await reverseGeocode({ lat: 37, lng: -119 }, fetchImpl)).toEqual({ name: "Spot 37.0000, -119.0000 (fake)", lat: 37, lng: -119 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
```

`tests/api/directions.test.ts`: in the geocode test change the expectation to `expect(geocode).toHaveBeenCalledWith("Fresno", { proximity: undefined });` and add

```ts
  it("passes a proximity bias through", async () => {
    vi.mocked(geocode).mockResolvedValue([]);
    await geocodeGET(new Request("http://localhost/api/geocode?q=Spring&proximity=-119.79,36.74"));
    expect(geocode).toHaveBeenLastCalledWith("Spring", { proximity: { lng: -119.79, lat: 36.74 } });
  });

  it("rejects a malformed proximity", async () => {
    const res = await geocodeGET(new Request("http://localhost/api/geocode?q=Spring&proximity=nope"));
    expect(res.status).toBe(400);
  });
```

`tests/api/reverse-geocode.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/mapbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/external/mapbox")>()),
  reverseGeocode: vi.fn(),
}));
import { getCurrentUserId } from "@/server/session";
import { ExternalServiceError, reverseGeocode } from "@/server/external/mapbox";
import { GET } from "@/app/api/reverse-geocode/route";

const url = (qs: string) => new Request(`http://localhost/api/reverse-geocode?${qs}`);

describe("GET /api/reverse-geocode", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));

  it("returns the place at a point", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue({ name: "Tunnel View", lat: 37.5, lng: -119.5 });
    const res = await GET(url("lat=37.5&lng=-119.5"));
    expect(await res.json()).toEqual({ place: { name: "Tunnel View", lat: 37.5, lng: -119.5 } });
    expect(reverseGeocode).toHaveBeenCalledWith({ lat: 37.5, lng: -119.5 });
  });

  it("rejects missing or out-of-range coordinates", async () => {
    expect((await GET(url("lat=95&lng=0"))).status).toBe(400);
    expect((await GET(url(""))).status).toBe(400);
  });

  it("maps upstream failures to 502", async () => {
    vi.mocked(reverseGeocode).mockRejectedValue(new ExternalServiceError("Place lookup failed. Please try again."));
    const res = await GET(url("lat=37.5&lng=-119.5"));
    expect(res.status).toBe(502);
  });

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await GET(url("lat=37.5&lng=-119.5"))).status).toBe(401);
  });
});
```

`src/lib/api-client.test.ts`: inside `describe("api client", ...)` add (the file already defines `fetchMock`):

```ts
  it("adds a proximity bias to geocode requests", async () => {
    fetchMock.mockResolvedValue(Response.json({ places: [] }));
    await api.geocode("Spring", { lat: 36.74, lng: -119.79 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/geocode?q=Spring&proximity=-119.79,36.74");
  });

  it("reverse geocodes a point", async () => {
    fetchMock.mockResolvedValue(Response.json({ place: { name: "X", lat: 1, lng: 2 } }));
    const { place } = await api.reverseGeocode(1, 2);
    expect(place.name).toBe("X");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reverse-geocode?lat=1&lng=2");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/server/external tests/api src/lib/api-client.test.ts`
Expected: FAIL (missing exports / routes / signature).

- [ ] **Step 3: Implement the server pieces**

`src/server/external/fake.ts`: import `coordsLabel` from `@/lib/geo` and add

```ts
export function fakeReverseGeocode(p: { lat: number; lng: number }): Place {
  return { name: `Spot ${coordsLabel(p)} (fake)`, lat: p.lat, lng: p.lng };
}
```

`src/server/external/mapbox.ts`: import `coordsLabel` from `@/lib/geo` and `fakeReverseGeocode`; replace `geocode` and add `reverseGeocode`:

```ts
export type GeocodeOptions = { proximity?: { lat: number; lng: number } };

export async function geocode(query: string, options: GeocodeOptions = {}, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  if (isFakeExternal()) return fakeGeocode(query);
  const proximity = options.proximity
    ? `&proximity=${options.proximity.lng.toFixed(6)},${options.proximity.lat.toFixed(6)}`
    : "";
  const url =
    `${MAPBOX_BASE}/search/geocode/v6/forward?q=${encodeURIComponent(query)}` +
    `&autocomplete=true&limit=5${proximity}&access_token=${encodeURIComponent(token())}`;
  const { ok, body } = await getJson<GeocodeResponse>(url, fetchImpl, "Couldn't reach the place search service");
  if (!ok || !body?.features) throw new ExternalServiceError("Place search failed. Please try again.");
  return body.features.map((f) => ({
    name: f.properties.full_address ?? f.properties.name ?? query,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}

/** Names a clicked spot; the returned coordinates are the clicked ones, not the feature's. */
export async function reverseGeocode(p: { lat: number; lng: number }, fetchImpl: typeof fetch = fetch): Promise<Place> {
  if (isFakeExternal()) return fakeReverseGeocode(p);
  const url =
    `${MAPBOX_BASE}/search/geocode/v6/reverse?longitude=${p.lng.toFixed(6)}&latitude=${p.lat.toFixed(6)}` +
    `&limit=1&access_token=${encodeURIComponent(token())}`;
  const { ok, body } = await getJson<GeocodeResponse>(url, fetchImpl, "Couldn't reach the place lookup service");
  if (!ok || !body) throw new ExternalServiceError("Place lookup failed. Please try again.");
  const f = body.features?.[0];
  return { name: f?.properties.full_address ?? f?.properties.name ?? coordsLabel(p), lat: p.lat, lng: p.lng };
}
```

`src/app/api/geocode/route.ts`:

```ts
import { z } from "zod";
import { ExternalServiceError, geocode } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";

const querySchema = z.string().trim().min(2, "Type at least 2 characters").max(200);
const proximitySchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "proximity must be lng,lat")
  .transform((s) => {
    const [lng, lat] = s.split(",").map(Number);
    return { lng, lat };
  })
  .pipe(z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }));

export const GET = handle(async (req: Request) => {
  await requireUserId();
  const params = new URL(req.url).searchParams;
  const q = querySchema.parse(params.get("q") ?? "");
  const rawProximity = params.get("proximity");
  const proximity = rawProximity === null ? undefined : proximitySchema.parse(rawProximity);
  try {
    return Response.json({ places: await geocode(q, { proximity }) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
```

`src/app/api/reverse-geocode/route.ts`:

```ts
import { z } from "zod";
import { ExternalServiceError, reverseGeocode } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";

const pointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const GET = handle(async (req: Request) => {
  await requireUserId();
  const params = new URL(req.url).searchParams;
  const point = pointSchema.parse({ lat: params.get("lat"), lng: params.get("lng") });
  try {
    return Response.json({ place: await reverseGeocode(point) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
```
(`z.coerce.number()` turns a missing param `null` into `0`; to make missing params fail, use `lat: params.get("lat") ?? undefined` and `lng: params.get("lng") ?? undefined` in the object passed to `parse`.)

`src/lib/api-client.ts`: replace `geocode` and add `reverseGeocode`:

```ts
  geocode: (q: string, proximity?: { lat: number; lng: number }) =>
    request<{ places: Place[] }>(
      `/api/geocode?q=${encodeURIComponent(q)}${proximity ? `&proximity=${proximity.lng},${proximity.lat}` : ""}`,
    ),
  reverseGeocode: (lat: number, lng: number) =>
    request<{ place: Place }>(`/api/reverse-geocode?lat=${lat}&lng=${lng}`),
```

- [ ] **Step 4: Run to verify, then commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add -A
git commit -m "feat: proximity-biased autocomplete geocoding and reverse geocoding"
```

### Phase 1 checkpoint

- [ ] Append a dated "map-first UI: Phase 1 complete (data model, API, logic)" entry to `PROGRESS.md` (what changed, test counts, "e2e intentionally broken until Task 9") and commit it.

---

## Phase 2 — Map shell and search

### Task 4: Debounce hook and SearchBar

**Files:**
- Create: `src/lib/use-debounced-value.ts`, `src/lib/use-debounced-value.test.ts`, `src/components/editor/SearchBar.tsx`, `src/components/editor/SearchBar.test.tsx`

**Interfaces:**
- Consumes: `api.geocode(q, proximity?)`, type `Place`.
- Produces: `useDebouncedValue<T>(value: T, delayMs: number): T`; `<SearchBar getProximity={() => {lat;lng} | null} onSelect={(place: Place) => void} />`.

- [ ] **Step 1: Write the failing hook test**

`src/lib/use-debounced-value.test.ts`:

```ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("only updates after the value has been stable for the delay", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 250), { initialProps: { v: "a" } });
    rerender({ v: "ab" });
    rerender({ v: "abc" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("abc");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/use-debounced-value.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

`src/lib/use-debounced-value.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/use-debounced-value.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing SearchBar tests (one at a time: write, run RED, implement, run GREEN)**

`src/components/editor/SearchBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ api: { geocode: vi.fn() } }));
import { api } from "@/lib/api-client";
import type { Place } from "@/lib/types";
import { SearchBar } from "./SearchBar";

const fresno: Place = { name: "Fresno, California", lat: 36.74, lng: -119.79 };
const input = () => screen.getByRole("combobox", { name: "Search for a place" });

describe("SearchBar", () => {
  afterEach(() => vi.mocked(api.geocode).mockReset());

  it("searches as you type, biased to the map centre, and selects a result", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ places: [fresno] });
    const onSelect = vi.fn();
    render(<SearchBar getProximity={() => ({ lat: 37, lng: -119 })} onSelect={onSelect} />);
    await userEvent.type(input(), "Fres");
    await userEvent.click(await screen.findByRole("button", { name: "Fresno, California" }));
    expect(api.geocode).toHaveBeenCalledTimes(1); // typing was debounced into one request
    expect(api.geocode).toHaveBeenCalledWith("Fres", { lat: 37, lng: -119 });
    expect(onSelect).toHaveBeenCalledWith(fresno);
    expect((input() as HTMLInputElement).value).toBe("");
  });

  it("does not search for fewer than 2 characters", async () => {
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "F");
    await new Promise((r) => setTimeout(r, 400));
    expect(api.geocode).not.toHaveBeenCalled();
  });

  it("ignores a stale response that arrives after a newer search", async () => {
    let resolveFirst!: (v: { places: Place[] }) => void;
    vi.mocked(api.geocode)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ places: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fr");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(1));
    await userEvent.type(input(), "e");
    expect(await screen.findByRole("button", { name: "Fresno, California" })).toBeTruthy();
    await act(async () => resolveFirst({ places: [{ name: "Frankfurt", lat: 50, lng: 8 }] }));
    expect(screen.queryByRole("button", { name: "Frankfurt" })).toBeNull();
  });

  it("shows no-match and error messages", async () => {
    vi.mocked(api.geocode).mockResolvedValueOnce({ places: [] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "zzzz");
    expect(await screen.findByText("No matches found")).toBeTruthy();
    vi.mocked(api.geocode).mockRejectedValueOnce(new Error("Place search failed. Please try again."));
    await userEvent.type(input(), "y");
    expect(await screen.findByText("Place search failed. Please try again.")).toBeTruthy();
  });

  it("clears on Escape", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ places: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await screen.findByRole("button", { name: "Fresno, California" });
    await userEvent.keyboard("{Escape}");
    expect((input() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Fresno, California" })).toBeNull();
  });
});
```

Run each as you add it: `npx vitest run src/components/editor/SearchBar.test.tsx` (RED: module not found, then failures as behaviours are missing).

- [ ] **Step 6: Implement SearchBar**

`src/components/editor/SearchBar.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { Place } from "@/lib/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

type Props = {
  /** Read at search time so panning the map never re-triggers a search. */
  getProximity: () => { lat: number; lng: number } | null;
  onSelect: (place: Place) => void;
};

/** Results are tagged with the query that produced them so stale responses can't show. */
type Outcome = { query: string; places: Place[]; error: string | null };

export function SearchBar({ getProximity, onSelect }: Props) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const query = text.trim();
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  const getProximityRef = useRef(getProximity);
  useEffect(() => {
    getProximityRef.current = getProximity;
  }, [getProximity]);

  useEffect(() => {
    if (debounced.length < MIN_CHARS) return;
    let cancelled = false;
    api.geocode(debounced, getProximityRef.current() ?? undefined).then(
      ({ places }) => {
        if (!cancelled) setOutcome({ query: debounced, places, error: places.length === 0 ? "No matches found" : null });
      },
      (e: unknown) => {
        if (!cancelled) setOutcome({ query: debounced, places: [], error: e instanceof Error ? e.message : "Search failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const shown = query.length >= MIN_CHARS && outcome?.query === query ? outcome : null;

  function clear() {
    setText("");
    setOutcome(null);
  }

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-expanded={Boolean(shown?.places.length)}
        aria-controls="place-search-results"
        aria-label="Search for a place"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") clear();
        }}
        placeholder="Search for a place"
        className="w-full rounded-xl border bg-white px-4 py-2.5 shadow-lg"
      />
      {shown?.error && <p className="mt-1 rounded-lg bg-white px-3 py-2 text-sm text-red-700 shadow">{shown.error}</p>}
      {shown && shown.places.length > 0 && (
        <ul id="place-search-results" className="mt-1 overflow-hidden rounded-xl border bg-white shadow-lg">
          {shown.places.map((p) => (
            <li key={`${p.lat},${p.lng},${p.name}`}>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                onClick={() => {
                  onSelect(p);
                  clear();
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run to verify, then commit**

Run: `npx vitest run src/components/editor/SearchBar.test.tsx && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat: debounced as-you-type SearchBar"
```

### Task 5: PlaceCard and StopCard

**Files:**
- Create: `src/components/editor/PlaceCard.tsx`, `src/components/editor/PlaceCard.test.tsx`, `src/components/editor/StopCard.tsx`, `src/components/editor/StopCard.test.tsx`

**Interfaces:**
- Consumes: `describeBestTime`, `formatClock`, `BestTime` from `@/lib/best-time`; type `Stop`.
- Produces: `<PlaceCard name resolving busy onAdd onClose />`; `<StopCard stop bestTime arrival onToggleVisited={(visited: boolean) => void} onOpenDetails onClose />`.

- [ ] **Step 1: Write failing PlaceCard tests**

`src/components/editor/PlaceCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaceCard } from "./PlaceCard";

describe("PlaceCard", () => {
  it("shows the place name and adds it as a stop", async () => {
    const onAdd = vi.fn();
    render(<PlaceCard name="Tunnel View" resolving={false} busy={false} onAdd={onAdd} onClose={vi.fn()} />);
    expect(screen.getByText("Tunnel View")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("disables adding while the name is still being looked up or a save is in flight", () => {
    const { rerender } = render(<PlaceCard name="Looking up place…" resolving busy={false} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add stop" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<PlaceCard name="Tunnel View" resolving={false} busy onAdd={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add stop" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<PlaceCard name="X" resolving={false} busy={false} onAdd={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/components/editor/PlaceCard.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement PlaceCard**

`src/components/editor/PlaceCard.tsx`:

```tsx
"use client";

type Props = { name: string; resolving: boolean; busy: boolean; onAdd: () => void; onClose: () => void };

/** The on-map "popup" for a candidate place: a search result, a clicked spot, or a suggestion. */
export function PlaceCard({ name, resolving, busy, onAdd, onClose }: Props) {
  return (
    <section aria-label="Selected place" className="flex items-center gap-3 rounded-xl border bg-white p-3 shadow-lg">
      <p className={`min-w-0 flex-1 text-sm font-medium ${resolving ? "text-gray-500" : ""}`}>{name}</p>
      <button
        type="button"
        onClick={onAdd}
        disabled={resolving || busy}
        className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Add stop
      </button>
      <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 px-1 text-lg leading-none text-gray-500">
        ×
      </button>
    </section>
  );
}
```

Run: `npx vitest run src/components/editor/PlaceCard.test.tsx` — Expected: PASS.

- [ ] **Step 3: Write failing StopCard tests**

`src/components/editor/StopCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Stop } from "@/lib/types";
import { StopCard } from "./StopCard";

const stop: Stop = { id: "s1", tripId: "t1", order: 0, name: "Tunnel View", lat: 37.7, lng: -119.7, notes: null, source: "manual", photoUrl: null, visited: false };
const base = { stop, bestTime: { window: "golden hour" as const, at: new Date("2026-07-02T02:45:00Z") }, onToggleVisited: vi.fn(), onOpenDetails: vi.fn(), onClose: vi.fn() };

describe("StopCard", () => {
  it("shows the name, best time and estimated arrival", () => {
    render(<StopCard {...base} arrival={new Date("2026-07-01T16:30:00Z")} />);
    expect(screen.getByText("Tunnel View")).toBeTruthy();
    expect(screen.getByText(/Golden hour ·/)).toBeTruthy();
    expect(screen.getByText(/Arrive ~/)).toBeTruthy();
  });

  it("omits the arrival when there is no route estimate", () => {
    render(<StopCard {...base} arrival={null} />);
    expect(screen.queryByText(/Arrive ~/)).toBeNull();
  });

  it("toggles visited, opens details and closes", async () => {
    const onToggleVisited = vi.fn();
    const onOpenDetails = vi.fn();
    const onClose = vi.fn();
    render(<StopCard {...base} arrival={null} onToggleVisited={onToggleVisited} onOpenDetails={onOpenDetails} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Visited"));
    expect(onToggleVisited).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Open details" }));
    expect(onOpenDetails).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/components/editor/StopCard.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement StopCard**

`src/components/editor/StopCard.tsx`:

```tsx
"use client";

import { describeBestTime, formatClock, type BestTime } from "@/lib/best-time";
import type { Stop } from "@/lib/types";

type Props = {
  stop: Stop;
  bestTime: BestTime;
  arrival: Date | null;
  onToggleVisited: (visited: boolean) => void;
  onOpenDetails: () => void;
  onClose: () => void;
};

/** The on-map "popup" for an existing stop (opened by clicking its marker). */
export function StopCard({ stop, bestTime, arrival, onToggleVisited, onOpenDetails, onClose }: Props) {
  return (
    <section aria-label="Selected stop" className="space-y-2 rounded-xl border bg-white p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{stop.name}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="px-1 text-lg leading-none text-gray-500">
          ×
        </button>
      </div>
      <p className="text-xs text-gray-600">{describeBestTime(bestTime)}</p>
      {arrival && <p className="text-xs text-gray-600">Arrive ~{formatClock(arrival)}</p>}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={stop.visited} onChange={(e) => onToggleVisited(e.target.checked)} />
          Visited
        </label>
        <button type="button" onClick={onOpenDetails} className="rounded border px-3 py-1 text-sm">
          Open details
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run to verify, then commit**

Run: `npx vitest run src/components/editor && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat: PlaceCard and StopCard on-map cards"
```

### Task 6: Map contract, fake map, real map

**Files:**
- Modify: `src/components/editor/map-types.ts`, `src/components/editor/FakeMapPanel.tsx`, `src/components/editor/FakeMapPanel.test.tsx`, `src/components/editor/MapPanel.tsx`

**Interfaces:**
- Consumes: `Stop`, `Suggestion`, `LngLat` types; `latLngToPercent`, `pixelToLatLng`, `Bounds` from `@/lib/map-bounds`; `stopColor`.
- Produces: the `MapViewProps` below (required: `stops`, `routeGeometry`, `onMapClick`, `onStopClick`; the rest optional so read-only uses stay valid), and exported `FAKE_BOUNDS`.

```ts
export type LatLng = { lat: number; lng: number };

export type MapViewProps = {
  stops: Stop[];
  routeGeometry: LngLat[] | null;
  /** Temporary pin for a search result / clicked spot / suggestion being considered. */
  pending?: LatLng | null;
  suggestions?: Suggestion[];
  highlightedSuggestionId?: string | null;
  selectedId?: string | null;
  /** Fly to a point; a new `nonce` re-triggers the move. */
  flyTo?: (LatLng & { nonce: number }) | null;
  onMapClick: (p: LatLng) => void;
  onStopClick: (stopId: string) => void;
  onStopMove?: (stopId: string, p: LatLng) => void;
  onSuggestionClick?: (osmId: string) => void;
  /** Called after the map settles (and once on load) with the current centre. */
  onCenterChange?: (p: LatLng) => void;
};
```

- [ ] **Step 1: Write failing fake-map tests**

Replace `src/components/editor/FakeMapPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stop, Suggestion } from "@/lib/types";
import { FakeMapPanel } from "./FakeMapPanel";

const stop: Stop = { id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false };
const suggestion: Suggestion = { osmId: "node/1", name: "Fake Viewpoint", lat: 37.2, lng: -119.2, kind: "viewpoint" };
const base = { stops: [] as Stop[], routeGeometry: null, onMapClick: vi.fn(), onStopClick: vi.fn() };

describe("FakeMapPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("converts a click position into lat/lng inside the fixed viewport", () => {
    const onMapClick = vi.fn();
    render(<FakeMapPanel {...base} onMapClick={onMapClick} />);
    const map = screen.getByTestId("map");
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(map, { clientX: 100, clientY: 50 });
    const { lat, lng } = onMapClick.mock.calls[0][0];
    expect(lat).toBeCloseTo(37);
    expect(lng).toBeCloseTo(-119.5);
  });

  it("reports its centre on mount so searches can be biased", () => {
    const onCenterChange = vi.fn();
    render(<FakeMapPanel {...base} onCenterChange={onCenterChange} />);
    expect(onCenterChange).toHaveBeenCalledWith({ lat: 37, lng: -119.5 });
  });

  it("renders numbered stop markers; clicking one selects it without dropping a pin", () => {
    const onMapClick = vi.fn();
    const onStopClick = vi.fn();
    render(<FakeMapPanel {...base} stops={[stop]} routeGeometry={[[-120, 36], [-118, 38]]} onMapClick={onMapClick} onStopClick={onStopClick} />);
    const marker = screen.getByRole("button", { name: "Stop 1: Pin 1" });
    expect(marker.textContent).toBe("1");
    fireEvent.click(marker);
    expect(onStopClick).toHaveBeenCalledWith("s1");
    expect(onMapClick).not.toHaveBeenCalled();
  });

  it("shows the pending pin and clickable suggestion markers", () => {
    const onSuggestionClick = vi.fn();
    const onMapClick = vi.fn();
    render(<FakeMapPanel {...base} pending={{ lat: 37.5, lng: -119 }} suggestions={[suggestion]} onSuggestionClick={onSuggestionClick} onMapClick={onMapClick} />);
    expect(screen.getByLabelText("Selected place")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" }));
    expect(onSuggestionClick).toHaveBeenCalledWith("node/1");
    expect(onMapClick).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/components/editor/FakeMapPanel.test.tsx` — Expected: FAIL.

- [ ] **Step 2: Implement the contract and FakeMapPanel**

Replace `src/components/editor/map-types.ts` with the contract above (imports: `import type { LngLat, Stop, Suggestion } from "@/lib/types";`).

Replace `src/components/editor/FakeMapPanel.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { latLngToPercent, pixelToLatLng, type Bounds } from "@/lib/map-bounds";
import { stopColor } from "@/lib/stop-style";
import type { MapViewProps } from "./map-types";

/**
 * Fixed viewport so fake geocoding (lat 36-38, lng -121..-118) always lands on screen
 * and e2e clicks map to stable coordinates.
 */
export const FAKE_BOUNDS: Bounds = { minLat: 36, maxLat: 38, minLng: -121, maxLng: -118 };

/** No-network stand-in for Mapbox GL: used in e2e and when no token is configured. */
export function FakeMapPanel({
  stops, routeGeometry, pending, suggestions = [], highlightedSuggestionId, selectedId,
  onMapClick, onStopClick, onSuggestionClick, onCenterChange,
}: MapViewProps) {
  useEffect(() => {
    onCenterChange?.({ lat: 37, lng: -119.5 });
  }, [onCenterChange]);

  const pos = (p: { lat: number; lng: number }) => latLngToPercent(FAKE_BOUNDS, p);
  const routePoints = (routeGeometry ?? [])
    .map(([lng, lat]) => pos({ lat, lng }))
    .map((p) => `${p.left},${p.top}`)
    .join(" ");
  const place = (p: { lat: number; lng: number }) => ({ left: `${pos(p).left}%`, top: `${pos(p).top}%` });

  return (
    <div
      data-testid="map"
      className="relative h-full min-h-[50vh] w-full cursor-crosshair overflow-hidden bg-emerald-50"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onMapClick(pixelToLatLng(FAKE_BOUNDS, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {routePoints && <polyline points={routePoints} fill="none" stroke="#2563eb" strokeWidth={0.6} />}
      </svg>
      {suggestions.map((s) => (
        <button
          key={s.osmId}
          type="button"
          aria-label={`Suggestion: ${s.name}`}
          title={s.name}
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-amber-500 ${
            s.osmId === highlightedSuggestionId ? "h-5 w-5 opacity-100" : "h-3.5 w-3.5 opacity-60"
          }`}
          style={place(s)}
          onClick={(e) => {
            e.stopPropagation();
            onSuggestionClick?.(s.osmId);
          }}
        />
      ))}
      {stops.map((s, i) => (
        <button
          key={s.id}
          type="button"
          aria-label={`Stop ${i + 1}: ${s.name}`}
          title={s.name}
          className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow ${
            s.id === selectedId ? "ring-2 ring-black" : ""
          }`}
          style={{ ...place(s), background: stopColor(s) }}
          onClick={(e) => {
            e.stopPropagation();
            onStopClick(s.id);
          }}
        >
          {i + 1}
        </button>
      ))}
      {pending && (
        <span
          aria-label="Selected place"
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-600 shadow"
          style={place(pending)}
        />
      )}
      <p className="absolute bottom-1 right-1 text-xs text-gray-500">Offline map preview</p>
    </div>
  );
}
```

Run: `npx vitest run src/components/editor/FakeMapPanel.test.tsx` — Expected: PASS.

- [ ] **Step 3: Implement the real MapPanel**

`MapPanel` cannot run in unit tests (WebGL); it is verified in a real browser in Task 10. Replace `src/components/editor/MapPanel.tsx`:

```tsx
"use client";

import type { Feature, LineString } from "geojson";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { stopColor } from "@/lib/stop-style";
import type { LngLat } from "@/lib/types";
import type { MapViewProps } from "./map-types";

const ROUTE_SOURCE = "route";
const MARKER_CLASS = "map-marker";
const DEFAULT_CENTER: LngLat = [-98.5, 39.8];
const STOP_CLASS = "flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow";
const PENDING_CLASS = "h-5 w-5 rounded-full border-2 border-white bg-red-600 shadow";

function routeData(geometry: LngLat[] | null): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geometry ?? [] } };
}

function markerElement(className: string, label: string, text = ""): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `${MARKER_CLASS} ${className}`;
  el.textContent = text;
  el.setAttribute("aria-label", label);
  el.title = label;
  return el;
}

export default function MapPanel({
  stops, routeGeometry, pending, suggestions = [], highlightedSuggestionId, selectedId, flyTo,
  onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const stopMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const suggestionMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const pendingMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const handlersRef = useRef({ onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange });
  const initialRef = useRef({ center: (stops[0] ? [stops[0].lng, stops[0].lat] : DEFAULT_CENTER) as LngLat, zoom: stops.length ? 7 : 3.5 });
  const fittedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    handlersRef.current = { onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange };
  }, [onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      accessToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: initialRef.current.center,
      zoom: initialRef.current.zoom,
    });
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    const reportCenter = () => {
      const c = map.getCenter();
      handlersRef.current.onCenterChange?.({ lat: c.lat, lng: c.lng });
    };
    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeData(null) });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#2563eb", "line-width": 4 },
      });
      setLoaded(true);
      reportCenter();
    });
    map.on("moveend", reportCenter);
    map.on("click", (e) => {
      const target = e.originalEvent.target as HTMLElement | null;
      if (target?.closest(`.${MARKER_CLASS}`)) return; // marker clicks select, they don't drop pins
      handlersRef.current.onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Route line; fit the view the first time a route arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(routeData(routeGeometry));
    if (!fittedRef.current && routeGeometry && routeGeometry.length > 1) {
      const bounds = new mapboxgl.LngLatBounds(routeGeometry[0], routeGeometry[0]);
      for (const c of routeGeometry) bounds.extend(c);
      map.fitBounds(bounds, { padding: 64, duration: 0 });
      fittedRef.current = true;
    }
  }, [loaded, routeGeometry]);

  // Numbered, draggable stop markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of stopMarkersRef.current) m.remove();
    stopMarkersRef.current = stops.map((s, i) => {
      const el = markerElement(`${STOP_CLASS} ${s.id === selectedId ? "ring-2 ring-black" : ""}`, `Stop ${i + 1}: ${s.name}`, String(i + 1));
      el.style.background = stopColor(s);
      el.addEventListener("click", () => handlersRef.current.onStopClick(s.id));
      const marker = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat([s.lng, s.lat]).addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        handlersRef.current.onStopMove?.(s.id, { lat, lng });
      });
      return marker;
    });
  }, [stops, selectedId]);

  // Faint suggestion markers (bigger when highlighted from the panel).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of suggestionMarkersRef.current) m.remove();
    suggestionMarkersRef.current = suggestions.map((s) => {
      const big = s.osmId === highlightedSuggestionId;
      const el = markerElement(
        `rounded-full border border-white bg-amber-500 ${big ? "h-5 w-5" : "h-3.5 w-3.5 opacity-60"}`,
        `Suggestion: ${s.name}`,
      );
      el.addEventListener("click", () => handlersRef.current.onSuggestionClick?.(s.osmId));
      return new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
    });
  }, [suggestions, highlightedSuggestionId]);

  // The temporary pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pendingMarkerRef.current?.remove();
    pendingMarkerRef.current = pending
      ? new mapboxgl.Marker({ element: markerElement(PENDING_CLASS, "Selected place") }).setLngLat([pending.lng, pending.lat]).addTo(map)
      : null;
  }, [pending]);

  // Fly to a requested point (new nonce = new request).
  const flyNonce = flyTo?.nonce;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(map.getZoom(), 12) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request nonce only
  }, [flyNonce]);

  return <div ref={containerRef} data-testid="map" className="absolute inset-0" />;
}
```

- [ ] **Step 4: Run everything, then commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. (`TripEditor` still passes only the required props, which is valid.)

```bash
git add -A
git commit -m "feat: map contract with numbered draggable markers, pending pin and suggestion markers"
```

### Phase 2 checkpoint

- [ ] Append "map-first UI: Phase 2 (search, cards, map components) complete" to `PROGRESS.md` and commit. (The editor still uses the old layout until Task 8.)

---

## Phase 3 — Stops panel and the editor

### Task 7: StopsPanel, Start/End labels, suggestion hover

**Files:**
- Create: `src/components/editor/StopsPanel.tsx`, `src/components/editor/StopsPanel.test.tsx`
- Modify: `src/components/editor/StopList.tsx`, `src/components/editor/StopList.test.tsx`, `src/components/editor/SuggestionsPanel.tsx`, `src/components/editor/SuggestionsPanel.test.tsx`

**Interfaces:**
- Produces: `<StopsPanel header summary stops suggestions suggestionCount />` (all `ReactNode` except the count); `StopList` rows with `data-testid="stop-role"` text "Start"/"End" when there are 2+ stops; `SuggestionsPanel` optional `onHover?: (osmId: string | null) => void`.

- [ ] **Step 1: Write the failing StopsPanel tests**

`src/components/editor/StopsPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StopsPanel } from "./StopsPanel";

function panel() {
  return render(
    <StopsPanel
      header={<h1>Sierra loop</h1>}
      summary={<p>100 km</p>}
      stops={<p>stops content</p>}
      suggestions={<p>suggestions content</p>}
      suggestionCount={3}
    />,
  );
}

describe("StopsPanel", () => {
  it("shows the header, summary and the Stops tab by default", () => {
    panel();
    expect(screen.getByRole("heading", { name: "Sierra loop" })).toBeTruthy();
    expect(screen.getByText("100 km")).toBeTruthy();
    expect(screen.getByText("stops content")).toBeTruthy();
    expect(screen.queryByText("suggestions content")).toBeNull();
    expect(screen.getByRole("tab", { name: "Stops" }).getAttribute("aria-selected")).toBe("true");
  });

  it("switches to the Suggestions tab and shows the count", async () => {
    panel();
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions (3)" }));
    expect(screen.getByText("suggestions content")).toBeTruthy();
    expect(screen.queryByText("stops content")).toBeNull();
  });

  it("cycles the sheet height and hides the content when collapsed", async () => {
    panel();
    const handle = screen.getByRole("button", { name: "Resize panel" });
    const root = handle.closest("[data-snap]")!;
    expect(root.getAttribute("data-snap")).toBe("half");
    await userEvent.click(handle);
    expect(root.getAttribute("data-snap")).toBe("full");
    await userEvent.click(handle);
    expect(root.getAttribute("data-snap")).toBe("collapsed");
    expect(screen.queryByText("stops content")).toBeNull();
    expect(screen.getByRole("heading", { name: "Sierra loop" })).toBeTruthy(); // header stays
    await userEvent.click(handle);
    expect(root.getAttribute("data-snap")).toBe("half");
  });
});
```

Run: `npx vitest run src/components/editor/StopsPanel.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement StopsPanel**

`src/components/editor/StopsPanel.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";

type Snap = "collapsed" | "half" | "full";
type Tab = "stops" | "suggestions";

const NEXT: Record<Snap, Snap> = { half: "full", full: "collapsed", collapsed: "half" };
// Phones: a bottom sheet at three heights. lg+: a card on the left (collapsed = header only).
const SNAP_CLASS: Record<Snap, string> = {
  collapsed: "h-14 lg:h-14",
  half: "h-[45dvh] lg:bottom-3 lg:h-auto",
  full: "h-[85dvh] lg:bottom-3 lg:h-auto",
};

type Props = {
  header: ReactNode;
  summary: ReactNode;
  stops: ReactNode;
  suggestions: ReactNode;
  suggestionCount: number;
};

export function StopsPanel({ header, summary, stops, suggestions, suggestionCount }: Props) {
  const [snap, setSnap] = useState<Snap>("half");
  const [tab, setTab] = useState<Tab>("stops");
  const open = snap !== "collapsed";
  const tabClass = (t: Tab) => `border-b-2 px-3 py-2 text-sm ${tab === t ? "border-blue-600 font-semibold" : "border-transparent text-gray-600"}`;

  return (
    <aside
      data-snap={snap}
      className={`absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-2xl border bg-white shadow-xl lg:inset-x-auto lg:left-3 lg:top-3 lg:w-[360px] lg:rounded-xl ${SNAP_CLASS[snap]}`}
    >
      <div className="flex items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">{header}</div>
        <button
          type="button"
          aria-label="Resize panel"
          onClick={() => setSnap(NEXT[snap])}
          className="shrink-0 rounded border px-2 py-1 text-sm"
        >
          {open ? "▾" : "▴"}
        </button>
      </div>
      {open && (
        <>
          <div className="space-y-2 px-3 pt-2">{summary}</div>
          <div role="tablist" className="flex gap-1 border-b px-2">
            <button role="tab" type="button" aria-selected={tab === "stops"} className={tabClass("stops")} onClick={() => setTab("stops")}>
              Stops
            </button>
            <button role="tab" type="button" aria-selected={tab === "suggestions"} className={tabClass("suggestions")} onClick={() => setTab("suggestions")}>
              {suggestionCount > 0 ? `Suggestions (${suggestionCount})` : "Suggestions"}
            </button>
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {tab === "stops" ? stops : suggestions}
          </div>
        </>
      )}
    </aside>
  );
}
```

Run: `npx vitest run src/components/editor/StopsPanel.test.tsx` — Expected: PASS.

- [ ] **Step 3: Failing tests for Start/End labels and suggestion hover**

In `src/components/editor/StopList.test.tsx` add (use the file's `stop` helper and `handlers`):

```tsx
  it("labels the first and last stops Start and End when there are two or more", () => {
    render(<StopList stops={[stop("a", "A"), stop("b", "B"), stop("c", "C")]} bestTimes={[null, null, null]} {...handlers} />);
    const roles = screen.getAllByTestId("stop-role").map((el) => el.textContent);
    expect(roles).toEqual(["Start", "End"]);
  });

  it("does not label a lone stop", () => {
    render(<StopList stops={[stop("a", "A")]} bestTimes={[null]} {...handlers} />);
    expect(screen.queryAllByTestId("stop-role")).toHaveLength(0);
  });
```

In `src/components/editor/SuggestionsPanel.test.tsx` add (uses that file's `base` props and the `s` suggestion fixture):

```tsx
  it("reports hover over a suggestion card", async () => {
    const onHover = vi.fn();
    render(<SuggestionsPanel {...base} status="done" suggestions={[s]} onHover={onHover} />);
    await userEvent.hover(screen.getByTestId("suggestion-card"));
    expect(onHover).toHaveBeenLastCalledWith("node/1");
    await userEvent.unhover(screen.getByTestId("suggestion-card"));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
```

Run: `npx vitest run src/components/editor/StopList.test.tsx src/components/editor/SuggestionsPanel.test.tsx` — Expected: FAIL.

- [ ] **Step 4: Implement**

`StopList.tsx`: in `StopList`'s `stops.map`, pass `role={stops.length > 1 ? (i === 0 ? "Start" : i === stops.length - 1 ? "End" : null) : null}` to `StopRow`; add `role: "Start" | "End" | null` to `StopRow`'s props and, directly after the name `<button>`, render

```tsx
        {role && <span data-testid="stop-role" className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{role}</span>}
```
(keep the `{index + 1}. {stop.name}` text exactly as is: tests rely on it.)

`SuggestionsPanel.tsx`: add `onHover?: (osmId: string | null) => void;` to `Props`, destructure it, and on the `<li>` add `onMouseEnter={() => onHover?.(s.osmId)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(s.osmId)} onBlur={() => onHover?.(null)}`.

- [ ] **Step 5: Run to verify, then commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add -A
git commit -m "feat: StopsPanel with tabs and bottom-sheet snaps; Start/End labels; suggestion hover"
```

### Task 8: TripEditor rewritten as map + overlays

**Files:**
- Modify (full rewrite): `src/components/editor/TripEditor.tsx`, `src/components/editor/TripEditor.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–7 (`MapView`/`MapViewProps`, `SearchBar`, `PlaceCard`, `StopCard`, `StopsPanel`, `StopList`, `SuggestionsPanel`, `StopDrawer`, `TripHeader`, `api.reverseGeocode`, `api.updateStop({lat,lng})`, `computeArrivals`, `computeBestTimes`, `coordsLabel`).
- Produces: the finished `TripEditor`; DOM test ids kept: `route-status`, `stop-row`, `suggestion-card`, `suggestion-name`, `drag-handle`, `best-time`; new: `empty-hint`.

Behaviour: map click → reverse-geocode → `PlaceCard` (fallback name = coordinates) → **Add stop** appends; search selection → `PlaceCard` + fly; suggestion marker click → `PlaceCard` (source `suggested`); stop marker click → `StopCard`; **Open details** or a list row opens `StopDrawer` (row also flies to the stop); marker drag saves coordinates (revert + error on failure); route fetched only with 2+ stops; summary text `"100 km · 1 h 0 min"` / `"Route unavailable"` / `"Loading route…"` / `"Add 2 stops to see the route"`.

- [ ] **Step 1: Write the failing tests**

Replace `src/components/editor/TripEditor.test.tsx` (the StopList reorder wrapper is kept from the old file):

```tsx
// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  api: {
    directions: vi.fn(), addStop: vi.fn(), suggestions: vi.fn(), reorderStops: vi.fn(),
    updateStop: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), geocode: vi.fn(),
  },
}));
vi.mock("./MapView", () => ({
  MapView: (p: import("./map-types").MapViewProps) => (
    <div>
      <button type="button" onClick={() => p.onMapClick({ lat: 37.5, lng: -119.5 })}>drop pin</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopClick(p.stops[0].id)}>click first marker</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopMove?.(p.stops[0].id, { lat: 38, lng: -118 })}>drag first marker</button>
      <button type="button" onClick={() => p.suggestions?.[0] && p.onSuggestionClick?.(p.suggestions[0].osmId)}>click first suggestion</button>
      {p.pending && <span data-testid="pending-pin">{p.pending.lat},{p.pending.lng}</span>}
    </div>
  ),
}));
vi.mock("./SearchBar", () => ({
  SearchBar: ({ onSelect }: { onSelect: (p: { name: string; lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onSelect({ name: "Fresno, California", lat: 36.74, lng: -119.79 })}>pick place</button>
  ),
}));
// dnd-kit's drag gestures can't be simulated in jsdom, so the real StopList is kept for
// rendering but wrapped with a button that invokes the same onReorder a drag-end would.
vi.mock("./StopList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./StopList")>();
  type Props = Parameters<typeof actual.StopList>[0];
  function StopList(props: Props) {
    return (
      <>
        <button type="button" onClick={() => props.onReorder([...props.stops].reverse().map((s) => s.id))}>reorder</button>
        <actual.StopList {...props} />
      </>
    );
  }
  return { ...actual, StopList };
});
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const trip: TripWithStops = { id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", stops: [] };
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const newStop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37.5, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, ...over,
});
const seed = [
  newStop({ id: "a", order: 0, name: "A", lat: 36.74, lng: -119.79 }),
  newStop({ id: "b", order: 1, name: "B", lat: 37.96, lng: -119.12 }),
];
const withStops = (stops: Stop[]) => ({ ...trip, stops });

describe("TripEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.reverseGeocode).mockResolvedValue({ place: { name: "Tunnel View", lat: 37.5, lng: -119.5 } });
  });

  it("asks for stops and skips routing until there are two", () => {
    render(<TripEditor initialTrip={trip} />);
    expect(screen.getByTestId("empty-hint")).toBeTruthy();
    expect(screen.getByTestId("route-status").textContent).toBe("Add 2 stops to see the route");
    expect(api.directions).not.toHaveBeenCalled();
  });

  it("loads the route through the stops in order and shows its summary", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toBe("100 km · 1 h 0 min"));
    expect(api.directions).toHaveBeenCalledWith([[-119.79, 36.74], [-119.12, 37.96]]);
  });

  it("shows a dismissible route error while the rest of the editor keeps working", async () => {
    vi.mocked(api.directions).mockRejectedValue(new Error("No driving route found between these points"));
    render(<TripEditor initialTrip={withStops(seed)} />);
    expect((await screen.findByRole("alert")).textContent).toContain("No driving route found");
    expect(screen.getByTestId("route-status").textContent).toBe("Route unavailable");
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(await screen.findByRole("region", { name: "Selected place" })).toBeTruthy();
  });

  it("names a clicked spot, then adds it as a stop and refetches the route", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View" }) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(api.reverseGeocode).toHaveBeenCalledWith(37.5, -119.5);
    expect(await screen.findByText("Tunnel View")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.5, lng: -119.5, source: "manual" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selected place" })).toBeNull());
    await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-119.79, 36.74], [-119.12, 37.96], [-119.5, 37.5]]));
  });

  it("falls back to the coordinates when the place lookup fails", async () => {
    vi.mocked(api.reverseGeocode).mockRejectedValue(new Error("Place lookup failed"));
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(await screen.findByText("37.5000, -119.5000")).toBeTruthy();
  });

  it("opens a search result as a pending place without a reverse lookup", async () => {
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ name: "Fresno, California", lat: 36.74, lng: -119.79 }) });
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("button", { name: "pick place" }));
    expect(screen.getByText("Fresno, California")).toBeTruthy();
    expect(screen.getByTestId("pending-pin").textContent).toBe("36.74,-119.79");
    expect(api.reverseGeocode).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Fresno, California", lat: 36.74, lng: -119.79, source: "manual" });
    expect((await screen.findAllByTestId("stop-row"))).toHaveLength(1);
  });

  it("finds suggestions and accepts one from the Suggestions tab", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested" });
    await userEvent.click(screen.getByRole("tab", { name: "Stops" }));
    expect(screen.getAllByTestId("stop-row")[2].textContent).toContain("Tunnel View");
  });

  it("opens a suggestion marker as a pending place and adds it as a suggested stop", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await screen.findByTestId("suggestion-card");
    await userEvent.click(screen.getByRole("button", { name: "click first suggestion" }));
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested" });
    await waitFor(() => expect(screen.queryAllByTestId("suggestion-card")).toHaveLength(0));
  });

  it("opens a stop card from its marker, toggles visited, and opens the details drawer", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...seed[0], visited: true } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
    const card = await screen.findByRole("region", { name: "Selected stop" });
    await userEvent.click(within(card).getByLabelText("Visited"));
    expect(api.updateStop).toHaveBeenCalledWith("a", { visited: true });
    await userEvent.click(within(card).getByRole("button", { name: "Open details" }));
    expect(await screen.findByRole("dialog", { name: "Edit A" })).toBeTruthy();
  });

  it("saves a dragged marker's coordinates and reverts with an error if it fails", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: { ...seed[0], lat: 38, lng: -118 } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" }));
    expect(api.updateStop).toHaveBeenCalledWith("a", { lat: 38, lng: -118 });
    await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-118, 38], [-119.12, 37.96]]));

    vi.mocked(api.updateStop).mockRejectedValueOnce(new Error("Couldn't update the stop"));
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't update the stop");
    await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-118, 38], [-119.12, 37.96]]));
  });

  it("toggles visited through the API from the list", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const existing = newStop({});
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...existing, visited: true } });
    render(<TripEditor initialTrip={withStops([existing])} />);
    await userEvent.click(screen.getByLabelText("Visited"));
    expect(api.updateStop).toHaveBeenCalledWith("s1", { visited: true });
    await waitFor(() => expect((screen.getByLabelText("Visited") as HTMLInputElement).checked).toBe(true));
  });

  it("reverts an optimistic reorder when the API rejects", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const stop1 = newStop({ id: "s1", order: 0, name: "Pin 1" });
    const stop2 = newStop({ id: "s2", order: 1, name: "Pin 2", lat: 37.6, lng: -119.6 });
    let rejectReorder!: (e: Error) => void;
    vi.mocked(api.reorderStops).mockImplementation(() => new Promise((_resolve, reject) => { rejectReorder = reject; }));
    render(<TripEditor initialTrip={withStops([stop1, stop2])} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 2"));
    expect(api.reorderStops).toHaveBeenCalledWith("t1", ["s2", "s1"]);
    await act(async () => { rejectReorder(new Error("Couldn't save the new order")); });
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 1"));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't save the new order");
  });

  it("preserves a concurrent stop update when an in-flight reorder is later reverted", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const stop1 = newStop({ id: "s1", order: 0, name: "Pin 1" });
    const stop2 = newStop({ id: "s2", order: 1, name: "Pin 2", lat: 37.6, lng: -119.6 });
    let rejectReorder!: (e: Error) => void;
    vi.mocked(api.reorderStops).mockImplementation(() => new Promise((_resolve, reject) => { rejectReorder = reject; }));
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...stop1, visited: true } });
    render(<TripEditor initialTrip={withStops([stop1, stop2])} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 2"));
    const pin1Row = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
    await userEvent.click(within(pin1Row).getByLabelText("Visited"));
    await waitFor(() => {
      const row = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
      expect((within(row).getByLabelText("Visited") as HTMLInputElement).checked).toBe(true);
    });
    await act(async () => { rejectReorder(new Error("Couldn't save the new order")); });
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 1"));
    const after = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
    expect((within(after).getByLabelText("Visited") as HTMLInputElement).checked).toBe(true);
  });
});
```

Run: `npx vitest run src/components/editor/TripEditor.test.tsx` — Expected: FAIL (editor not rewritten).

- [ ] **Step 2: Rewrite TripEditor**

Replace `src/components/editor/TripEditor.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api } from "@/lib/api-client";
import { computeArrivals, computeBestTimes } from "@/lib/best-time";
import { formatDistance, formatDuration } from "@/lib/format";
import { coordsLabel, haversineMeters } from "@/lib/geo";
import type { LngLat, Place, RouteResult, Stop, StopSource, Suggestion, Trip, TripWithStops } from "@/lib/types";
import type { StopPatch, TripPatch } from "@/lib/validation";
import { MapView } from "./MapView";
import { PlaceCard } from "./PlaceCard";
import { SearchBar } from "./SearchBar";
import { StopCard } from "./StopCard";
import { StopDrawer } from "./StopDrawer";
import { StopList } from "./StopList";
import { StopsPanel } from "./StopsPanel";
import { SuggestionsPanel, type SuggestionsStatus } from "./SuggestionsPanel";
import { TripHeader } from "./TripHeader";

/** Hide suggestions that sit on top of an existing stop. */
const ALREADY_A_STOP_M = 100;

type LatLng = { lat: number; lng: number };
/** A place being considered: a search result, a clicked spot, or a suggestion. */
type Pending = LatLng & { name: string; source: StopSource; osmId?: string; resolving: boolean };

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function TripEditor({ initialTrip }: { initialTrip: TripWithStops }) {
  const { stops: initialStops, ...initialFields } = initialTrip;
  const [trip, setTrip] = useState<Trip>(initialFields);
  const [stops, setStops] = useState<Stop[]>(initialStops);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [adding, setAdding] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<(LatLng & { nonce: number }) | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsStatus, setSuggestionsStatus] = useState<SuggestionsStatus>("idle");
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const centerRef = useRef<LatLng | null>(null);
  const lookupSeq = useRef(0);

  const handleCenter = useCallback((c: LatLng) => {
    centerRef.current = c;
  }, []);

  // Route through the stops in order. A string key so edits that don't move anything
  // (visited, notes) don't refetch. Fewer than 2 stops means no route at all.
  const waypointKey = JSON.stringify(stops.map((s) => [s.lng, s.lat]));
  useEffect(() => {
    const coordinates = JSON.parse(waypointKey) as LngLat[];
    if (coordinates.length < 2) return;
    let cancelled = false;
    api.directions(coordinates).then(
      ({ route: next }) => {
        if (cancelled) return;
        setRoute(next);
        setRouteError(null);
      },
      (e: unknown) => {
        if (cancelled) return;
        setRoute(null);
        setRouteError(errorMessage(e, "Couldn't load the route"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [waypointKey]);

  const enoughForRoute = stops.length >= 2;
  const activeRoute = enoughForRoute ? route : null;
  const activeRouteError = enoughForRoute ? routeError : null;
  const legDurations = activeRoute ? activeRoute.legs.map((l) => l.duration) : null;

  const bestTimes = useMemo(
    () => computeBestTimes({ plannedDate: trip.plannedDate, stops }, legDurations),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- legDurations is derived from activeRoute
    [trip.plannedDate, stops, activeRoute],
  );
  const arrivals = useMemo(
    () => computeArrivals({ plannedDate: trip.plannedDate, stops }, legDurations),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- legDurations is derived from activeRoute
    [trip.plannedDate, stops, activeRoute],
  );

  async function saveTrip(patch: TripPatch) {
    const { trip: updated } = await api.updateTrip(trip.id, patch);
    setTrip(updated);
  }

  async function addStop(input: { name: string; lat: number; lng: number; source: StopSource }) {
    try {
      const { stop } = await api.addStop(trip.id, input);
      setStops((prev) => [...prev, stop]);
      return true;
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't add the stop"));
      return false;
    }
  }

  // --- Picking a place -------------------------------------------------------

  /** Map click: show the pin immediately, then name it (falling back to coordinates). */
  async function pickPoint(p: LatLng) {
    const seq = ++lookupSeq.current;
    setCardId(null);
    setPending({ ...p, name: "Looking up place…", source: "manual", resolving: true });
    let name: string;
    try {
      name = (await api.reverseGeocode(p.lat, p.lng)).place.name;
    } catch {
      name = coordsLabel(p);
    }
    if (seq === lookupSeq.current) setPending({ ...p, name, source: "manual", resolving: false });
  }

  function selectSearchResult(place: Place) {
    lookupSeq.current++; // cancel any in-flight click lookup
    setCardId(null);
    setPending({ lat: place.lat, lng: place.lng, name: place.name, source: "manual", resolving: false });
    setFlyTo({ lat: place.lat, lng: place.lng, nonce: Date.now() });
  }

  function pickSuggestion(osmId: string) {
    const s = suggestions.find((x) => x.osmId === osmId);
    if (!s) return;
    lookupSeq.current++;
    setCardId(null);
    setPending({ lat: s.lat, lng: s.lng, name: s.name, source: "suggested", osmId: s.osmId, resolving: false });
  }

  async function addPending() {
    if (!pending || pending.resolving) return;
    setAdding(true);
    const ok = await addStop({ name: pending.name, lat: pending.lat, lng: pending.lng, source: pending.source });
    setAdding(false);
    if (!ok) return;
    if (pending.osmId) dismissSuggestion(pending.osmId);
    setPending(null);
  }

  // --- Stops -----------------------------------------------------------------

  /** Apply an order-by-id map onto the latest state and re-sort by it, without
   *  touching any other field — safe against a concurrent mutation (e.g.
   *  toggling Visited) that lands on `stops` while a reorder is in flight. */
  function applyOrder(orderById: Map<string, number>) {
    setStops((cur) =>
      cur
        .map((s) => ({ ...s, order: orderById.get(s.id) ?? s.order }))
        .sort((a, b) => a.order - b.order),
    );
  }

  async function reorder(ids: string[]) {
    const previousOrderById = new Map(stops.map((s) => [s.id, s.order]));
    const byId = new Map(stops.map((s) => [s.id, s]));
    setStops(ids.map((id, order) => ({ ...byId.get(id)!, order })));
    try {
      const { stops: reordered } = await api.reorderStops(trip.id, ids);
      applyOrder(new Map(reordered.map((s) => [s.id, s.order])));
    } catch (e) {
      applyOrder(previousOrderById);
      setStopsError(errorMessage(e, "Couldn't save the new order"));
    }
  }

  function replaceStop(stop: Stop) {
    setStops((prev) => prev.map((s) => (s.id === stop.id ? stop : s)));
  }

  async function patchStop(id: string, patch: StopPatch) {
    try {
      replaceStop((await api.updateStop(id, patch)).stop);
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't update the stop"));
    }
  }

  /** Marker drag: move optimistically, revert on failure. */
  async function moveStop(id: string, p: LatLng) {
    const before = stops.find((s) => s.id === id);
    if (!before) return;
    const put = (at: LatLng) => setStops((cur) => cur.map((s) => (s.id === id ? { ...s, lat: at.lat, lng: at.lng } : s)));
    put(p);
    try {
      replaceStop((await api.updateStop(id, { lat: p.lat, lng: p.lng })).stop);
    } catch (e) {
      put(before);
      setStopsError(errorMessage(e, "Couldn't move the stop"));
    }
  }

  async function removeStop(id: string) {
    if (!window.confirm("Delete this stop?")) return;
    try {
      await api.deleteStop(id);
      setStops((prev) => prev.filter((s) => s.id !== id).map((s, order) => ({ ...s, order })));
      if (cardId === id) setCardId(null);
      if (drawerId === id) setDrawerId(null);
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't delete the stop"));
    }
  }

  function openFromList(id: string) {
    const s = stops.find((x) => x.id === id);
    if (s) setFlyTo({ lat: s.lat, lng: s.lng, nonce: Date.now() });
    setDrawerId(id);
  }

  function clickMarker(id: string) {
    lookupSeq.current++;
    setPending(null);
    setCardId(id);
  }

  // --- Suggestions -----------------------------------------------------------

  async function findSuggestions() {
    if (!activeRoute) return;
    setSuggestionsStatus("loading");
    setSuggestionsError(null);
    try {
      const { suggestions: found } = await api.suggestions(activeRoute.geometry);
      setSuggestions(found.filter((s) => !stops.some((st) => haversineMeters(st, s) < ALREADY_A_STOP_M)));
      setSuggestionsStatus("done");
    } catch (e) {
      setSuggestionsStatus("error");
      setSuggestionsError(errorMessage(e, "Couldn't load suggestions. Please retry."));
    }
  }

  function dismissSuggestion(osmId: string) {
    setSuggestions((prev) => prev.filter((s) => s.osmId !== osmId));
  }

  async function acceptSuggestion(s: Suggestion) {
    if (await addStop({ name: s.name, lat: s.lat, lng: s.lng, source: "suggested" })) dismissSuggestion(s.osmId);
  }

  const cardIndex = stops.findIndex((s) => s.id === cardId);
  const cardStop = cardIndex >= 0 ? stops[cardIndex] : null;
  const drawerStop = stops.find((s) => s.id === drawerId) ?? null;

  return (
    <div className="relative h-[calc(100dvh-3rem)] overflow-hidden">
      <MapView
        stops={stops}
        routeGeometry={activeRoute?.geometry ?? null}
        pending={pending}
        suggestions={suggestions}
        highlightedSuggestionId={highlightedId}
        selectedId={cardId}
        flyTo={flyTo}
        onMapClick={(p) => void pickPoint(p)}
        onStopClick={clickMarker}
        onStopMove={(id, p) => void moveStop(id, p)}
        onSuggestionClick={pickSuggestion}
        onCenterChange={handleCenter}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 space-y-2 lg:inset-x-auto lg:left-[388px] lg:w-[460px]">
        <div className="pointer-events-auto">
          <SearchBar getProximity={() => centerRef.current} onSelect={selectSearchResult} />
        </div>
        {pending && (
          <div className="pointer-events-auto">
            <PlaceCard
              name={pending.name}
              resolving={pending.resolving}
              busy={adding}
              onAdd={() => void addPending()}
              onClose={() => {
                lookupSeq.current++;
                setPending(null);
              }}
            />
          </div>
        )}
        {cardStop && !pending && (
          <div className="pointer-events-auto">
            <StopCard
              stop={cardStop}
              bestTime={bestTimes[cardIndex] ?? null}
              arrival={arrivals[cardIndex] ?? null}
              onToggleVisited={(visited) => void patchStop(cardStop.id, { visited })}
              onOpenDetails={() => setDrawerId(cardStop.id)}
              onClose={() => setCardId(null)}
            />
          </div>
        )}
      </div>

      {stops.length === 0 && !pending && (
        <p data-testid="empty-hint" className="pointer-events-none absolute inset-x-0 top-1/3 px-6 text-center text-sm text-gray-700">
          Search for a place or click the map to add your first stop.
        </p>
      )}

      <StopsPanel
        header={<TripHeader trip={trip} onSave={saveTrip} />}
        summary={
          <>
            <p className="text-xs text-gray-500">{stops.length} {stops.length === 1 ? "stop" : "stops"}</p>
            <p data-testid="route-status" className="text-sm text-gray-700">
              {activeRoute
                ? `${formatDistance(activeRoute.distance)} · ${formatDuration(activeRoute.duration)}`
                : activeRouteError
                  ? "Route unavailable"
                  : enoughForRoute
                    ? "Loading route…"
                    : "Add 2 stops to see the route"}
            </p>
            <ErrorBanner message={activeRouteError} onDismiss={() => setRouteError(null)} />
            <ErrorBanner message={stopsError} onDismiss={() => setStopsError(null)} />
          </>
        }
        stops={
          <>
            <p className="text-xs text-gray-500">Drag ⋮⋮ to reorder. Click the map or search to add stops.</p>
            <StopList
              stops={stops}
              bestTimes={bestTimes}
              onReorder={(ids) => void reorder(ids)}
              onToggleVisited={(id, visited) => void patchStop(id, { visited })}
              onDelete={(id) => void removeStop(id)}
              onSelect={openFromList}
            />
          </>
        }
        suggestions={
          <SuggestionsPanel
            status={suggestionsStatus}
            suggestions={suggestions}
            error={suggestionsError}
            canSearch={activeRoute !== null}
            onFind={() => void findSuggestions()}
            onAccept={(s) => void acceptSuggestion(s)}
            onDismiss={dismissSuggestion}
            onHover={setHighlightedId}
            onDismissError={() => {
              setSuggestionsError(null);
              setSuggestionsStatus("idle");
            }}
          />
        }
        suggestionCount={suggestions.length}
      />

      {drawerStop && (
        <StopDrawer
          key={drawerStop.id}
          stop={drawerStop}
          onClose={() => setDrawerId(null)}
          onSave={async (patch) => replaceStop((await api.updateStop(drawerStop.id, patch)).stop)}
          onPhotoChange={replaceStop}
        />
      )}
    </div>
  );
}
```

Notes for the implementer: `StopDrawer` already renders `z-20` and full-width on phones (`w-full max-w-md`), so it sits above the panel (`z-10`) and needs no change. `TripHeader` sits inside the panel header; its edit form expands inside the panel.

- [ ] **Step 3: Run to verify, then commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: PASS. If a test about `TripHeader` inside the panel fails because the collapsed panel hides the summary, check that the initial snap is `"half"` (it is) and that tests do not collapse it.

```bash
git add -A
git commit -m "feat: map-first TripEditor with search bar, place/stop cards, floating stops panel"
```

### Phase 3 checkpoint

- [ ] Append "map-first UI: Phase 3 (stops panel and editor) complete" to `PROGRESS.md` (note the on-map card deviation from the spec's "popup": cards are React overlays under the search bar, so they behave identically on the real and offline maps) and commit.

---

## Phase 4 — End-to-end, verification, docs

### Task 9: Rewrite the Playwright golden path

**Files:**
- Modify: `e2e/golden-path.spec.ts`

**Interfaces:**
- Consumes: the offline fake map (fixed viewport lat 36–38 / lng −121…−118), fake geocode results `"<query> (fake)"`, fake reverse geocode `"Spot <lat>, <lng> (fake)"`, fake suggestions.

- [ ] **Step 1: Rewrite the test**

Replace `e2e/golden-path.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("sign up → new trip → search + click to add stops → suggestion → reorder → mark visited", async ({ page }) => {
  // Sign up
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);

  // New trip: just a name and a date, then the empty map
  await page.getByLabel("Trip name").fill("Sierra loop");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(page.getByTestId("empty-hint")).toBeVisible();
  await expect(page.getByTestId("route-status")).toHaveText("Add 2 stops to see the route");

  // Stop 1: search as you type, pick the result, add it
  await page.getByRole("combobox", { name: "Search for a place" }).fill("Alpha Town");
  await page.getByRole("button", { name: "Alpha Town (fake)" }).click();
  await page.getByRole("button", { name: "Add stop" }).click();
  const rows = page.getByTestId("stop-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Alpha Town (fake)");

  // Stop 2: click the map, wait for the lookup to name it, add it
  await page.getByTestId("map").click({ position: { x: 400, y: 300 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("route-status")).toHaveText(/km/);
  await expect(page.getByTestId("stop-role")).toHaveText(["Start", "End"]);

  // Accept a suggestion from the Suggestions tab
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  const card = page.getByTestId("suggestion-card").first();
  const suggestionName = (await card.getByTestId("suggestion-name").textContent())!;
  await card.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("tab", { name: "Stops" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText(suggestionName);

  // Reorder: move the suggestion to the top using dnd-kit's keyboard sensor
  const handle = rows.nth(2).getByTestId("drag-handle");
  await handle.focus();
  await page.keyboard.press("Space");
  // dnd-kit's keyboard sensor needs a tick between activation and movement.
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  // Wait for the reorder to persist before reloading (reload can abort an in-flight fetch).
  const orderPersisted = page.waitForResponse(
    (res) => res.request().method() === "PUT" && res.url().includes("/stops/order"),
  );
  await page.keyboard.press("Space");
  await orderPersisted;
  await expect(rows.first()).toContainText(suggestionName);
  await page.reload();
  await expect(rows.first()).toContainText(suggestionName);

  // Mark visited (persists). The checkbox is controlled by server state, so click
  // and let the auto-retrying assertion wait for the PATCH to land.
  const visitedPersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/stops/"),
  );
  await rows.first().getByLabel("Visited").click();
  await visitedPersisted;
  await expect(rows.first().getByLabel("Visited")).toBeChecked();
  await page.reload();
  await expect(rows.first().getByLabel("Visited")).toBeChecked();
});
```

Adjustments the implementer may need, in order of likelihood: the map click position (`x: 400, y: 300`) must land inside the map element at the e2e viewport (check `playwright.config.ts`; pick a point not covered by the panel/search bar overlay, e.g. the right-hand side); the Suggestions tab's "Find photo spots" needs the route, which exists after two stops. Do not weaken assertions; fix positions/waits.

- [ ] **Step 2: Run the whole verification and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run e2e`
Expected: all PASS; run `npm run e2e` three times in a row to rule out flakiness.

```bash
git add -A
git commit -m "test: rewrite the e2e golden path for the map-first flow"
```

### Task 10: Real-browser verification, docs, merge and deploy

**Files:**
- Modify: `README.md`, `PROGRESS.md`, `HANDOFF.md`

- [ ] **Step 1: Run the whole-branch review and the two extra passes**

Per the standing rules: dispatch the final whole-branch code review, then the read-only bug-hunting and security passes (all Sonnet); fix Critical/Important findings with tests, re-run `npm test && npm run typecheck && npm run lint && npm run build && npm run e2e`.

- [ ] **Step 2: Verify the real Mapbox map in a real browser**

The real `MapPanel` cannot be unit-tested. Use `npm run dev` with real tokens in `.env` (or the deployed preview) and, with the Claude-in-Chrome browser tools, check and record the result of each item below (anything you cannot verify must be written down as unverified in `PROGRESS.md`, not claimed):

1. The map fills the page; the stops panel floats on the left; on a narrow window it is a bottom sheet that cycles collapsed/half/full.
2. Typing in the search bar shows suggestions after a short pause; choosing one flies the map there and shows the pin and the Add-stop card.
3. Clicking an empty spot and clicking a named landmark both show a card with a place name (or coordinates) and **Add stop** appends a numbered marker.
4. Dragging a numbered marker moves the stop, redraws the route, and survives a reload.
5. With 2+ stops the route line appears; clicking a marker shows the stop card with best time and arrival; **Open details** opens the drawer.
6. **Find photo spots** shows faint amber markers; hovering a suggestion enlarges its marker; clicking a marker opens its card; **Add stop** adds it.
7. The browser console shows no errors.

Fix anything that fails (with a regression test where the code is testable) and re-verify.

- [ ] **Step 3: Update docs**

`README.md`: rewrite section 1/"how to use" to describe the map-first flow (search, click, drag, panel tabs), remove start/end mentions, and update section 5 ("How best time is computed") to say departure is sunrise at the **first stop** and arrival is cumulative drive time from it. `PROGRESS.md`: add a "map-first UI complete" entry with the verification results from Step 2 (including anything unverified), the final test counts, and the migration note. `HANDOFF.md`: update "Current status".

- [ ] **Step 4: Merge, deploy and smoke-test the live site**

```bash
git add -A && git commit -m "docs: map-first UI complete"
git checkout main && git merge --ff-only map-first-ui && git push origin main
```
Pushing `main` redeploys on Vercel; the build's `vercel-build` step applies the new migration to Turso. Confirm in the Vercel build log: `Applied migration 20261007120000_drop_trip_start_end`. Then smoke-test https://photo-app-pi2o.vercel.app: sign up with a throwaway account, create a trip, add two stops by search and by click, upload a photo to a stop, then delete the trip and the throwaway user (`~/.turso/turso db shell photo-app "DELETE FROM User WHERE email='<throwaway>';"`). Record the outcome in `PROGRESS.md` and commit.

- [ ] **Step 5: Clean up branches**

```bash
git branch -d map-first-ui
git push origin --delete map-first-ui 2>/dev/null || true
```
Expected: only `main` remains locally and on GitHub.
