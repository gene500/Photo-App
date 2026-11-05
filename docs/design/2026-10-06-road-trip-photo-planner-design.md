# Road Trip Photo Planner — Design

**Date:** 2026-10-06
**Status:** Approved, pending implementation plan

## Purpose

A web app for planning road trips around photo opportunities: plot a
route, discover and curate scenic/photo-worthy stops along it, and see
the best time of day to shoot each one.

## Scope decisions (from brainstorming)

- Spot sourcing: manual pin placement **and** automated suggestions
  from OpenStreetMap data (not purely manual, not a full places API).
- Platform: web app only (no mobile app).
- Map/routing: **Mapbox** (basemap tiles, map SDK, Directions API for
  routing).
- POI discovery: **Overpass API** against OpenStreetMap data, queried
  for `tourism=viewpoint`, `tourism=attraction`, `natural=peak` within
  a corridor around the route. Chosen over Mapbox's own places search
  because OSM's tag model is purpose-built for exactly this
  ("find me scenic/photo-worthy spots"), and over Google Places
  because it requires no billing account / API cost risk.
- Persistence: accounts + server-side storage (trips follow the user
  across devices), not local-only.
- Tech stack: Next.js (TypeScript) full-stack — single codebase for
  frontend + API routes, avoids running/maintaining a separate backend
  service for a solo project.
- Trip structure: a trip is a single ordered list of stops between a
  start and end point — no day-by-day/itinerary breakdown.
- Per-stop tracking: name, location, notes, a reference/inspiration
  photo, visited status, and a calculated best time of day (sunrise /
  golden hour / midday / sunset) rather than a manual tag, computed
  from the stop's coordinates and the trip's planned date.

## Architecture

Single Next.js (TypeScript) app:

- **Frontend**: React pages/components — trip list, trip editor (map +
  stop list), auth pages.
- **API routes** (Next.js route handlers): auth, trip CRUD, stop CRUD,
  and a server-side proxy for Overpass queries. The proxy exists to
  avoid CORS issues calling Overpass directly from the browser and to
  cache responses per route for a few minutes, since the public
  Overpass instance is rate-limited/best-effort.
- **Database**: SQLite via Prisma ORM. File-based, zero setup for a
  solo project; the schema is written so moving to Postgres later is a
  connection-string + `prisma migrate` change, not a rewrite.
- **Auth**: email + password via `next-auth`'s Credentials provider
  with server-side sessions. Using `next-auth` rather than hand-rolling
  session/cookie handling, since session security is easy to get
  subtly wrong and this is a well-tested standard choice for Next.js.
- **External services**:
  - Mapbox GL JS — client-side map rendering, public token.
  - Mapbox Directions API — routing between start/end + stop
    waypoints, returns route geometry and leg distances/times.
  - Overpass API — POI suggestions, called through the server-side
    proxy described above.
  - `suncalc` (pure JS library, no API/key) — computes sunrise,
    sunset, and golden-hour clock times from a stop's lat/lng and the
    trip's planned date. Computed client-side on demand, not stored,
    since it must stay in sync with the planned date.

## Data model

```
User
 - id, email, passwordHash, createdAt

Trip
 - id, userId (owner)
 - name
 - startLocation (name + lat/lng), endLocation (name + lat/lng)
 - plannedDate (date; drives the sunrise/sunset calculation)
 - createdAt, updatedAt

Stop
 - id, tripId
 - order (int; position in the route sequence)
 - name, lat, lng
 - notes (text, nullable)
 - source: "manual" | "suggested"
 - photoUrl (nullable; path to an uploaded reference image)
 - visited (boolean, default false)
 - createdAt, updatedAt
```

`bestTime` (sunrise / golden hour / midday / sunset) is **not** a
stored column — it's derived at render time from `Stop.lat/lng` and
`Trip.plannedDate` via `suncalc`, so it never goes stale if the
planned date changes.

Route geometry is likewise not stored. It's re-fetched from Mapbox
Directions on load using the Trip's start/end plus the Stops' ordered
coordinates as waypoints — cheap to recompute, and avoids keeping a
cached geometry blob in sync with stop edits/reorders.

## Pages / components

- `/login`, `/signup` — auth forms.
- `/trips` — list of the user's saved trips; "new trip" entry point.
- `/trips/[id]` — the trip editor:
  - **Map panel** (Mapbox GL JS): start/end markers, the driving route
    line, and stop markers color-coded by source (manual/suggested)
    and visited status.
  - **Stop list panel**: ordered, drag-to-reorder list; each row shows
    name, computed best-time clock time, visited toggle, a notes/photo
    preview, and delete.
  - **Add stop**: click-on-map drops a manual pin, or open the
    suggestions panel.
  - **Suggestions panel**: triggers the Overpass proxy query for the
    current route; each candidate shown as a card with accept (→
    becomes a Stop) / dismiss.
  - **Stop detail modal/drawer**: edit name/notes/photo/visited status
    for a selected stop.

## Data flow

1. Setting start/end/planned date calls the Directions API route →
   Mapbox Directions → route geometry + leg distances/times → map
   draws the line.
2. "Find photo spots" calls the Overpass proxy route, which builds a
   buffer polygon around the route geometry and queries Overpass for
   `tourism=viewpoint|attraction`, `natural=peak` within it → dedup'd,
   capped candidate list → rendered as suggestion cards.
3. Accepting a suggestion, or manually dropping a pin, creates a Stop
   at the next `order` position (`source: "suggested"` or `"manual"`
   respectively).
4. Reordering stops updates `order` for affected Stops and re-triggers
   the Directions call with the new waypoint sequence.
5. Best-time display is a pure client-side `suncalc` computation, run
   per Stop against the Trip's `plannedDate`; re-run whenever that
   date changes.

## Error handling

- Mapbox Directions / Overpass failures surface as a dismissible
  inline error in the relevant panel only — the rest of the UI stays
  usable. No hard crashes on external API failure.
- Overpass requests get a short timeout plus one retry, then fail to a
  "couldn't load suggestions, retry" state. Responses are cached
  server-side per route for a few minutes to avoid hammering the
  public instance on repeated clicks.
- Auth errors (bad credentials, duplicate email on signup) surface as
  inline form validation messages; no internal error detail reaches
  the client.
- Photo uploads are validated (type/size) both client- and server-side
  before being written, with a clear rejection message on failure
  rather than a silent no-op.

## Testing

- **Unit tests (Vitest)** for the pure-logic pieces, which carry the
  most value per test: `suncalc`-based best-time derivation, Overpass
  response parsing/dedup, route-corridor buffer construction, and
  Prisma data-access functions.
- **API route tests** against a test SQLite database for trip/stop
  CRUD and auth flows.
- **Playwright end-to-end tests** for the golden path only: sign up →
  create trip → add a manual stop → accept a suggestion → reorder →
  mark visited. Deliberately not exhaustive UI coverage.
- Implementation follows TDD (tests before the corresponding logic),
  per the superpowers test-driven-development skill, especially for
  the non-UI logic above.

## Out of scope (YAGNI)

- Multi-day itineraries / overnight stop scheduling.
- Collaborative/shared trips (multiple users editing one trip).
- Social auth providers (only email + password).
- Storing route geometry or best-time values (both are always
  recomputed).
- Mobile app / offline support.
