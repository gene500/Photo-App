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
- `FLICKR_API_KEY` — **optional**, server-only secret. Without it the app
  uses Wikimedia Commons + Wikipedia only (see "Photo sources" below).
  Flickr now restricts API keys to Pro accounts, so expect to leave it unset.
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

### Light-aware optimization

Each stop has a **Best light** (Any, Sunrise, Golden hour, Sunset; default Any) and
a **Time here** in minutes (0-480, default 30), both edited in the stop drawer.
Stops added from a viewpoint or peak suggestion start as Golden hour; attractions
and manual stops start as Any. When any stop has a preference, **Optimize route**
chooses the visiting order *and* the departure time (`src/lib/optimize-schedule.ts`):

- A stop's good light is a window on the solar day it is reached: Sunrise = 20 min
  before sunrise until the end of morning golden hour; Sunset = start of evening
  golden hour until 20 min after sunset; Golden hour = both. In polar day or night
  there is no window and no constraint.
- Score = total drive seconds + 3 x 60 x minutes of missed light (one missed
  minute costs as much as three minutes of driving). A visit counts as met if
  `[arrival, arrival + time here]` overlaps a window; otherwise the miss is the
  gap to the nearest window.
- Departures tried: the default (sunrise at the first stop) plus every 15 minutes
  from 1 h before it to 14 h after it. Up to 8 free stops (9 total) the search is
  exact over all orders; above that it is a deterministic local search (swap,
  2-opt, or-opt) seeded from nearest-neighbour and sunrise-first/sunset-last orders.
- With no preferences it is exactly the shortest-drive order and the departure
  stays at sunrise.

The chosen departure is saved on the trip (`departAt`); the panel shows
"Starts 5:42 PM" with **Reset to sunrise**. Stops that cannot all be fitted are
named under the button ("Can't fit 2 stops in their light: A, B."). **Undo**
restores the previous order and departure. Each row shows the window and arrival,
or "Misses sunset by 40 min".

### Photo popups and beige map

Hovering (or keyboard-focusing) a suggestion dot on the map, or hovering its card
in the panel, shows a popup with a photo of the place; picking a suggestion shows
the same photo (with its credit) in the place card. On touch devices there is no
hover popup (it would make iOS swallow the first tap); tap a dot to open the card.

#### Photo sources, attribution and licensing

`GET /api/place-photo` -> `src/server/external/place-photo.ts` tries providers in
order and the first hit wins:

1. **Flickr** (only if `FLICKR_API_KEY` is set): `flickr.photos.search` within
   300 m, most "interesting" first, restricted to Creative Commons / public-domain
   licences (ids 1,2,3,4,5,6,9,10; note 1-3 are NonCommercial variants, fine for
   a personal non-commercial project). Credit: `Photo: {owner} via Flickr (CC BY 2.0)`.
   Only https images on `*.staticflickr.com` are passed on.
2. **Wikimedia Commons** file geosearch (300 m): featured/quality/valued images
   first, then name match, then nearest; only jpeg/png/webp. Credit: author and
   licence from the file metadata, e.g. `Photo: Jane Doe via Wikimedia Commons (CC BY-SA 3.0)`.
3. **Wikipedia** article image (name match, else nearest within 300 m).
   Credit: `Photo: Wikipedia`.

No key means Commons + Wikipedia only. Every photo is shown with its plain-text
credit; any failure just means no photo. Results are cached on the server
(500 entries LRU, 6 h for hits, 15 min for misses, concurrent lookups shared) and
in the browser; browser failures are remembered for 60 s. Names are matched
strictly (an "Eagle Peak" never matches "Eagle Rock").

#### Popularity ranking

After OpenStreetMap candidates are ranked and capped, the first 40 are enriched
(5 at a time, 5 s timeout each, failures ignored) with a "photos nearby" count and
re-ranked within each kind (viewpoint / peak / attraction) by it. The count is
the Flickr `photos.total` within 250 m when `FLICKR_API_KEY` is set, otherwise
the number of geotagged Wikimedia Commons files within 250 m (capped at 50, shown
as "50+"; a weaker signal than Flickr). It shows as a muted "≈N photos nearby" caption
on the suggestion card and popup.

The Mapbox `light-v11` basemap is recoloured to the beige theme at runtime
(`src/lib/map-theme.ts`, applied on style load); our own `route*` layers are
never touched.

## 6. How best time is computed

Each stop's best shooting window is derived, not stored. The trip's
departure time is assumed to be sunrise at the first stop on the
trip's planned date unless the trip has a chosen departure (`departAt`,
set by light-aware optimization); estimated arrival at each stop is that
departure plus the cumulative Mapbox Directions leg durations and the
"time here" minutes (default 30) of every earlier stop. The arrival time is then bucketed
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
