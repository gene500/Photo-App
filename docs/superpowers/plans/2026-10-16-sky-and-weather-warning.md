# Sky Preview and Weather Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each stop's sunrise/sunset direction and moon info (compass card in the stop drawer plus direction lines on the map), and warn in plain words when a stop's chosen light is forecast to be poor.

**Architecture:** A pure sky-math module (`src/lib/sky.ts`) feeds a drawer card and a `sky` prop that both map implementations draw. The warning is a new pure function in `src/lib/weather.ts` whose result rides on the existing `WeatherLine` and is rendered in the stop list and the drawer. No server, database or API changes.

**Tech Stack:** Next.js (App Router, client components), TypeScript, `suncalc` (already installed), Mapbox GL (`MapPanel`), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-sky-and-weather-warning-design.md`

## Global Constraints

- Bearings are compass degrees clockwise from north, 0 to under 360. The installed `suncalc` (2.1.1) already returns azimuth in degrees clockwise from north; normalize it to [0, 360), do not convert it.
- The sky card and the fake-map lines need no network.
- Colours come from the existing theme tokens (the classes used by neighbouring components); nothing hard-coded for light or dark mode. Map line colours are the exception, as `ROUTE_COLOR` is in `MapPanel.tsx`.
- "Poor" is the existing rating from `lightQuality` in `src/lib/weather.ts` (rain chance 50% or more, or cloud cover 80% or more). Thresholds do not change.
- The badge is informational: no buttons, no suggestions, no reordering. No badge for "good" or "fair", for the "any" light preference, or when the forecast is unavailable.
- Times use `formatClock(date, undefined, settings.timeFormat)` so they match the stop list.
- `AGENTS.md` says this Next.js has breaking changes and to read `node_modules/next/dist/docs/` before writing Next.js code. These tasks add only client components and plain props, but skim the docs for client components before Task 6 touches `TripEditor.tsx`.
- Commit messages end with the attribution lines the session specifies.

## Review Focus

1. A stop in polar day or polar night (e.g. lat 78): the card shows "Sun does not rise/set" text, no lines are drawn, nothing throws.
2. Longitudes far from Greenwich (e.g. lng -170 and 170): sunrise, sunset and moonrise fall in the stop's own local solar day.
3. A cloudy stop with the "any" light preference: no badge.
4. A poor "typical" forecast (beyond the forecast horizon): the badge says "Typically ...", never "likely washed out".
5. Deselecting or deleting the selected stop: the map lines disappear (null `sky` yields no lines).

---

### Task 1: Sky math

**Files:**
- Create: `src/lib/sky.ts`
- Test: `src/lib/sky.test.ts`

**Interfaces:**
- Consumes: `solarDayAnchor(plannedDate: string, lng: number): Date` and `getSunWindows(lat, lng, plannedDate): SunWindows` from `src/lib/best-time.ts`.
- Produces:
  - `type MoonPhaseName = "new moon" | "waxing crescent" | "first quarter" | "waxing gibbous" | "full moon" | "waning gibbous" | "last quarter" | "waning crescent"`
  - `type SkyEvent = { bearing: number; at: Date }`
  - `type SkyInfo = { sunrise: SkyEvent | null; sunset: SkyEvent | null; alwaysUp: boolean; alwaysDown: boolean; moon: { phase: MoonPhaseName; illuminationPct: number; rise: Date | null } }`
  - `compassWord(bearing: number): string` (16-point: N, NNE, NE, ENE, E, ESE, SE, SSE, S, SSW, SW, WSW, W, WNW, NW, NNW)
  - `moonPhaseName(phase: number): MoonPhaseName` (phase 0..1; eight buckets, index `Math.round(phase * 8) % 8`)
  - `getSkyInfo(lat: number, lng: number, plannedDate: string): SkyInfo`

- [ ] **Step 1: Write the failing tests** in `src/lib/sky.test.ts`:
  - `compassWord`: `0` gives `"N"`, `72` gives `"ENE"`, `90` gives `"E"`, `288` gives `"WNW"`, `348` gives `"NNW"`, `359` gives `"N"`.
  - `moonPhaseName`: `0` gives `"new moon"`, `0.125` `"waxing crescent"`, `0.25` `"first quarter"`, `0.375` `"waxing gibbous"`, `0.5` `"full moon"`, `0.625` `"waning gibbous"`, `0.75` `"last quarter"`, `0.875` `"waning crescent"`, `0.99` `"new moon"`.
  - `getSkyInfo(0, 0, "2026-03-20")`: sunrise bearing within 2 of 90, sunset within 2 of 270 (equinox).
  - `getSkyInfo(37.7156, -119.6773, "2026-06-21")`: sunrise within 2 of 60, sunset within 2 of 300. Same place on `"2026-12-21"`: sunrise within 2 of 120, sunset within 2 of 240.
  - Moon: `getSkyInfo(0, 0, "2000-01-06").moon` has `phase "new moon"` and `illuminationPct < 5`; `getSkyInfo(0, 0, "2000-01-21").moon` has `phase "full moon"` and `illuminationPct > 95`.
  - Polar (review focus 1): `getSkyInfo(78, 15, "2026-06-21")` has `alwaysUp: true`, `sunrise: null`, `sunset: null`; on `"2026-12-21"` it has `alwaysDown: true` and both null.
  - Far longitudes (review focus 2): for `lng` in `[-170, 170]` at lat 40 on `"2026-07-01"`, sunrise and sunset `at` fall within 12 hours of `solarDayAnchor("2026-07-01", lng)`, and a non-null `moon.rise` does too.
- [ ] **Step 2: Run** `npx vitest run src/lib/sky.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `sky.ts`.** Use `suncalc`'s `getPosition(date, lat, lng).azimuth` at the sunrise and sunset instants from `getSunWindows`; `getMoonIllumination(anchor)` for phase and fraction; `getMoonTimes(anchor, lat, lng)`, which covers the same local solar day as `getTimes`. Treat a missing `rise` as null.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `src/lib/sky.ts src/lib/sky.test.ts` as `feat: sky math (sun bearings, moon phase)`.

