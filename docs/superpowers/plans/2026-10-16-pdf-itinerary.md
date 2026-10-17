# PDF Itinerary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Download PDF" action in the editor's Export menu and on the public share page that saves a PDF with a route map and a stop-by-stop schedule.

**Architecture:** Pure builders (`itinerary.ts`, `static-map.ts`) turn data the pages already hold into an `ItineraryInput` and a Mapbox Static Images URL. A browser-only renderer (`itinerary-pdf.ts`) lays the PDF out with jsPDF, loaded by dynamic `import()` on click. One hook (`useItineraryDownload`) owns busy/error state and the download for both buttons.

**Tech Stack:** Next.js (client components), TypeScript, jsPDF 4.2.1 (new, exact pin), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-pdf-itinerary-design.md`

## Global Constraints

- jsPDF is added as an exact dependency (`4.2.1`, no caret) and is only ever imported with `await import("jspdf")` inside functions that run on click. No static `import ... from "jspdf"` anywhere in `src/`.
- Nothing is sent to the app's server. The only network request is the Mapbox static image, to `https://api.mapbox.com` (already allowed by the CSP).
- Static map URL: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/<overlays>/auto/<w>x<h>@2x?access_token=<token>`; at most 7,500 characters; `w` and `h` at most 1280 (before `@2x`). Used size: 640 x 400.
- The map token is `process.env.NEXT_PUBLIC_MAPBOX_TOKEN`. When `process.env.NEXT_PUBLIC_MAP_FAKE === "1"` or the token is empty, no request is made and the fallback map is used.
- Map loading gives up after 8 seconds and uses the fallback.
- Times use `formatClock(date, undefined, timeFormat)` from `src/lib/best-time.ts`, distances `formatDistance(meters, unit)` and durations `formatDuration(seconds)` from `src/lib/format.ts`, so the PDF matches the screen.
- Download file name: `<slug>-itinerary.pdf`, slug built exactly like `gpxFileName` in `src/lib/export.ts` (ASCII letters, digits, `_`, dashes; 60 chars max); `trip-itinerary.pdf` when the slug is empty.
- PDF text is limited to what standard PDF fonts draw: every character above U+00FF is replaced by `?`, control characters other than newline are removed. Weather uses the words (`WeatherLine.label ?? text`), never the emoji glyph.
- The share page PDF has no weather line. The editor PDF has one only where a forecast exists.
- A second click while a PDF is being prepared does nothing (guard with a ref, not only React state).
- `AGENTS.md` says this Next.js has breaking changes and to read `node_modules/next/dist/docs/` before writing Next.js code. Skim the client-component and `process.env.NEXT_PUBLIC_*` docs before Task 5.
- Commit messages end with the attribution lines the session specifies.

## Deviations from the spec (rulings)

- The fallback map is drawn with jsPDF vector primitives inside the PDF, not on a canvas and returned as a data URL (no canvas exists in the Vitest/jsdom environment, and vector output is sharper and testable). `renderItineraryPdf` therefore takes `map: PdfMap` (`{ kind: "image"; dataUrl: string } | { kind: "fallback" }`); `drawFallbackMap` is internal to the renderer.
- Weather for the editor PDF is fetched at click time by `loadWeatherLines` (new, Task 4) using the existing `loadForecast`, because weather is otherwise only held inside per-stop hooks.

## Review Focus

1. 40+ stops: the schedule paginates with a "Page n of N" footer and the static-map URL stays at or under 7,500 characters (Tasks 2, 3).
2. A route line with thousands of points: downsampled until the URL fits, shape kept (Task 2).
3. Empty notes, no light preference, no arrival time, no weather: no blank labels or the text `undefined`/`null` (Tasks 1, 3).
4. Long stop names and notes wrap rather than run off the page (Task 3).
5. Weather text with emoji and names outside Latin-1 print as words / `?`, never crash (Task 3).
6. Double click: exactly one download (Task 4).

---

### Task 1: Itinerary data builder

**Files:**
- Create: `src/lib/itinerary.ts`
- Test: `src/lib/itinerary.test.ts`

**Interfaces:**
- Consumes: `formatClock` (`src/lib/best-time.ts`), `formatDistance`, `formatDuration` (`src/lib/format.ts`), `lightLabel` (`src/lib/light-windows.ts`), types `LightPref` (`src/lib/types.ts`), `TimeFormat`/`DistanceUnit` (as used by `src/lib/settings.ts`), `WeatherLine` (`src/lib/use-weather.ts`; import as a type only).
- Produces:
  - `type ItineraryStopSource = { name: string; lat: number; lng: number; notes: string | null; shotNotes?: string | null; lightPref: LightPref; arrival: Date | null }`
  - `type ItineraryStop = { index: number; name: string; arrival: string; bestLight: string | null; weather: string | null; notes: string | null }` (`index` is 1-based)
  - `type ItineraryInput = { tripName: string; dateLine: string; startLine: string | null; routeLine: string | null; stops: ItineraryStop[] }`
  - `buildItinerary(a: { tripName: string; plannedDate: string; departAt: Date | null; totalDistanceM: number | null; totalDurationS: number | null; stops: ItineraryStopSource[]; weather?: (Pick<WeatherLine, "text" | "label" | "warning"> | null)[]; timeFormat: TimeFormat; distanceUnit: DistanceUnit }): ItineraryInput`
  - `itineraryFileName(tripName: string): string`

- [ ] **Step 1: Write failing tests** in `src/lib/itinerary.test.ts`: (a) two stops with arrivals produce `index` 1 and 2 in order, `arrival` formatted by `formatClock` (e.g. `"6:30 AM"` with `timeFormat: "12h"`, `"06:30"` with `"24h"`; build the Date with a local-time constructor so the test is timezone-proof); (b) `arrival: null` gives `"Time not set"`; (c) `lightPref: "golden"` (use whatever value `lightLabel` maps to a label) gives `bestLight: "Best at <label lowercased>"`, `"any"` gives `null`; (d) `notes` and `shotNotes` both present are joined with a blank line into `notes`; both empty/whitespace give `null`; (e) `weather[i]` with `{ text: "☀️ 21°", label: "Sunny, 21°C", warning: "Cloud likely" }` gives `weather: "Sunny, 21°C. Cloud likely"`; without `label` falls back to `text`; `null` or missing array gives `null`; (f) `routeLine` is `"<formatDistance> · <formatDuration>"` or `null` when either total is null; (g) `startLine` is `"Starts <clock>"` or `null` when `departAt` is null; `dateLine` is `"Planned for <plannedDate>"`; (h) `itineraryFileName("Big Sur / 2026")` is `"Big-Sur-2026-itinerary.pdf"`, `itineraryFileName("???")` is `"trip-itinerary.pdf"`; (i) no output string anywhere contains `"undefined"` or `"null"` for a bare stop.
- [ ] **Step 2: Run** `npx vitest run src/lib/itinerary.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the types and both functions in `src/lib/itinerary.ts`. Reuse the slug rule from `gpxFileName` by extracting its slug step into an exported `fileSlug(name: string): string` in `src/lib/export.ts` and calling it from both (existing `gpxFileName` behavior and tests unchanged).
- [ ] **Step 4: Run** `npx vitest run src/lib/itinerary.test.ts src/lib/export.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: itinerary data builder for the PDF`.

