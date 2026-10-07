# Map-First UI — Design Spec

Date: 2026-10-07
Status: approved in chat (sections 1-4), pending written-spec review.
Builds on: `2026-10-06-road-trip-photo-planner-design.md` (original design).

## Goal

Make planning feel like Google Maps: the whole app is a full-screen map where
you search for places, click the map, and drop numbered stops, instead of a
form followed by a map with a sidebar.

## Decisions (confirmed with the human partner)

- A trip has **no start/end concept**: it is an ordered list of stops. The
  first stop is the start, the last is the end.
- All six requested behaviours are in scope: map-first creation, search as you
  type, add from search or map click, route and draggable numbered markers,
  floating stops panel (bottom sheet on phones), proximity-biased search.
- Approach A: evolve the current editor (keep data layer, routes, best-time,
  suggestions, tests); replace the UI shell.
- Out of scope: turn-by-turn directions, alternative routes, offline map
  downloads.

## 1. Data and API

- `Trip` drops `startName`, `startLat`, `startLng`, `endName`, `endLat`,
  `endLng`. It keeps `name`, `plannedDate`, timestamps, and its stops.
  A new Prisma migration does this. The hosted database holds no trips, so no
  data conversion is needed. The Turso deploy script applies it automatically.
- `POST /api/trips` accepts only `name` and `plannedDate`. Trip create/read
  validation and types (`src/lib/validation.ts`, `src/lib/types.ts`) are
  updated; existing start/end fields are removed everywhere they are used.
- Best time (`src/lib/best-time.ts`): departure is sunrise at the **first
  stop** on the planned date; each later stop's arrival is departure plus
  cumulative Directions leg durations. With fewer than 2 stops, fall back to
  the existing evening-golden-hour default.
- Suggestions: the corridor is built from the route through the stops (the
  existing route-geometry path), not from start/end.
- Geocoding: `GET /api/geocode` gains optional `proximity=lng,lat` and works
  for as-you-type use (Mapbox `autocomplete=true`, limit 5). A new
  `GET /api/reverse-geocode?lng=&lat=` returns a place name (falls back to
  formatted coordinates). Both require login and respect fake mode.

## 2. Map and search bar

- Full-screen Mapbox GL map; all UI floats above it. The fixed sidebar is
  removed.
- Search bar (top-left overlay): debounced as-you-type search (~250 ms, min 2
  characters), results biased to the current map center, up to 5 in a
  dropdown. Choosing a result flies to it and drops a temporary pin with a
  popup. Stale responses are ignored.
- Map click (including named landmarks) calls reverse-geocode and opens the
  same popup; no name means coordinates are shown.
- Popup: place name and a single **Add stop** button, which appends to the end
  of the list. (No set-as-start/end: first and last stops are those by
  definition.)
- Markers: numbered, draggable (drag saves the new coordinates). Clicking one
  opens a popup with name, best time, arrival time, a visited toggle, and
  **Open details** (notes and photo drawer, as today).
- Route line connects stops in order and redraws on change; shown only with 2+
  stops.
- Offline fake map (`FakeMapPanel`, `NEXT_PUBLIC_MAP_FAKE=1`) gets the same
  search, click and marker behaviour so e2e tests need no Mapbox token.

## 3. Stops panel and phone layout

- Desktop: floating card on the left, ~360 px, collapsible. Header shows trip
  name, date, and a summary (stop count, total driving time).
- Two tabs:
  - **Stops**: ordered list with drag-to-reorder (dnd-kit, as today), number,
    name, best-time badge, visited check. First row labelled "Start", last
    "End". Clicking a row flies to the stop and opens the details drawer.
  - **Suggestions**: existing OSM suggestions along the route. Accepting adds
    a stop. Hovering highlights on the map; suggestions appear as faint
    clickable markers.
- Phone: the panel becomes a bottom sheet with three heights (collapsed
  one-line summary, half, full); search bar stays at the top; the details
  drawer opens as a full-screen sheet.
- Trips list page is unchanged; "New trip" asks only for name and date, then
  opens the empty map.
- Empty trip shows the hint: "Search for a place or click the map to add your
  first stop."

## 4. Testing and rollout

- TDD throughout. Unit tests: best-time rule, trip schema and migration,
  reverse-geocode route, geocode proximity/autocomplete. Component tests:
  search bar (debounce, dropdown, select, stale responses), popup, panel tabs,
  bottom-sheet behaviour.
- Playwright golden path rewritten for the new flow (create trip, search, add
  stops, reorder, mark visited) on the offline fake map.
- The real Mapbox GL layer is not unit-testable; verify it in a real browser
  against the live site and record anything not verified.
- Feature branch; merge to `main` only when typecheck, lint, unit tests, build
  and e2e pass. Pushing to `main` auto-deploys and applies the migration.
- `PROGRESS.md` and `HANDOFF.md` updated at each phase.

## Phases for the plan

1. Data model, API and logic (migration, validation, best-time, suggestions
   corridor, geocode proximity, reverse-geocode).
2. Map shell and search (full-screen map, search bar, click-to-add popup,
   draggable markers, fake-map parity).
3. Stops panel and phone layout (tabs, reorder, suggestions, bottom sheet,
   new-trip form).
4. E2E rewrite, real-browser verification, docs.

## Risks and notes

- Removing start/end touches many files (types, validation, API clients, trip
  header, editor, tests, e2e); phase 1 must leave the app compiling and tests
  green before UI work starts.
- Reverse-geocode on every click costs Mapbox quota; popups only call it on
  click, and results are not cached in v1.
- Dragging a marker moves the stop but keeps its name; renaming is done in the
  details drawer.