### Task 2: Weather warning wording

**Files:**
- Modify: `src/lib/weather.ts` (add `lightWarning`), `src/lib/use-weather.ts` (extend `WeatherLine` and `weatherLine`)
- Test: `src/lib/weather.test.ts` (existing; create if absent), `src/lib/use-weather.test.tsx`

**Interfaces:**
- Consumes: `lightQuality`, `WeatherSummary`, `summarizeAt` in `src/lib/weather.ts`.
- Produces:
  - `lightWarning(pref: LightPref, w: Pick<WeatherSummary, "cloudPct" | "rainPct">, typical?: boolean): string | null`
  - `WeatherLine` gains `warning?: string`, set by `weatherLine` when `lightWarning` returns a string.

- [ ] **Step 1: Write the failing tests.**
  - `lightWarning("golden", { cloudPct: 85, rainPct: 10 })` is `"Golden hour: 85% cloud, likely washed out"`.
  - `lightWarning("sunset", { cloudPct: 40, rainPct: 70 })` is `"Sunset: rain likely"`.
  - `lightWarning("sunrise", { cloudPct: 85, rainPct: 10 })` is `"Sunrise: 85% cloud, likely washed out"`.
  - Rain wins when both are poor: `lightWarning("sunset", { cloudPct: 90, rainPct: 60 })` is `"Sunset: rain likely"`.
  - Typical (review focus 4): `lightWarning("golden", { cloudPct: 85, rainPct: 10 }, true)` is `"Typically cloudy for golden hour"`; `lightWarning("sunset", { cloudPct: 40, rainPct: 70 }, true)` is `"Typically rainy for sunset"`.
  - Null cases (review focus 3): `"any"` with 95% cloud, and `"golden"` with `{ cloudPct: 30, rainPct: 5 }` or `{ cloudPct: 60, rainPct: 5 }` all return `null`.
  - In `use-weather.test.tsx`, following its existing fixtures: `weatherLine` for a `golden` stop with an hour of 85% cloud has `warning "Golden hour: 85% cloud, likely washed out"`; the same data with `typical: true` on the forecast has the typical wording; an unavailable forecast has no `warning`.