### Task 2: Static map URL builder

**Files:**
- Create: `src/lib/static-map.ts`
- Test: `src/lib/static-map.test.ts`

**Interfaces:**
- Consumes: `downsampleRoute(points: LngLat[], target?: number): LngLat[]` from `src/lib/downsample.ts`; `LngLat` from `src/lib/types.ts`.
- Produces:
  - `encodePolyline(points: LngLat[]): string` (Google polyline algorithm, precision 5, input `[lng, lat]`, output unescaped)
  - `STATIC_MAP_MAX_URL = 7500`
  - `staticMapUrl(a: { stops: { lat: number; lng: number }[]; geometry: LngLat[]; token: string | null; width?: number; height?: number }): string | null` (defaults 640 x 400)

- [ ] **Step 1: Write failing tests** in `src/lib/static-map.test.ts`: (a) `encodePolyline([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]])` equals `"_p~iF~ps|U_ulLnnqC_mqNvxq`@"` (the canonical example from Google's documentation); (b) `staticMapUrl` with 2 stops, a token and a 3-point geometry starts with `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/`, contains `pin-s-1+` and `pin-s-2+`, a `path-` overlay containing the `encodeURIComponent` of the encoded polyline, ends with `/auto/640x400@2x?access_token=TOKEN`; (c) `token: null`, `""`, or fewer than 2 stops returns `null`; (d) a 20,000-point geometry plus 40 stops returns a URL of length at most `STATIC_MAP_MAX_URL`; (e) pins past 99 omit the number (`pin-s+`) rather than producing an invalid label; (f) width/height above 1280 are clamped to 1280; (g) empty geometry yields pins only, no `path-` overlay, still a URL.
- [ ] **Step 2: Run** `npx vitest run src/lib/static-map.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions in `src/lib/static-map.ts`. Overlay order: path first, then pins. Route colour `2563eb`, width 4, opacity 0.9; pin colour `e11d48`. Shrink by repeatedly calling `downsampleRoute` with the target halved (start 1000 points) until the full URL fits or fewer than 2 points remain; if pins alone already exceed the limit return `null`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Mapbox static map URL builder`.

