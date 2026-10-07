# Road Trip Photo Planner

## 1. What it is

A web app for planning road trips around photo opportunities: plot a
route, discover and curate scenic/photo-worthy stops along it, and see
the best time of day to shoot each one.

## 2. Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `NEXTAUTH_SECRET` — generate one with `openssl rand -base64 32`.
- `NEXT_PUBLIC_MAPBOX_TOKEN` and `MAPBOX_TOKEN` — create a Mapbox
  account and token at [account.mapbox.com](https://account.mapbox.com).
  `NEXT_PUBLIC_MAPBOX_TOKEN` is the public `pk.*` token used by the
  browser map; `MAPBOX_TOKEN` is used server-side for Directions and
  Geocoding (it can be the same `pk.*` token).
- `DATABASE_URL` and `NEXTAUTH_URL` already have working local defaults
  in `.env.example`.

Then set up the database and start the dev server:

```bash
npx prisma migrate dev
npm run dev
```

## 3. Offline mode

Run against canned data with no network calls to Mapbox or Overpass
(no tokens required):

```bash
EXTERNAL_APIS_FAKE=1 NEXT_PUBLIC_MAP_FAKE=1 npm run dev
```

`EXTERNAL_APIS_FAKE=1` swaps in canned Mapbox Directions/Geocoding and
Overpass responses server-side; `NEXT_PUBLIC_MAP_FAKE=1` swaps the
Mapbox GL map for an offline preview panel client-side.

## 4. Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `next dev` | Start the local dev server |
| `build` | `next build` | Production build |
| `test` | `vitest run` | Unit/API tests |
| `e2e` | `playwright test` | Playwright end-to-end golden path |
| `lint` | `eslint` | Lint the codebase |
| `typecheck` | `next typegen && tsc --noEmit` | Type-check the codebase |
| `db:migrate` | `prisma migrate dev` | Apply/create Prisma migrations |

## 5. How best time is computed

Each stop's best shooting window is derived, not stored. The trip's
departure time is assumed to be sunrise at the start location on the
trip's planned date; estimated arrival at each stop is that departure
plus the cumulative Mapbox Directions leg durations up to that stop
(no dwell time at earlier stops). The arrival time is then bucketed
against that stop's own sunrise/golden-hour/sunset times (computed
from its coordinates and the planned date via `suncalc`): before
morning golden hour ends → *sunrise*, before evening golden hour
starts → *midday*, before sunset → *golden hour*, after sunset →
*sunset* (the window just missed). With no route loaded yet, the
display defaults to evening golden hour. See `src/lib/best-time.ts`.

## 6. Tunables

| Constant | File | Meaning |
| --- | --- | --- |
| `CORRIDOR_KM` | `src/server/suggestions/corridor.ts` | Buffer radius (km) around the route searched for OSM suggestions |
| `SUGGESTION_CAP` | `src/server/suggestions/parse.ts` | Max number of suggestion candidates returned per query |
| `DUPLICATE_RADIUS_M` | `src/server/suggestions/parse.ts` | Distance (m) under which two candidates are treated as duplicates |
| `SUGGESTION_CACHE_TTL_MS` | `src/server/suggestions/service.ts` | How long a route's suggestion results are cached server-side |
| `OVERPASS_TIMEOUT_MS` | `src/server/suggestions/overpass.ts` | Per-attempt timeout for Overpass API requests |
| `MAX_PHOTO_BYTES` | `src/lib/photo-rules.ts` | Max reference-photo upload size, enforced client- and server-side |
