# QA architecture and test checklist

Generated 2026-11-19 for the qa/full-sweep branch. Part 1: routes, APIs, features. Part 2: platform, PWA, audit risks.

# Architecture and route map (read-only mapping)

Stack: Next 16 app router, NextAuth (credentials + optional Google), Prisma 7 (SQLite local, libsql/Turso prod), Mapbox, Open-Meteo-style weather, Overpass/local Place table, Wikimedia/Flickr/Commons photos, Vercel Blob uploads, Vercel Cron.
Paths below are relative to the worktree root.

## 1. Page routes (src/app)

| Path | File | Purpose | Auth |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Redirect: signed in -> `/trips`, else `/login` | none (redirect) |
| `/login` | `src/app/login/page.tsx` | Sign-in form, optional Google button, login notices, clears offline copies; signed-in users redirected to `returnTo` or `/trips` | public |
| `/signup` | `src/app/signup/page.tsx` | Sign-up form; signed-in redirected to `/trips` | public |
| `/trips` | `src/app/trips/page.tsx` (+ `layout.tsx`) | Trip list, new-trip form, map backdrop | session; else redirect `/login?returnTo` |
| `/trips/[id]` | `src/app/trips/[id]/page.tsx` | Trip editor (TripEditor); `notFound()` for other users' trips | session |
| `/settings` | `src/app/settings/page.tsx` | Units/theme/etc, change password, sign out all, delete account, clear offline copies | session |
| `/s/[token]` | `src/app/s/[token]/page.tsx` | Public read-only shared trip (noindex, no-referrer, force-dynamic, fetches directions server-side with its own limits `directions` per token and `share-directions` per owner); 429 from proxy via `share-view` | public (token) |
| `/offline` | `src/app/offline/page.tsx` | Service-worker offline fallback listing saved trips | public (client data) |
| `/privacy`, `/terms` | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | Legal pages (LegalPage) | public |
| `/manifest.webmanifest` | `src/app/manifest.ts` | PWA manifest | public |
| error/404 | `error.tsx`, `global-error.tsx`, `not-found.tsx` | Error boundaries | public |

Cross-cutting: `src/proxy.ts` (Next 16 proxy) applies per-request CSP nonce, 400 on bad percent-encoding (also `/api` paths containing `%`), `share-view` rate limit on `/s/*`. API paths otherwise skip the proxy. `public/sw.js` is the service worker.

## 2. API routes (src/app/api)

All JSON routes use `handle()` + `requireUserId()` from `src/server/http.ts` unless noted. `enforceLimit` = in-memory per instance (`src/server/rate-limit.ts` POLICIES); `enforcePaidLimit`/`enforceSharedLimit` = DB-backed counters (`RateLimitCounter`, `src/server/shared-limit.ts`). Schemas are zod (mostly `src/lib/api-shapes.ts`).