### Task 3: PDF renderer

**Files:**
- Modify: `package.json`, `package-lock.json` (add `"jspdf": "4.2.1"` via `npm install --save-exact jspdf@4.2.1`)
- Create: `src/lib/itinerary-pdf.ts`
- Test: `src/lib/itinerary-pdf.test.ts`

**Interfaces:**
- Consumes: `ItineraryInput` (Task 1); `LngLat`.
- Produces:
  - `type PdfMap = { kind: "image"; dataUrl: string } | { kind: "fallback" }`
  - `pdfSafe(text: string): string` (rules in Global Constraints)
  - `renderItineraryPdf(input: ItineraryInput, map: PdfMap, geometry: LngLat[], stops: { lat: number; lng: number }[]): Promise<Blob>` (`geometry` and `stops` are used only by the fallback map)

- [ ] **Step 1: Write failing tests** (`// @vitest-environment node`) in `src/lib/itinerary-pdf.test.ts`. Read the Blob with `Buffer.from(await blob.arrayBuffer()).toString("latin1")`. (a) Output starts with `%PDF`; (b) it contains each stop name and the trip name; (c) with `map: { kind: "fallback" }` and two stops it still produces a PDF; (d) with a real 1x1 PNG data URL as `map` it produces a PDF larger than the fallback one; (e) 40 stops produce more `/Type /Page` objects (count `/Type /Page\b` not followed by `s`) than 2 stops, and the text `of` footer appears as `Page 1 of N` with N equal to that count; (f) a 400-character name and 2,000-character notes do not throw and the whole notes text is present across the file (wrapped); (g) `pdfSafe("Café – 東京 ☀️\u0007")` is `"Café – ?? ??"` style: assert it contains `Café`, contains no character above U+00FF, no `\u0007`; (h) empty `bestLight`/`weather`/`notes` print no `null`/`undefined` text.
- [ ] **Step 2: Run** `npm install --save-exact jspdf@4.2.1` then `npx vitest run src/lib/itinerary-pdf.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `pdfSafe` and `renderItineraryPdf`. Use `const { jsPDF } = await import("jspdf")`, A4 portrait in points, 40 pt margins, **default (uncompressed) text streams** so tests can read the text. Page 1: trip name (large), `dateLine`, `startLine`, `routeLine`, then the map box full content width at the 640:400 aspect (`addImage` with format taken from the data URL prefix, PNG or JPEG; for `fallback`: grey-white box, route polyline with `lines`/`line`, filled circles with the stop number in each, coordinates fitted to the box with a margin and longitude scaled by `cos(mean latitude)`). Schedule below the map on page 1 and on further pages: per stop a bold line `"<index>. <name>"` with the arrival right-aligned, then indented grey lines for bestLight, weather, notes, using `splitTextToSize`; never split a stop's heading from its first detail line across pages. Footer on every page `Page n of N` after layout. All strings go through `pdfSafe`. Return `doc.output("blob")`.
- [ ] **Step 4: Run** the same test file. Expected: PASS. Also run `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: render the itinerary PDF with jsPDF`.

### Task 4: Download orchestration and weather loader

**Files:**
- Create: `src/lib/itinerary-download.ts`, `src/components/itinerary/use-itinerary-download.ts`
- Test: `src/lib/itinerary-download.test.ts`, `src/components/itinerary/use-itinerary-download.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-3; `loadForecast(lat, lng, date): Promise<WeatherForecast | null>` and `weatherLine(forecast, pref, at, unit)` from `src/lib/weather-cache.ts` / `src/lib/use-weather.ts`; `forecastInstant`, `solarDateAt`, `inForecastRange`, `inTypicalRange` as used inside `useWeatherLine` (`src/lib/use-weather.ts`).
- Produces:
  - `loadMapImage(url: string | null, opts?: { timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<PdfMap>` (default timeout 8000)
  - `loadWeatherLines(a: { stops: { lat: number; lng: number; lightPref: LightPref; arrival: Date | null }[]; unit: "km" | "mi" }): Promise<(WeatherLine | null)[]>` (same rules as `useWeatherLine`: null with no arrival or outside forecast/typical range; any failure for one stop gives `null` for that stop)
  - `createItineraryPdf(a: { input: ItineraryInput; geometry: LngLat[]; stops: { lat: number; lng: number }[]; token: string | null }): Promise<Blob>` (builds the URL with `staticMapUrl`, loads the image, renders)
  - `saveBlob(blob: Blob, fileName: string): void` (object-URL anchor click, revoke after 1000 ms, same pattern as `downloadGpx` in `ExportControl.tsx`)
  - `mapTokenFromEnv(): string | null` (null when `NEXT_PUBLIC_MAP_FAKE === "1"` or token empty)
  - `useItineraryDownload(): { busy: boolean; error: string | null; run: (make: () => Promise<{ blob: Blob; fileName: string }>) => Promise<void> }`