- [ ] **Step 2: Run** `npx vitest run src/lib/weather.test.ts src/lib/use-weather.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `lightWarning` returns null unless `lightQuality(pref, w) === "poor"`; light names are `sunrise: "Sunrise"`, `golden: "Golden hour"`, `sunset: "Sunset"` (lower-cased in the typical wording). Round percentages with `Math.round`. In `weatherLine`, pass `forecast.typical === true`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** as `feat: plain-words warning for poor forecast light`.

### Task 3: Warning badge in the stop list and drawer

**Files:**
- Modify: `src/components/editor/StopList.tsx` (in `StopRow`, after the `stop-weather` paragraph, ~line 129-133), `src/components/editor/StopDrawer.tsx`
- Test: `src/components/editor/StopList.test.tsx`, `src/components/editor/StopDrawer.test.tsx`

**Interfaces:**
- Consumes: `WeatherLine.warning` (Task 2); `useWeatherLine(lat, lng, arrival, pref): WeatherLine | null`.
- Produces: `StopDrawer` gets a new optional prop `arrival?: Date | null` and renders the badge from `useWeatherLine(stop.lat, stop.lng, arrival ?? null, lightPref)` using the drawer's current `lightPref` state. Both places render `<p data-testid="light-warning" className="text-xs text-danger">{warning}</p>`.

- [ ] **Step 1: Write the failing tests.** Mock `@/lib/use-weather`'s `useWeatherLine` the way the neighbouring tests already do. `StopList`: a row whose line has `warning: "Golden hour: 85% cloud, likely washed out"` shows that text in `light-warning`; a row without `warning` has no `light-warning` element. `StopDrawer`: with `arrival` passed and a mocked warning, the badge shows; with a mocked line lacking `warning`, it does not; the badge contains no button.
- [ ] **Step 2: Run** `npx vitest run src/components/editor/StopList.test.tsx src/components/editor/StopDrawer.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** both renderings as described under Interfaces.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** as `feat: show poor-light warning on stops`.

### Task 4: Sky card in the stop drawer

**Files:**
- Create: `src/components/editor/SkyCard.tsx`
- Modify: `src/components/editor/StopDrawer.tsx`
- Test: `src/components/editor/SkyCard.test.tsx`, `src/components/editor/StopDrawer.test.tsx`

**Interfaces:**
- Consumes: `getSkyInfo`, `compassWord` (Task 1); `formatClock` from `src/lib/best-time.ts`; `useSettings().settings.timeFormat` (works without a provider, it has defaults).
- Produces: `SkyCard({ lat, lng, plannedDate }: { lat: number; lng: number; plannedDate: string })`, root element `data-testid="sky-card"`. `StopDrawer` gets a new required prop `plannedDate: string` and renders `<SkyCard>` next to the Best light control.

Card content: an SVG compass dial (`role="img"`, `aria-label` like `Sunrise from ENE 72°, sunset toward WNW 288°`) with two markers; text rows `Sunrise 6:52 AM · ENE 72°` and `Sunset 6:20 PM · WNW 288°`; a moon row `Waxing gibbous · 78% lit · Moonrise 3:12 PM`, or `... · No moonrise this day`. Polar rows read `Sun does not rise on this date` / `Sun does not set on this date`, and the dial shows no markers.

- [ ] **Step 1: Write the failing tests.** `SkyCard` at (37.7156, -119.6773, "2026-06-21"): text contains `Sunrise`, `ENE` or `NE`, a degree value matching `/\b(5[89]|6[0-2])°/`, `Sunset`, and a moon phase word from the allowed set; the dial has an `aria-label` containing both bearings. Polar (review focus 1): (78, 15, "2026-06-21") shows `Sun does not set on this date` and no `Sunrise` time row; (78, 15, "2026-12-21") shows `Sun does not rise on this date`. `StopDrawer` renders `sky-card` given a `plannedDate`. Invalid input: `SkyCard` with `lat` or `lng` of `NaN`, or a `plannedDate` that is not `YYYY-MM-DD`, renders nothing (no `sky-card`) and does not throw.
- [ ] **Step 2: Run** `npx vitest run src/components/editor/SkyCard.test.tsx src/components/editor/StopDrawer.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `SkyCard`** with theme-token classes like the neighbouring drawer sections, compute `getSkyInfo` with `useMemo` on `[lat, lng, plannedDate]`, and update every existing `<StopDrawer>` in tests to pass `plannedDate`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** as `feat: sun and moon card in the stop drawer`.

### Task 5: Direction lines on the maps

**Files:**
- Modify: `src/lib/geo.ts` (add `bearingEndpoint`), `src/components/editor/map-types.ts`, `src/components/editor/FakeMapPanel.tsx`, `src/components/editor/MapPanel.tsx`
- Test: `src/lib/geo.test.ts`, `src/components/editor/FakeMapPanel.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime (the `sky` prop carries finished bearings).
- Produces:
  - `bearingEndpoint(origin: { lat: number; lng: number }, bearing: number, distanceKm: number): [lng: number, lat: number]` (great-circle destination, Earth radius 6371.0088 km).
  - `MapViewProps.sky?: { lat: number; lng: number; sunrise: number | null; sunset: number | null } | null` (bearings in degrees).
  - `FakeMapPanel` draws, for a non-null `sky`, one SVG `polyline` per non-null bearing with `data-testid="sky-line-sunrise"` / `"sky-line-sunset"` and `data-bearing`, each 30 km long, in the existing route `<svg>`.
  - `MapPanel` adds a GeoJSON source `sky` and two line layers plus a symbol layer for the labels `Sunrise` / `Sunset`, created in the existing `map.on("load")` block and updated in an effect on `[loaded, sky]` and on `zoomend`. Line length is 90 screen pixels: `km = 90 * 78271.51696 * Math.cos(lat * Math.PI / 180) / 2 ** map.getZoom() / 1000`. A null `sky` empties the source.