| Method path | Auth | Rate limit (policy) | Validation | External |
|---|---|---|---|---|
| POST `/api/signup` | public | shared `signup-ip` 5/h, `signup-email` 3/h; honeypot `website` + `formToken` (`signup-guard.ts`) | `signupSchema` | none |
| GET/POST `/api/auth/[...nextauth]` | public | `login-guard.ts` (login-ip 30/15m, email failures 8/15m, email global 50/h); callbackUrl sanitized | NextAuth | Google OAuth (optional) |
| POST `/api/account/password` | session | shared `password-change` 5/15m | `changePasswordSchema` | none |
| DELETE `/api/account` | session | shared `account-delete` 5/15m | `deleteAccountSchema` (proof) | Vercel Blob (photo deletes) |
| DELETE `/api/account/sessions` | session | `trip-write` | none | none (bumps `sessionVersion`) |
| GET `/api/trips`, POST `/api/trips` | session | POST `trip-write` | `tripCreateSchema` | none |
| GET/PATCH/DELETE `/api/trips/[id]` | session, owner | PATCH/DELETE `trip-write` | `tripPatchSchema` | Blob on delete |
| POST/DELETE `/api/trips/[id]/share` | session, owner | `trip-write` | none | none |
| POST `/api/trips/[id]/stops` | session, owner | `trip-write` | `newStopSchema` | none |
| PUT `/api/trips/[id]/stops/order` | session, owner | `trip-write` | `reorderSchema` | none |
| PATCH/DELETE `/api/stops/[id]` | session, owner | `trip-write` | `stopPatchSchema` | Blob on photo removal |
| POST `/api/stops/[id]/access` | session, owner | `access` 60/min | id | Mapbox (parking/access resolve) |
| POST/DELETE `/api/stops/[id]/photo` | session, owner | POST `photo-upload` 20/10m, DELETE `trip-write` | multipart, `MAX_PHOTO_BYTES`, `readBodyBytes`, magic-byte sanitize (`photo-sanitize.ts`) | Vercel Blob |
| GET `/api/uploads/[name]` | session | `photo-read` 300/min | name | Blob / local files |
| GET `/api/geocode` | session | paid `geocode` 60/min | q 2..200 chars, session uuid, proximity | Mapbox Search Box (suggest) + v6 fallback |
| GET `/api/geocode/retrieve` | session | paid `geocode-retrieve` | id regex <=300, session | Mapbox Search Box retrieve |
| GET `/api/locate` | session | paid `locate` 20/min | q | Mapbox (area/landmark) |
| GET `/api/reverse-geocode` | session | paid `reverse-geocode` | lat/lng `pointQuerySchema` | Mapbox |
| POST `/api/directions` | session | paid `directions` 60/min | `directionsRequestSchema` | Mapbox Directions |
| POST `/api/optimize` | session | paid `optimize` 10/min | `optimizeRequestSchema` | Mapbox Matrix, place-notices (NPS alerts, OSM hours) |
| POST `/api/suggestions` | session | `suggestions` 30/min, deadline `DEADLINE_SUGGESTIONS_MS` | `suggestionsRequestSchema` | local Place table, Overpass, Wikipedia/Wikidata notability, cache |
| POST `/api/suggestions/popularity` | session | paid `popularity` 10/min | `popularityRequestSchema` | Flickr/Wikimedia counts |
| GET `/api/place-photo` | session | paid `place-photo` 60/min | name+lat/lng | Wikimedia/Commons/Flickr |
| GET `/api/weather` | session | `weather` 60/min | `weatherQuerySchema` | weather forecast API (+ typical weather) |
| POST `/api/weather/batch` | session | `weather-batch` 20/min | `weatherBatchSchema` | same |
| GET `/api/hike` | session | `hike` 60/min, deadline | lat/lng | NPS trails + OSM graph (`src/server/hike`) |
| GET `/api/cron/photo-cleanup` | `CRON_SECRET` bearer, else 404 | none | none | Blob; sweeps rate-limit and suggestion cache; scheduled `17 4 * * *` in `vercel.json` |
| ANY `/api/[...unknown]` | public | none | none | JSON 404 for all methods |