- [ ] **Step 1: Write failing tests.** `itinerary-download.test.ts`: `loadMapImage(null)` is `{ kind: "fallback" }` with no fetch; non-OK response, rejected fetch, and a fetch that never resolves with `timeoutMs: 20` all give fallback; an OK image response (small PNG bytes, `content-type: image/png`) gives `{ kind: "image", dataUrl }` starting `data:image/png;base64,`; a response with a non-image content type gives fallback. `loadWeatherLines` with `loadForecast` mocked: returns a line for a stop in range, `null` for a stop with `arrival: null`, `null` for the stop whose `loadForecast` rejects, and the other stops still resolve. `use-itinerary-download.test.tsx` (jsdom): `run` sets `busy` true while pending and false after; a failing `make` sets `error` to `"Could not create the PDF. Try again."` and logs via `console.error`; calling `run` twice synchronously calls `make` once.
- [ ] **Step 2: Run** `npx vitest run src/lib/itinerary-download.test.ts src/components/itinerary/use-itinerary-download.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions. Use `AbortController` for the timeout; read the image with `blob()` then `FileReader.readAsDataURL`. The hook's double-click guard is a `useRef<boolean>`; on success it calls `saveBlob`.
- [ ] **Step 4: Run** the same command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: PDF download orchestration, weather loader and hook`.

### Task 5: Editor Export-menu item

**Files:**
- Modify: `src/components/editor/ExportControl.tsx`, `src/components/editor/TripHeader.tsx`, `src/components/editor/TripEditor.tsx` (near line 694, the `exportData` prop)
- Test: `src/components/editor/ExportControl.test.tsx` (extend)

**Interfaces:**
- Consumes: Tasks 1, 4; `useSettings()` (`timeFormat`, `distanceUnit`); in `TripEditor`: `stops`, `arrivals`, `activeRoute` (`{ geometry, distance, duration }`), `trip.departAt ?? defaultDepartAt`, `trip.plannedDate`.
- Produces: `ExportControl` gains optional prop `pdf?: { departAt: Date | null; totalDistanceM: number | null; totalDurationS: number | null; stops: ItineraryStopSource[] }`; the menu shows "Download PDF" only when `pdf` is given. `exportData` in `TripHeader` gains the same optional `pdf` field and passes it through.