- [ ] **Step 1: Write the failing tests.** `bearingEndpoint({lat: 0, lng: 0}, 90, 111.195)` is within 0.01 of `[1, 0]`; bearing `0` gives within 0.01 of `[0, 1]`; at `{lat: 89, lng: 0}` with bearing `90` and 50 km the result is finite and has latitude within 0.1 of 89. `FakeMapPanel` with `sky = {lat: 37, lng: -119.5, sunrise: 60, sunset: 300}` renders both lines with the right `data-bearing`; with `sunrise: null` only the sunset line; with `sky` null or undefined (review focus 5) neither.
- [ ] **Step 2: Run** `npx vitest run src/lib/geo.test.ts src/components/editor/FakeMapPanel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper, the prop and both panels. `MapPanel` has no unit tests (it needs WebGL), so also run the type check in Step 4.
- [ ] **Step 4: Run** `npx vitest run src/lib/geo.test.ts src/components/editor/FakeMapPanel.test.tsx && npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** as `feat: sunrise and sunset direction lines on the map`.

### Task 6: Wire into TripEditor, end-to-end check, final verification

**Files:**
- Modify: `src/components/editor/TripEditor.tsx` (around `<MapView>` ~line 624 and `<StopDrawer>` ~line 768)
- Create: `e2e/sky-preview.spec.ts`
- Modify: `TODO.md` (only if the Mapbox token is unavailable)

**Interfaces:**
- Consumes: `getSkyInfo` (Task 1), `MapViewProps.sky` (Task 5), `StopDrawer` props `plannedDate` and `arrival` (Tasks 3 and 4).

- [ ] **Step 1: Write the failing e2e** in `e2e/sky-preview.spec.ts`, following the sign-up and trip-creation steps of `e2e/alternatives.spec.ts` with planned date `2026-07-01`: add one stop by clicking the map; click the stop's marker button and expect `sky-line-sunrise` and `sky-line-sunset` to be visible; open the stop's drawer (the row's first button) and expect `sky-card` to be visible and to contain `Sunrise` and `Sunset`; delete the stop and expect no `sky-line-sunrise`.
- [ ] **Step 2: Run** `npx playwright test e2e/sky-preview.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the wiring.** In `TripEditor`, compute `sky` with `useMemo` from the stop whose id is `cardId` (`getSkyInfo(stop.lat, stop.lng, trip.plannedDate)`; bearings null when absent; `sky` null when nothing is selected) and pass it to `<MapView sky={sky} />`. Pass `plannedDate={trip.plannedDate}` and `arrival={arrivals[stops.findIndex((s) => s.id === drawerStop.id)] ?? null}` to `<StopDrawer>`.
- [ ] **Step 4: Verify everything.** Run `npm run typecheck && npm run lint && npm test && npx playwright test e2e/sky-preview.spec.ts e2e/weather.spec.ts e2e/light-aware.spec.ts`. Expected: all pass. Then check by hand in the offline preview (`EXTERNAL_APIS_FAKE=1 NEXT_PUBLIC_MAP_FAKE=1 npm run dev`) that the card and lines look right in light and dark mode. Then verify the real Mapbox lines with the owner's token, which they put in the gitignored `.env` as `NEXT_PUBLIC_MAPBOX_TOKEN` and `MAPBOX_TOKEN`: run `EXTERNAL_APIS_FAKE=1 npm run dev` (real map, fake data), select a stop, and use Playwright to confirm both lines and their labels appear, stay about 90 px long after zooming in and out, and disappear when the stop is deselected. If the token is not available, add one line to `TODO.md` under "To verify by hand" instead.
- [ ] **Step 5: Commit** as `feat: wire sky preview into the trip editor`.