Env vars touched: `MAPBOX_TOKEN`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `EXTERNAL_APIS_FAKE` (fake mode for e2e), `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `FLICKR_API_KEY`, `NPS_API_KEY`, `OVERPASS_URL`, `CRON_SECRET`, `VERCEL`.

## 3. User-facing feature checklist

Auth and account
- [ ] Sign up with email/password, honeypot ignored, rate-limited: `components/auth/SignupForm.tsx`, `api/signup`
- [ ] Log in, error/notice messages, returnTo safe-callback: `components/auth/LoginForm.tsx`, `credentials-login.ts`, `login-notice.ts`, `lib/safe-callback.ts`
- [ ] Google sign-in button (only when configured): `components/auth/GoogleButton.tsx`
- [ ] Sign out: `components/SignOutButton.tsx`
- [ ] Change password; sign out all sessions; delete account: `components/settings/SettingsView.tsx`
- [ ] Session expiry handling mid-edit: `lib/session-expired.ts`, `lib/api-client.ts`
Trips list
- [ ] Create trip (name, date), list, delete: `components/trips/NewTripForm.tsx`, `TripList.tsx`, `TripMapBackdrop.tsx`; stale refresh `RefreshWhenStale.tsx`
Editor (`components/editor/TripEditor.tsx` orchestrates)
- [ ] Map (Mapbox GL) with stop markers, marker fan-out, zoom-fit, route flow, hike layer: `MapView.tsx`, `MapPanel.tsx`, `FakeMapPanel.tsx` (fake mode), `marker-fan`, `zoom-fit.ts`, `map-fit.ts`, `route-flow*.ts`, `hike-layer.ts`
- [ ] Place search (geocode suggest/retrieve, POIs, area/landmark locate): `SearchBar.tsx`, `PlaceCard.tsx`
- [ ] Add stop by map click / search / suggestion; reverse geocode naming
- [ ] Stops list: reorder by drag and by keyboard, visited toggle, delete, undo swap: `StopList.tsx`, `StopCard.tsx`, `StopsPanel.tsx`, `StopDrawer.tsx`, `swap-undo.ts`, `keyboard-coordinates.ts`
- [ ] Stop details: notes, priority pill (Normal/High/Must), light preference, dwell minutes, shot notes and checklist: `PriorityPill.tsx`, `StopCard.tsx`, `ui/ShotListReadOnly.tsx`
- [ ] Stop photo upload/remove and suggestion hover photo: `StopPhoto.tsx`, `SuggestionHoverPhoto.tsx`
- [ ] Parking/access point resolve and walking line: `ParkLine.tsx`, `use-access-resolver.ts`
- [ ] Suggestions panel (along-route, ranking, popularity, prewarm, survive across edits): `SuggestionsPanel.tsx`, `lib/suggestions-store.ts`, `suggestion-*.ts`
- [ ] Alternatives panel: `AlternativesPanel.tsx`
- [ ] Optimize route / auto-optimize, start-time and depart control, schedule, Must-have anchors, notices: `TripPlan.tsx`, `TripPlanList.tsx`, `StartTimeControl.tsx`, `TripHeader.tsx`, `lib/optimize-*.ts`
- [ ] Sky card (sun/golden hour) and light-aware ordering: `SkyCard.tsx`, `lib/sky.ts`, `light-windows.ts`
- [ ] Weather per stop: `components/weather/WeatherIcon.tsx`
- [ ] Hike overlay (`use-hike.ts`, `/api/hike`)
- [ ] Share link create/revoke/copy: `ShareControl.tsx`, `api/trips/[id]/share`
- [ ] Export menu: PDF itinerary, GPX, Apple/Google Maps directions (11 stops/link split): `ExportControl.tsx`, `itinerary/DownloadDialog.tsx`, `use-itinerary-download.ts`, `lib/itinerary-pdf.ts`, `pdf-fonts.ts`, `export.ts`, `static-map.ts`
- [ ] Offline copy of a trip and `/offline` view; clear on logout: `lib/use-offline-copy.ts`, `offline-store.ts`, `components/offline/*`, `public/sw.js`
Shared view
- [ ] Public `/s/[token]` read-only trip, route line, no edit controls, revoked token 404: `components/share/SharedTripView.tsx`
Settings and chrome
- [ ] Units (imperial/metric), theme/dark mode, 12/24h clock, forced-colors, short-landscape layout: `settings/SettingsProvider.tsx`, `InitScript.tsx`, `lib/settings.ts`
- [ ] Error banner, confirm dialogs, Escape closing: `ErrorBanner.tsx`, `ui/ConfirmDialog.tsx`, `ui/Dialog.tsx`
- [ ] Legal pages and contact link: `legal/LegalPage.tsx`

## 4. Data layer

Prisma (`prisma/schema.prisma`, client generated to `src/generated/prisma`, SQLite):
- `User` (email unique, passwordHash, googleSub, passwordSet, sessionVersion)
- `Trip` (userId cascade, name, plannedDate, departAt, shareToken unique, routeOptimizedFor)
- `Stop` (tripId cascade, order, lat/lng, notes, source, photoUrl, visited, lightPref, priority, dwellMinutes, shotNotes, shotChecklist JSON string, access* fields)
- `Place` (local POI table, grid `cell`), `RateLimitCounter`, `PendingPhotoDeletion`, `SuggestionCache`

Server modules (`src/server`): `auth.ts`, `session.ts`, `session-revocation.ts`, `db.ts`/`db-adapter.ts`, `http.ts`/`http-error.ts`, `rate-limit.ts`, `shared-limit.ts`, `login-guard.ts`, `signup-guard.ts`, `trips.ts`, `stops.ts`, `stop-access.ts`, `share.ts`, `photos.ts`, `photo-sanitize.ts`, `mappers.ts`, `optimize-slots.ts`, `prisma-helpers.ts`; `external/` (mapbox, weather, flickr, wikimedia, commons, place-photo, place-notices, nps-alerts, osm-hours, typical-weather, fake); `suggestions/` (service, corridor, local-places, overpass, popularity, parse, cache, shared-cache, places-grid); `hike/` (graph, nps, osm, service). Migrations in `prisma/migrations`; prod migrate via `scripts/migrate-turso.mjs`.

## 5. Dead, duplicated, unfinished

- No `TODO/FIXME/HACK` markers in src, e2e or scripts.
- Unreferenced by import path: only `src/proxy.ts` (expected, framework entry). Heuristic by basename; exports-level unused not checked.
- Stray files at worktree root: `test-56395.db` (leftover test DB), `tsconfig.tsbuildinfo` (check they are gitignored). `scripts/bench-*`, `perf*`, `build-places*.sh` are dev tools, not app code.
- Docs: `docs/BACKLOG.md` lists owner follow-ups that are unfinished, relevant to QA: real-Mapbox Search Box smoke test never done; Apple Maps multi-`daddr` link unverified on iPhone; Google Maps link split unverified; `CRON_SECRET` and Google OAuth env must be set; `CONTACT_URL` placeholder (GitHub issues) in `LegalPage.tsx`; legal text not reviewed; Google accounts never auto-linked to same-email password account (by design).
- Duplication to eyeball: two rate-limit mechanisms (in-memory `enforceLimit` vs DB `enforceSharedLimit`/`enforcePaidLimit`), so limits are per-instance for the in-memory ones (suggestions, hike, weather, trip-write, photo-upload, access); `MapPanel` vs `FakeMapPanel` fork for e2e.
- Public share page calls `enforceLimit("directions", share:token)` in-memory only.

## 6. e2e coverage vs features (e2e/*.spec.ts, 34 specs)

Covered: golden path, reopen trip, alternatives, change password, delete account, CSP, empty hint, export/PDF (incl. CJK, offline fonts), first-stop suggestions, hike, hydration timezone, keyboard reorder, layout fill, light-aware, marker fan, offline, optimize route, parking route, popover placement, POI search, reorder visited, route flow, settings, share link, shot list, short landscape, sky preview, suggestion photo, suggestions survive, weather, zoom-fit.

Gaps (no dedicated e2e found; verify only in unit tests `src/**/*.test.*` and `tests/api`):
- Sign-up flow and login failure/lockout/rate-limit UI; Google sign-in; sign-out-all-sessions; session expiry redirect with returnTo.
- Trip list: create/delete trip UI, trips list empty state; 404 for another user's trip.
- Stop photo upload (size/type rejection) and removal; photo `uploads` access control.
- Share link revoke then `/s/[token]` 404; share-view 429; shared-page noindex headers.
- GPX export and Apple/Google Maps links (only PDF paths clearly covered; check `export.spec.ts`).
- Cron endpoint auth (404 without secret) and `/api/[...unknown]` 404; bad percent-encoding 400.
- Dark mode, forced-colors, units/clock toggles on editor (settings.spec covers some).
- Priority "Must" optimize behavior on real data; undo of swap; delete stop; visited toggle outside reorder.
- Privacy/terms/offline fallback page rendering and `/manifest.webmanifest`.
- Real-service behavior (all e2e run with `EXTERNAL_APIS_FAKE=1`), so real Mapbox/Overpass/weather paths are untested end to end.


---

# Platform architecture map (Photo Op Planner, Next 16.4.6, React 19.3, Prisma 7)

Read-only mapping. No .env files opened (only .env.example). Line numbers refer to this worktree.

## 1. Build tooling and config
- package.json scripts: dev=`next dev`; build=`next build`; vercel-build=`node scripts/migrate-turso.mjs && next build`; typecheck=`next typegen && tsc --noEmit`; lint=`eslint --max-warnings 0`; test=`vitest run`; e2e=`playwright test`; e2e:server=`node scripts/e2e-server.mjs`; postinstall=`prisma generate`; db:migrate=`prisma migrate dev`.
- next.config.ts: poweredByHeader off; `distDir` from NEXT_DIST_DIR; `serverExternalPackages:["better-sqlite3"]`; headers(): security headers on `/:path*`, API CSP `default-src 'none'; frame-ancestors 'none'` on `/api/:path*`, `/sw.js` no-cache/no-store, `/s/:path*` no-referrer + noindex + `private, no-store`. Turbopack rule for tailwind css. `reactStrictMode` not set (Next default applies).
- vercel.json: region pdx1; cron `GET /api/cron/photo-cleanup` daily 04:17 (needs CRON_SECRET, else 404).
- vitest.config.mts: two projects: `db-and-server` (serial, per-pid sqlite file test-<pid>.db, globalSetup) and `no-database` (src/components, src/lib; jsdom opt-in per file). Env forced: RATE_LIMIT_DISABLED=1, TRUST_PROXY_HEADERS=1, SIGNUP_MIN_SECONDS=0, NEXTAUTH_SECRET=test-secret. tdd-guard reporter skipped on CI.
- playwright.config.ts: chromium only, 1 worker, port E2E_PORT (default 3100), webServer `npm run e2e:server`, retries 1 on CI.
- prisma.config.ts: schema prisma/schema.prisma, datasource DATABASE_URL (default file:./dev.db). Generated client in src/generated/prisma. Adapter chosen in src/server/db-adapter.ts: Turso libSQL if TURSO_DATABASE_URL else better-sqlite3.
- scripts/migrate-turso.mjs: applies prisma/migrations/*/migration.sql to Turso with an `_applied_migrations` table, one batch (transaction) per migration; skips if VERCEL_ENV is set and not production, or no URL. Naive `;` splitter (no triggers or semicolons inside literals).
- CI (.github/workflows): `check` (typecheck, lint, test, build, `npm audit --omit=dev --audit-level=high`, `npm audit signatures`) and `e2e` (playwright + poppler).
- Stray file in repo root: test-56395.db (leftover vitest DB; confirm it is gitignored).

## 2. Environment variables (names only)
| Name | Where read | Side | Req/Opt |
|---|---|---|---|
| DATABASE_URL | prisma.config.ts, db-adapter.ts, scripts/import-places.mjs, generated client | server | local (default file:./dev.db) |
| TURSO_DATABASE_URL / TURSO_AUTH_TOKEN | db-adapter.ts, migrate-turso.mjs, import-places.mjs | server/build | required when hosted |
| NEXTAUTH_SECRET | auth.ts:113, signup-guard.ts:14 | server | required in prod (signup falls back to a per-process random secret, signup-guard.ts:12) |
| NEXTAUTH_URL | read by next-auth internally (.env.example) | server | required off Vercel |
| NEXT_PUBLIC_MAPBOX_TOKEN | MapPanel.tsx:206, MapView.tsx:14, itinerary-download.ts:110 | CLIENT (inlined at build) | required for real map; must be pk.* |
| MAPBOX_TOKEN | external/mapbox.ts:30 | server | required for search/directions/geocode (logs and returns "temporarily unavailable" if missing) |
| NEXT_PUBLIC_MAP_FAKE | MapView.tsx:14, itinerary-download.ts:109 | CLIENT | optional (tests/offline preview) |
| EXTERNAL_APIS_FAKE (+VERCEL) | external/fake.ts:9 | server | optional; ignored when VERCEL is set (verified) |
| BLOB_READ_WRITE_TOKEN | photos.ts:18 | server | optional (Vercel Blob; else disk) |
| UPLOAD_DIR | photos.ts:22 | server | optional (default `uploads`) |
| FLICKR_API_KEY | external/flickr.ts:25 | server | optional |
| NPS_API_KEY | external/nps-alerts.ts:13 | server | optional |
| OVERPASS_URL | suggestions/overpass.ts:40, osm-hours.ts:42 | server | optional |
| CRON_SECRET | api/cron/photo-cleanup/route.ts:10 | server | required for cron to run |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | auth.ts:70,126 | server | optional (button hidden unless both) |
| SIGNUP_MIN_SECONDS | signup-guard.ts:17 | server | optional (default 3) |
| RATE_LIMIT_DISABLED | rate-limit.ts:65 | server | tests only; ignored in production (good) |
| TRUST_PROXY_HEADERS / TRUSTED_PROXY_DEPTH / VERCEL | rate-limit.ts:154-174 | server | optional off Vercel |
| NEXT_PUBLIC_SW | ServiceWorkerRegister.tsx:8 | CLIENT | optional (dev/e2e SW) |
| OPTIMIZE_MAX_CONCURRENT / OPTIMIZE_BUDGET_MS | optimize-slots.ts:16 (dynamic env[name]) | server | optional |
| SUGGESTION_SHARED_CACHE_DISABLED | suggestions/shared-cache.ts:13 | server | optional, NOT in .env.example |
| NODE_ENV | proxy.ts:57, db.ts, rate-limit.ts, cron route, SW register | both | built in |
| NEXT_DIST_DIR, E2E_PORT, E2E_PROD, CI, VERCEL_ENV, TZ (comment only) | config/scripts | build/test | optional |
| Bench-only (scripts/): LOCS_DIR, OP_DELAY, RESULT, STAGE, CASES, REPS, SIZES, SEED, CANDS, TIME, TIMED_CASES, MIX, ONLY, N, PLACES_DB | scripts/* | dev | n/a |

Client exposure: only NEXT_PUBLIC_MAPBOX_TOKEN, NEXT_PUBLIC_MAP_FAKE, NEXT_PUBLIC_SW. No server secret is referenced from a client module. The Mapbox pk token in the bundle is expected; its URL restrictions in the Mapbox dashboard cannot be verified from code.

## 3. Third-party services
| Service | Module | Timeout | Errors / cache |
|---|---|---|---|
| Mapbox Directions/Geocoding/Search Box/Matrix | src/server/external/mapbox.ts (token in query string); routes api/{geocode,geocode/retrieve,reverse-geocode,directions,locate,optimize} | 10 s (AbortSignal.timeout) | network error -> ExternalServiceError (user-safe message); JSON parse `.catch(null)`; TtlCache 10 min (directions 200, geocode/reverse/search/retrieve 300, matrix 100 entries); search falls back to geocode; directions route `Cache-Control: private, max-age=300`; limits `directions` 60/min, `optimize` 10/min |
| Mapbox GL (browser) | components/editor/MapPanel.tsx; itinerary-download.ts / static-map.ts (static images for PDF) | n/a | `map.on("error")` -> isMapFatalError -> banner; no WebGL -> FakeMapPanel |
| Overpass/OSM (suggestions, hikes, opening hours) | suggestions/overpass.ts (mirrors, AbortSignal.any + timeout, 429/timeout failover, one retry), hike/osm.ts (12 s query, maxsize cap, OverpassTooHeavyError), external/osm-hours.ts (5 s) | per module | failures degrade to null/empty; DB-shared cache (suggestions/shared-cache.ts); local places DB first (local-places.ts) |
| Open-Meteo forecast + archive (typical) | external/weather.ts, typical-weather.ts; api/weather(+batch) | 5 s forecast; typical has its own const | every failure -> `{available:false, reason}` with HTTP 200; memory cache 30 min, failure 1 min; browser Cache-Control 30 min / 1 day / 5 min / 1 min |
| NPS | hike/nps.ts, external/nps-alerts.ts (X-Api-Key header) | NPS_TIMEOUT_MS | `.catch(...)`; Optimize skips alerts without a key |
| Wikimedia Commons / Wikipedia | external/commons.ts, wikimedia.ts, wikipedia-notability.ts, place-photo.ts (provider chain, each `.catch(null)`) | 8 s photos, 5 s counts | host allow-list via allowedHttpsUrl (photo-http.ts); UA contains the deployment URL; place-photo limit 60/min |
| Flickr | external/flickr.ts | 5 s count, 8 s photos | app-wide budget 3000/h via shared limiter (fail-closed -> other source); no key -> skipped |
| Google sign-in | server/auth.ts (next-auth GoogleProvider) | next-auth | requires email_verified; refuses link-by-email if email already used (GoogleEmailInUse) |
| Turso | db-adapter.ts, shared-limit.ts, session-revocation.ts | libsql | single DB for app data, rate-limit counters, revocations, suggestion cache |
| Vercel Blob | photos.ts (private access, `photos/<uuid>.ext`) | SDK | served only via authed /api/uploads/[name] with ownership check, `private, no-store`; failed deletions retried by cron |
| Fonts | next/font/google in layout.tsx | build time | self-hosted at build |

CSP connect-src allows only self + api.mapbox.com, events.mapbox.com, *.tiles.mapbox.com; img-src adds Wikimedia/Flickr hosts. All other third parties are called server-side only.

## 4. PWA
- Manifest: src/app/manifest.ts -> /manifest.webmanifest. name, short_name, start_url `/trips`, scope `/`, display standalone, bg #f4f3f0, theme #d9c7a3. Icons: public/icons/icon-192.png, icon-512.png, icon-maskable-512.png (purpose "maskable" as its own entry, correct). Missing: `id`, `lang`, `orientation`, screenshots, shortcuts; no apple-touch-icon / appleWebApp metadata and no `viewport`/`themeColor` export in src/app/layout.tsx (only app/favicon.ico).
- Service worker: public/sw.js (161 lines), registered by components/offline/ServiceWorkerRegister.tsx (prod, or dev with NEXT_PUBLIC_SW=1; scope "/"; errors swallowed). Served `no-cache, no-store, must-revalidate`. Cache `rtpp-offline-v3`.
  - Never touches `/api/*`, `/s/*`, non-GET, cross-origin.
  - Navigations: network; cached `/offline` only on network failure. No other HTML is cached.
  - `/_next/static/*`: cache-first (prod), ignoreSearch; `/icons/*` and `/offline`: network-first, cache fallback; `/fonts/*.ttf`: stale-while-revalidate with content-type validation. Max 200 static entries.
  - Update flow: install precaches `/offline` + its hashed assets then `skipWaiting()`; activate deletes older `rtpp-offline-*` caches and `clients.claim()`s; shell refreshed on activate and on the first successful navigation per SW lifetime. No in-app "update available" UI; a new worker takes over open tabs immediately.
  - Offline: only the static /offline page comes from the SW; trip data comes from per-device localStorage copies (lib/offline-store.ts: 20 trips, wiped on sign-out/user change, share token stripped). /trips and /trips/[id] are not served offline; launching the installed app offline at start_url `/trips` lands on /offline.
  - No `beforeinstallprompt` handling (browser default install UI only).

## 5. Auth, session, rate limiting, headers
- next-auth v4, JWT strategy (httpOnly encrypted cookie, default name/sameSite/secure; default 30-day maxAge not overridden), Credentials (bcryptjs) + optional Google. Handler src/app/api/auth/[...nextauth]/route.ts; pages signIn/error -> /login. Token carries `sv` (session version) and `sid` (revocable id), both checked against the DB on each session read (auth.ts:154-170); sign-out revokes sid.
- Login throttling: per-IP (route), per email+IP failure counter, per-email global ceiling 200/h (documented lockout trade-off), via the DB-backed shared limiter. Signup: signed timestamp token + honeypot + min seconds + per-IP/email limits.
- rate-limit.ts: in-memory per-instance buckets (not shared across serverless instances); auth-sensitive policies fail closed when the map is full and also use DB shared-limit. clientIp trusts x-vercel-forwarded-for / last XFF on Vercel, else only with TRUST_PROXY_HEADERS; IPv6 collapsed to /64.
- proxy.ts (Next 16 proxy): per-request CSP nonce (`'nonce-..' 'strict-dynamic'`; dev adds unsafe-eval; upgrade-insecure-requests only prod+https), 400 on bad percent-encoding, rate-limits /s/* (300/min/IP). Matcher excludes /api, _next/static, _next/image, icons, fonts, manifest, sw.js, favicon. The root layout reads `x-nonce`, so every page is dynamic.
- Static headers: X-Frame-Options DENY, nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy geolocation=(self) with camera/mic/payment/usb off, COOP same-origin, CORP same-origin, HSTS 1 year includeSubDomains (no preload). style-src has 'unsafe-inline' (documented: Mapbox/React).
- Cron: Bearer CRON_SECRET with timingSafeEqual, 404 otherwise.

## 6. Audit risks (confidence in brackets)
1. public/sw.js:60-67 + ServiceWorkerRegister.tsx:11: install runs `precacheShell`, which throws if `/offline` is not ok or is redirected, so the SW never installs and the failure is silent (register `.catch(()=>{})`). During a bad deploy or if auth/proxy ever redirects /offline, there is no offline page. [medium]
2. src/app/manifest.ts / src/app/layout.tsx: start_url `/trips` needs login; no manifest `id`; no apple-touch-icon / appleWebApp / viewport themeColor metadata (iOS home-screen icon and browser chrome colour). Verify in rendered <head>. [medium]
3. public/sw.js:112 `caches.match(request, {ignoreSearch:true})` has no cacheName so it searches all caches, and ignoring the query drops Vercel skew-protection `?dpl=`; hashed paths make this mostly safe. [low]
4. public/sw.js:11 and ServiceWorkerRegister.tsx:11: dev (`/sw.js?dev=1`) and prod (`/sw.js`) are different script URLs in the same scope; switching builds on localhost can leave a stale worker. Dev-only. [low]
5. src/server/rate-limit.ts (and proxy.ts:42): in-memory buckets are per instance, so `share-view`, `directions`, `optimize`, `place-photo`, `photo-upload` limits are weaker on serverless (cold instances reset them), which matters for billed Mapbox calls. Documented in proxy.ts; auth limits are DB-backed. [medium]
6. src/server/auth.ts:154-170: `jwt` and `session` callbacks do 2-3 DB reads per session read (getSessionVersion, isSessionRevoked), so every authed API call and every `useSession`-style poll pays Turso latency. Perf/cost rather than a bug. [medium]
7. src/server/auth.ts:62 and LOGIN_EMAIL_CEILING: an attacker can reach 200 failures/h for an email and block password login for the owner (documented trade-off). [high that it exists; accepted by design]
8. src/server/signup-guard.ts:12-14: random per-process fallback secret means tokens fail across instances if NEXTAUTH_SECRET is unset (NextAuth refuses to run then). [low]
9. src/components/editor/MapPanel.tsx:29-37 vs :359: only `new mapboxgl.Map` is inside try/catch. If `addControl`/`ZoomFitControl` (:58-72) throws after the map exists, the half-built map is never removed and mapRef is never set. [low]
10. MapPanel.tsx:44-52: `failedRef` stays true until a source tile `data` event arrives; a permanently offline user sees the "tiles could not be loaded" banner indefinitely (probably intended). [low]
11. MapPanel.tsx:568-611: the suggestion-marker effect has no cleanup return; markers are removed on the next run, and `map.remove()` drops the rest on unmount. The popup photo (`loadPlacePhoto`) resolves after the popup may be gone and writes to detached DOM (harmless). Listeners live on discarded elements. [low]
12. MapPanel.tsx:78-154: route, sky and name layers/sources are added only in the `load` handler; hike layers are re-ensured on `style.load` (:441) but route/sky are not. If a `setStyle` (e.g. dark-mode switch) is ever added, they vanish. Today the style is read once (:154-155), so latent only. [low]
13. MapPanel.tsx:374-393 and :694-706: effects with eslint-disable on deps (`stops.length` only; skyLat/skyLng/drawerOpen only). Intentional per comments; a stop swapped without a count change is not re-fit. Stale-closure risk is controlled with refs (`handlersRef`, `fitDataRef`, `lotsRef`). [low]
14. MapPanel.tsx:685-686 `minZoomRef` relies on a 1 s `Date.now()` window to tie the fly-to to the selection re-centre; on a slow device they can race and lose the zoom-in. [low]
15. Strict mode: marker bookkeeping is cleared by the unmount effect at :558-564, so the double-mount in dev does not leave markers attached to a removed map. Map listeners: resize is removed via `map.on("remove")` (:341), zoomend/style.load listeners have matching `off` in cleanups (:441-461, :551-554, :657-659). No leak found. [positive, medium confidence]
16. Unsafe rendering: no innerHTML of user data. `dangerouslySetInnerHTML` appears only with constants (components/settings/InitScript.tsx:13 init script with nonce, FakeMapPanel.tsx:216 and zoom-fit.ts:30 static SVG). Suggestion popup uses DOM APIs (suggestion-popup.ts). [positive, high]
17. Unhandled rejections: the only client `fetch` calls are src/lib/api-client.ts:70 (timeout via AbortController, ApiError) and src/lib/offline-gate.ts:25. `getPosition()` (lib/geolocation.ts:20) always resolves (own 10 s give-up + try/catch), sole caller TripEditor.tsx:866. Server fetches are wrapped with AbortSignal.timeout; external/flickr.ts:53 `call()` itself has no try/catch (callers at :92 and :105 do). [low]
18. Date line: lib/best-time.ts:29-37 defines the planned day as the solar day at longitude `lng` (4 min per degree). Near +-180 a short drive flips the solar date; ensure all coordinates reaching solarDayAnchor/solarDateAt are wrapped to [-180,180] (MapPanel uses wrapLng at :75,:351; check geocode/Overpass/import paths). Polar day/night is handled (alwaysUp/alwaysDown, daylightInterval null). Tests exist (suggestions/corridor-dateline.test.ts, server/trips.dst.test.ts). [medium]
19. lib/dates.ts:25-47: `localDateOnly` and `shiftDepartAtLocal` use the viewer's local zone while `plannedDate` is stored as UTC midnight and the "day" is solar; mixing the three is the usual source of off-by-one around local midnight or when travelling across zones. Code falls back to a UTC-day shift when off the solar day. [medium]
20. server/external/weather.ts:85,110,161,166: `today` is the server UTC date; lib/weather.ts:20-23 allows yesterday to compensate for Americas viewers. A viewer at UTC+12..+14 sees local "today" ahead of the server, so the last forecast day can be reported `out_of_range`. [low-medium]
21. Open-Meteo `timezone: "auto"` (weather.ts:30,59) returns local-time hourly strings without an offset; check parseOpenMeteo converts using `utc_offset_seconds` on DST-transition days and half-hour zones. [low-medium, unverified]
22. src/app/api/uploads/[name]/route.ts:10-14 needs the owner session (requireUserId + findStopByPhotoUrl for that user). Check the public /s/[token] page does not render stop photos via /api/uploads, otherwise share viewers get broken images. [medium, unverified]
23. scripts/migrate-turso.mjs:8-10: non-production Vercel builds skip migrations; if preview deployments use the production Turso DB, new code can run against an old schema. Verify previews use a separate database. [medium, config not visible]
24. .env.example omits SUGGESTION_SHARED_CACHE_DISABLED. EXTERNAL_APIS_FAKE is correctly ignored when VERCEL is set (fake.ts:9). [low]
25. Mapbox server token travels in the query string (mapbox.ts, `access_token=`), so any future logging of request URLs or error messages containing the URL would leak it; current catch blocks return fixed messages. [low]
