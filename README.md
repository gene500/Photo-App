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
  browser map; `MAPBOX_TOKEN` is used server-side for Directions, the
  Matrix API (route optimization) and Geocoding (it can be the same `pk.*` token).
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

`EXTERNAL_APIS_FAKE=1` swaps in canned Mapbox Directions/Matrix/Geocoding and
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

## 5. Optimize route

The **Optimize route** button (3+ stops) reorders the stops for the shortest
total drive time. The first stop stays the starting point and the last stop is
free (an open path, not a round trip). The server (`POST /api/optimize`) asks the
Mapbox Matrix API (`directions-matrix/v1/mapbox/driving`, `annotations=duration`)
for pairwise drive times, then solves the order in `src/lib/optimize-order.ts`:
exact for up to 9 stops, nearest-neighbour plus 2-opt/or-opt above that. The
Matrix API allows at most 25 coordinates per request, which matches the app's
25-stop limit. **Undo** restores the previous order until the stops change again.

## 6. How best time is computed

Each stop's best shooting window is derived, not stored. The trip's
departure time is assumed to be sunrise at the first stop on the
trip's planned date; estimated arrival at each stop is that departure
plus the cumulative Mapbox Directions leg durations up to that stop
(no dwell time at earlier stops). The arrival time is then bucketed
against that stop's own sunrise/golden-hour/sunset times (computed
from its coordinates via `suncalc`, for the local solar day the arrival
falls on, so a trip spanning several days is judged day by day): before
morning golden hour ends → *sunrise*, before evening golden hour
starts → *midday*, before sunset → *golden hour*, after sunset →
*sunset* (the window just missed). With fewer than two stops (so no route), the
display defaults to evening golden hour. See `src/lib/best-time.ts`.

## 6. Tunables

| Constant | File | Meaning |
| --- | --- | --- |
| `CORRIDOR_KM` | `src/server/suggestions/corridor.ts` | Buffer radius (km) around the route searched for OSM suggestions |
| `SUGGESTION_CAP` | `src/server/suggestions/parse.ts` | Max number of suggestion candidates returned per query |
| `DUPLICATE_RADIUS_M` | `src/server/suggestions/parse.ts` | Distance (m) under which two candidates are treated as duplicates |
| `SUGGESTION_CACHE_TTL_MS` | `src/server/suggestions/service.ts` | How long a route's suggestion results are cached server-side |
| `OVERPASS_TIMEOUT_MS` | `src/server/suggestions/overpass.ts` | Per-attempt timeout for Overpass API requests |
| `MAX_PHOTO_BYTES` | `src/lib/photo-rules.ts` | Max reference-photo upload size (4 MB: Vercel caps request bodies at 4.5 MB), enforced client- and server-side |

## 7. Deploying to Vercel

The app runs on Vercel with a Turso database (hosted SQLite) and a Vercel
Blob store for photos. Locally nothing changes.

1. **Turso:** create a free account at turso.tech, then
   `turso db create photo-app`, `turso db show photo-app --url`, and
   `turso db tokens create photo-app`.
2. **Vercel:** import this GitHub repo at vercel.com/new. In the project,
   open Storage, create a **Blob** store (set to Private) and connect it;
   this adds `BLOB_READ_WRITE_TOKEN` automatically.
3. Add these Environment Variables in Vercel:

   | Variable | Value |
   | --- | --- |
   | `TURSO_DATABASE_URL` | the `libsql://...` URL from step 1 |
   | `TURSO_AUTH_TOKEN` | the token from step 1 |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
   | `NEXTAUTH_URL` | your site URL, e.g. `https://photo-app.vercel.app` |
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox `pk.*` token |
   | `MAPBOX_TOKEN` | same token |

4. Deploy. The build command (`npm run vercel-build`) applies database
   migrations to Turso, then builds. Every push to `main` redeploys.

The Mapbox token is visible in the browser by design; in the Mapbox
dashboard, restrict it to your site's URL.

Tip: when setting variables from the CLI, use
`vercel env add NAME production --value "..." --type secret --yes`.
Piping values through stdin or pasting into the web form can add stray
whitespace, which shows up as a Turso `401` during the build.

**Cautions**

- Scope `TURSO_*` and `BLOB_READ_WRITE_TOKEN` to **Production only**. Preview
  builds also run `vercel-build`, which migrates the database named by
  `TURSO_*`, so a preview build would change the production database.
- `vercel-build` migrates the database **before** `next build`. A build that
  fails after the migration step still leaves the database migrated.
- A local `.env.local` created by `vercel env pull` makes `npm run dev` use the
  production Turso database and Blob store. Remove `TURSO_*` and
  `BLOB_READ_WRITE_TOKEN` from it (or do not pull them) for local work.