- [ ] **Step 1: Write failing tests** (extend `ExportControl.test.tsx`; mock `./itinerary-download` module functions `createItineraryPdf`, `loadWeatherLines`, `saveBlob` with `vi.mock`): (a) with no `pdf` prop the menu has no "Download PDF"; (b) with `pdf` it does, and clicking it calls `createItineraryPdf` once with an `input.stops` of the right length, then `saveBlob` with name `"Big-Sur-2026-itinerary.pdf"` for trip `"Big Sur / 2026"`; (c) while `createItineraryPdf` is pending the item reads "Preparing PDF..." and is disabled; (d) when it rejects, an element with `role="alert"` shows "Could not create the PDF. Try again." and the menu button still works. Wrap in whatever settings provider existing tests use (or mock `useSettings`).
- [ ] **Step 2: Run** `npx vitest run src/components/editor/ExportControl.test.tsx`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the menu item (uses `useItineraryDownload`; its `make` calls `loadWeatherLines`, `buildItinerary`, `createItineraryPdf`; the menu stays open while busy and closes on success), thread `pdf` through `TripHeader`, and build it in `TripEditor` from existing values with `useMemo`-free inline construction (it is cheap). Time zone: arrivals are formatted in the viewer's zone, as on screen.
- [ ] **Step 4: Run** `npx vitest run src/components/editor` and `npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Download PDF in the Export menu`.

### Task 6: Share page button

**Files:**
- Modify: `src/components/share/SharedTripView.tsx`
- Test: `src/components/share/SharedTripView.test.tsx` (create if absent; follow the nearest existing share test for providers)

**Interfaces:**
- Consumes: Tasks 1, 4. `PublicTrip` stops carry `name, lat, lng, notes, shotNotes, lightPref`; `arrivals` and `route` (`distance`, `duration`) already exist in the component.
- Produces: a "Download PDF" button in the header of the shared view, shown when there are 2+ stops. No weather is loaded.

- [ ] **Step 1: Write failing tests** (mock `@/lib/itinerary-download` as in Task 5, and `MapView`): (a) 0 or 1 stops: no button; (b) 2 stops: button present; clicking calls `createItineraryPdf` with `input.stops[0].weather === null` for every stop and never calls `loadWeatherLines`; (c) busy and error states match Task 5 (the error uses `role="alert"`).
- [ ] **Step 2: Run** `npx vitest run src/components/share`. Expected: FAIL.
- [ ] **Step 3: Implement** the button in `SharedTripView.tsx` using the same hook; wrap in `mounted` (clock times need the client zone). Totals come from `route` or `null` when routing was unavailable (then `routeLine` is `null`).
- [ ] **Step 4: Run** `npx vitest run src/components` and `npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Download PDF on the share page`.

### Task 7: End-to-end tests and docs

**Files:**
- Create: `e2e/pdf-itinerary.spec.ts`
- Modify: `TODO.md` only if it lists a PDF/print item (mark it done); no other docs.

**Interfaces:**
- Consumes: the UI from Tasks 5-6; follow `e2e/export.spec.ts` for signup, trip creation, adding two stops on the fake map, and `e2e/share-link.spec.ts` for creating and opening a share link.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the e2e** with two tests. Editor: create a trip named `"PDF coast"`, add two stops, open Export, click "Download PDF", expect a download named `PDF-coast-itinerary.pdf` whose bytes start with `%PDF` (read via `download.path()`). Share: create the share link (as in `share-link.spec.ts`), open it in a fresh context, click "Download PDF", expect `PDF-coast-itinerary.pdf` and bytes starting with `%PDF`.
- [ ] **Step 2: Run** `npx playwright test e2e/pdf-itinerary.spec.ts`. Expected: PASS (fake map mode, so the fallback map is used with no network).
- [ ] **Step 3: Run the full gates:** `npm run typecheck && npm run lint && npm test` and `npx playwright test e2e/export.spec.ts e2e/share-link.spec.ts e2e/pdf-itinerary.spec.ts`. Expected: all PASS.
- [ ] **Step 4: Commit** `test: e2e for the PDF itinerary`.
