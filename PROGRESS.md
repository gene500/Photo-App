# Progress Log

Running record of what's happened on this project. Updated
periodically as work proceeds — newest entries on top.

<<<<<<< HEAD
## 2026-10-07 (photographer-sourced photos, branch `photo-sources`)

Photo pipeline: Flickr (optional, needs `FLICKR_API_KEY`) -> Wikimedia Commons ->
Wikipedia, `PlacePhoto.credit` is now full display text. Stricter name matching
(type-word conflicts such as Eagle Peak vs Eagle Rock rejected), contact
User-Agent, server LRU/TTL cache with in-flight de-dup, 60 s client failure
cache, touch-safe hover popups (pointer events, no hover on touch). Popularity:
top 40 suggestions get a "photos nearby" count (Flickr total with a key, else
Commons files within 250 m, max 50) and are re-ranked within each kind. Verified
live: Commons file geosearch + imageinfo and list=geosearch (curl), Wikipedia.
Flickr is unverified live (no key; Flickr restricts keys to Pro): checked against
the official docs and fixtures only. Commons popularity is a weaker signal than Flickr.

## 2026-10-08 (light-aware route optimization, branch `light-aware`)

Stops now have a preferred light (`lightPref`: any/sunrise/golden/sunset) and a
dwell time (`dwellMinutes`, default 30); trips have an optional `departAt`.
"Optimize route" picks the order and the departure time together
(`light-windows.ts`, `optimize-schedule.ts`: exact up to 8 free stops, local
search above; objective = drive seconds + 3 x 60 x missed minutes). Arrival
estimates now include dwell time at earlier stops (default 30 min shifts every
displayed arrival after the first stop; one `best-time` test expectation changed
for that). `POST /api/optimize` takes optional `stops` and `plannedDate` and
returns `departAt` and `misses`. UI: drawer fields, row hints, "Starts ..." with
"Reset to sunrise", Undo restores order and departure. Additive migration
`20261008120000_light_aware_stops` (smoke-tested twice, idempotent, against a
local libSQL file; existing rows get `any` / 30 / null). Not pushed or merged.
Still needs a real-Mapbox check (Matrix durations feeding the schedule) and a
live Turso migration on deploy.
>>>>>>> light-aware

## 2026-10-07 (beige map + suggestion photo popups, branch `ui-redesign`)

Basemap recoloured to the beige theme at runtime (`map-theme.ts`, pure
`themeLayerPaint` + defensive `applyMapTheme`, hides poi/transit/airport icon
labels). Suggestion dots now show a Wikipedia photo popup on hover/focus (and
when highlighted from the panel), and the place card shows the photo for picked
suggestions: `wikimedia.ts` (geosearch + pageimages, verified against the live
API), `GET /api/place-photo`, `api.placePhoto`, session cache with in-flight
de-duplication, DOM-only `suggestion-popup.ts`, FakeMapPanel parity, e2e.
Verified the Wikipedia calls live; the Mapbox recolouring and popup have only
been exercised against fakes and still need a real-token browser check (layer
ids assumed from light-v11, popup positioning/styling, dark mode).
Note: Wikipedia thumbnails are served from `thumb.wikimedia.org` (not only
`upload.wikimedia.org`), so both hosts are allowed.

## 2026-10-07 (optimize route, branch `optimize-route`)

Added an "Optimize route" button: `optimizeOrder` solver (exact Held-Karp up to 9
stops, nearest neighbour + 2-opt/or-opt above), `getDurationMatrix` (Mapbox Matrix
API, 25-coordinate limit, fake mode), `POST /api/optimize`, `api.optimizeOrder`,
and the TripEditor button with busy state, "Already the fastest order" message,
Undo, and discard-if-stops-changed guard. The first stop is fixed, the last is
free. Unit, API and e2e tests added. Not yet merged. Needs a real-Mapbox and
real-browser check (Matrix API response and phone bottom-sheet layout).

Known gap (optimize): `/api/optimize` only requires a signed-in user and has no rate
limit; Mapbox bills the Matrix API per element (n x n), so a 25-stop call is 625
elements. Fine for a few trusted users; add a per-user limit (or take a tripId and
load the stops server-side) before opening signup wider. Same gap as `/api/directions`.

## 2026-10-07 (map-first UI merged, deployed, final reviews and fixes)

Merged `map-first-ui` into `main` and deployed to Vercel
(https://photo-app-pi2o.vercel.app). The Turso migration
`20261007120000_drop_trip_start_end` was applied during the build. Live smoke
test passed using a throwaway account, and the account was deleted afterwards.

Opus final reviews ran after the merge: a security review, a bug hunt and a
whole-project review. Fixes on branch `final-fixes`: suggestions request
downsampled to <= 1500 points (a real 355 km route had 3207, over the server's
2000 cap, so "Find photo spots" returned 400); best time computed for each
stop's arrival day on multi-day trips; touch-none on the drag handle for phones;
e2e server blanks `TURSO_*` as well as the Blob token; README cautions on env
scoping; dark-mode text on white floating cards; new-trip default date from the
viewer's local day; the stop drawer sends only changed fields; Accept has a
per-suggestion busy guard; suggestions are cleared when the stops change and
late responses ignored; removeStop no longer closes a newer card/drawer; a photo
upload for a stop deleted mid-flight returns 404 and removes the file; dead
`boundsFor` removed. Also: the server's corridor builder now coarsens its route
simplification in steps for long routes (a real 1,916 km route simplified to 282
points, over the 200-point guard, so "Find photo spots" failed beyond roughly
1,000 km) and widens the buffer by the extra simplification error so spots near
the real road are not missed. Not addressed (out of scope): rate limiting, invite
codes, security headers, antimeridian-crossing routes.

Later on `final-fixes`: photo upload/remove is now a compare-and-swap on `photoUrl`
(`swapStopPhoto`), so concurrent uploads never orphan a file (the loser deletes its
own file and returns the current stop; a stop deleted right after a won swap still
cleans up the old file). Stop markers are diffed by id (`diffIds`) instead of
rebuilt, so a state update never destroys a marker mid-drag; a stop deleted
mid-drag has its marker removed at dragend. The marker change is covered only by
unit tests of the diff helper plus the fake-map e2e: it has NOT been checked in a
real browser (needs a Mapbox token) -- try dragging a marker while toggling
Visited, and reorder/delete.

## 2026-10-07 (map-first UI: built, reviewed, verified — ready to merge)

Executed the plan on branch `map-first-ui` with
`superpowers:subagent-driven-development` (Sonnet implementers/reviewers).
All 10 tasks done; 246 unit tests, typecheck, lint, build and the Playwright
golden path pass.

What changed: a trip no longer has start/end (migration
`20261007120000_drop_trip_start_end` drops six `Trip` columns; the live Turso
DB had 0 trips when checked). The editor is a full-screen map with a
search-as-you-type bar (proximity-biased), map-click and search-result
add-stop cards, numbered draggable markers, route line, a floating stops panel
(Stops/Suggestions tabs, Start/End labels) that becomes a bottom sheet on
phones, and a stop cap of 25 (the Directions waypoint limit). Best time now
departs at sunrise at the first stop.

Reviews: per-task reviews, a final whole-branch review and a bug/security pass.
They found and we fixed: lng outside ±180 breaking search/saves, no stop cap,
drag responses clobbering stop order, a non-atomic Turso migration runner,
bottom sheet hiding search results, plus several minors. Real-browser check on
the real Mapbox map found three bugs unit tests could not: the map collapsed to
zero height (mapbox-gl.css `position: relative` beat Tailwind `absolute`),
controls overlapped the search bar, and fitted points hid under the sheet.

Deviations/notes: add-stop and stop details are React cards under the search
bar, not anchored Mapbox popups (same on real and offline maps, unit-testable).
The final whole-branch review was run on Opus, which contradicts the standing
"Sonnet only" rule in HANDOFF.md; the controller did it by mistake and is
disclosing it here. Playwright runs Desktop Chrome at 1280x720 on the fake map, so the desktop layout
is covered there; only the desktop view on the real Mapbox map is unverified.
Not verified in a real browser: failed-drag revert, suggestion markers on the real map, landmark click names
(Mapbox v6 reverse geocoding returns addresses/places, not POIs), and real
Mapbox geocode/directions (fake mode was used locally).

Deploy caution: `TURSO_*` env vars are set for Preview as well as Production, so
never push the feature branch; merge to `main` locally and push `main` only.

## 2026-10-07 (map-first UI: implementation plan written)

Wrote the implementation plan via `superpowers:writing-plans`:
`docs/superpowers/plans/2026-10-07-map-first-ui.md` (10 tasks, 4 phases:
data model/API, map shell and search, stops panel and editor, e2e/verify/
docs). One deliberate deviation from the spec wording: the add-stop and
stop "popups" are React cards under the search bar rather than anchored
Mapbox popups, so they behave the same on the real and offline maps and are
unit-testable. Next: human partner approves the plan; then execute it
task-by-task on branch `map-first-ui` with
`superpowers:subagent-driven-development` (Sonnet), log progress at each
phase boundary, and merge/deploy only when typecheck, lint, tests, build and
e2e all pass.

## 2026-10-07 (map-first UI: design spec written)

The human partner wanted the app to feel like Google Maps (plan everything
on a map layout). Brainstormed via `superpowers:brainstorming`
(architectural path); all four design sections approved in chat.
Spec: `docs/superpowers/specs/2026-10-07-map-first-ui-design.md`.

Key decisions: trip has no start/end concept (ordered stops; first = start,
last = end); full-screen map with search-as-you-type (proximity-biased),
click-to-add popup, draggable numbered markers, floating stops panel with
Stops/Suggestions tabs, bottom sheet on phones; evolve the current editor
rather than rewrite. Four phases: data/API, map shell and search, panel and
phone layout, e2e/verification/docs.

Next: human partner reviews the written spec, then write the implementation
plan (`superpowers:writing-plans`) and execute it. No code changed yet.

## 2026-10-07 (deployed: https://photo-app-pi2o.vercel.app)

The app is live on Vercel (project `photo-app-pi2o`, team "Photo Project",
Hobby plan), backed by Turso database `photo-app` (aws-us-west-2) and a
private Vercel Blob store `photo-app-photos`.

What happened:
- First two builds failed with a Turso 401 in `scripts/migrate-turso.mjs`.
  Cause: env vars pasted into the Vercel web form carried stray whitespace,
  and values piped to `vercel env add` via stdin were stored wrongly. Fixed
  by setting every variable with `vercel env add NAME env --value ... --type`
  from the CLI. Tokens were rotated several times because they appeared in
  chat screenshots; the current Turso token and `NEXTAUTH_SECRET` were
  generated and set by the CLI and never displayed.
- `NEXTAUTH_URL` = the production URL; `NEXT_PUBLIC_MAPBOX_TOKEN` is a
  plain Config value (public by design), `MAPBOX_TOKEN` is a Secret.
- Live smoke test (throwaway account, then deleted; DB back to 0 users and
  0 trips): signup, login, create trip, add stop, upload photo to Blob,
  owner fetch 200, anonymous fetch 401, delete trip.

Still to do (human partner): restrict the Mapbox token to the site URL in
the Mapbox dashboard; try the app in a browser with the real map.
Pushes to `main` now auto-deploy. Local-only files: `.vercel/` and
`.env.local` (both ignored). Turso CLI lives in `~/.turso`.

## 2026-10-07 (hosting prep: Vercel + Turso + Blob)

Goal: make the app usable as a real website. GitHub Pages can't host it
(needs a server), so the design (approved in chat) is Vercel + Turso
(hosted SQLite, so schema/migrations/tests unchanged) + Vercel Blob for
photos. Local dev behaviour is unchanged.

Done (branch `deploy-vercel`, TDD, all checks green):
- `src/server/db-adapter.ts`: uses libSQL when `TURSO_DATABASE_URL` is
  set, else local better-sqlite3. `db.ts` now calls it. 2 new tests.
- `src/server/photos.ts`: private Vercel Blob storage when
  `BLOB_READ_WRITE_TOKEN` is set, else local `UPLOAD_DIR`. Photos are
  still served through the ownership-checked `/api/uploads/` route.
  1 new test (mocked Blob).
- Photo limit lowered 5 MB -> 4 MB (Vercel request bodies cap at 4.5 MB);
  UI text, messages, tests, README updated.
- `scripts/migrate-turso.mjs` + `vercel-build` script: applies
  `prisma/migrations` to Turso on each deploy (no-op without the env var;
  smoke-tested twice against a local libSQL file, idempotent).
- `prisma.config.ts` falls back to `file:./dev.db` so `prisma generate`
  works on a clean build with no `DATABASE_URL`.
- README section 7 (deploy steps), `.env.example`, `.gitignore`
  (`.DS_Store`, `.claude/`, `.vercel`).
- Verification: typecheck clean, lint clean, 190/190 tests, production
  build OK, e2e 1/1.

Not done yet (needs the human partner's accounts): create Turso database,
import the repo into Vercel, create the Blob store, set the env vars
(README section 7), then do a first real-service smoke test with a real
Mapbox token. Nothing has been deployed.

## 2026-10-07 (extra reviews done, merged to main, project complete)

- The two extra read-only review passes (bug-hunting, security) ran after
  the final whole-branch review. Findings were fixed in three commits:
  - `e5e143f` cap suggestions coordinates (recursive-simplify DoS)
  - `455d67c` fix stale closure in TripEditor's optimistic reorder revert
  - `6d6ed0a` reject pathological route geometry before `buffer()` (OOM)
- Merged `worktree-road-trip-photo-planner` into `main` (fast-forward) and
  pushed to origin. Re-verified on the merged tree: `typecheck` clean,
  `lint` clean, 187/187 unit tests, e2e golden path 1/1.
- Deleted the worktree and the `worktree-road-trip-photo-planner` branch
  (local and remote); `main` is the only branch.
- Deferred on purpose (outside the plan's scope): raw `<p>` errors instead
  of `ErrorBanner` in a few forms, in-memory Overpass cache, SQLite
  single-writer limit, no log when `NEXT_PUBLIC_MAPBOX_TOKEN` is absent.

## 2026-10-07 (final whole-branch review: ready to merge)

All 24 tasks of the implementation plan are complete and reviewed-approved
(per-task history in `HISTORY.md`, full detail in the SDD ledger). Dispatched
the final whole-branch code review per `superpowers:subagent-driven-development`
(Sonnet, per standing policy) across the full branch diff (58 commits, 134
files, ~18,250 insertions since diverging from `main`).

**Verdict: Ready to merge — yes.** Zero Critical or new Important findings.
The reviewer specifically checked cross-cutting concerns a single-task review
can't see: auth enforcement is uniform across every API route, the
404-not-403 cross-user ownership pattern holds everywhere (not just the
tasks that targeted it), error-handling conventions are consistent end to
end, photo-upload security (MIME/size/magic-byte validation, path-traversal-
proof filename handling, ownership-checked serving) is solid, no raw SQL or
`dangerouslySetInnerHTML` anywhere, no hardcoded secrets, and the offline
fake-mode env vars default off everywhere (no accidental-production-leak
risk). Independently reran `tsc --noEmit` and the full test suite: clean,
181/181.

Four Minor, non-blocking findings logged for future reference (not acted on
now — outside this plan's committed scope): a couple of components use a raw
`<p>` instead of the shared `ErrorBanner`; the Overpass suggestion cache is
an in-memory singleton that won't share across horizontally-scaled
replicas; SQLite is a single-writer datastore that would need to become
Postgres for real concurrent production load; no server-side log if
`NEXT_PUBLIC_MAPBOX_TOKEN` is absent in a production-looking build.

Next: two additional read-only review passes (bug-hunting and security,
both Sonnet, run in parallel) requested by the human partner earlier in the
session, then `superpowers:finishing-a-development-branch`.

## 2026-10-06 (implementation complete through Task 24)

Task 24 (final task of 24) complete: wrote `README.md` (purpose,
setup, offline mode, scripts table, best-time rule, tunables with
file paths) and ran full verification across the whole app:
- `lint`: clean.
- `typecheck`: clean (`next typegen && tsc --noEmit`).
- `test`: 181/181 tests passed across 41 files.
- `build`: compiled successfully (only non-fatal Next.js tracing
  warnings on `src/server/photos.ts`'s dynamic filesystem paths,
  build exit 0).
- `e2e`: 1/1 passed (golden path: sign up → create trip → manual
  stop → accept suggestion → reorder → mark visited).

Also walked the spec checklist against the actual Tasks 1-23 code
(not just asserted): manual pins + Overpass suggestions (viewpoint/
attraction/peak) both work; trip/stop/photo routes 404 on another
user's data (`src/server/trips.test.ts`, `src/server/stops.test.ts`
cover this); Stop has name/location/notes/photo/visited and a
derived (non-persisted) best time (`src/lib/best-time.ts`); route
geometry is refetched via a waypoint-keyed effect on every stop
reorder/edit, never stored; Overpass/Directions failures show
dismissible inline `ErrorBanner`s without blocking the rest of the
UI; Overpass has a 12s timeout, one retry, and a 5-minute cache
(`src/server/suggestions/overpass.ts`, `service.ts`); auth errors
are inline with no internal detail leaked (`LoginForm.tsx`,
`SignupForm.tsx`); photo uploads are validated by the same rules on
both client and server (`src/lib/photo-rules.ts`). No gaps found.

Nothing deferred beyond what the plan always scoped out (the final
whole-branch review and the two extra bug/security review passes,
run separately by the controller after this task).

## 2026-10-06 (implementation: Phase 4 complete)

Tasks 16-22 complete and reviewed-approved: client helpers/typed API client,
ErrorBanner/PlaceSearch, auth pages/trip list/new-trip form, TripHeader/
SuggestionsPanel, drag-to-reorder StopList (dnd-kit), StopDrawer (photo
upload/remove), map views (Mapbox GL + offline FakeMapPanel), and finally
TripEditor — the orchestration component wiring everything together into
the real `/trips/[id]` page. 22/24 tasks done.

Two fix rounds this phase: Task 17 corrected a test-reset pattern that had
been applied by an over-generalized pattern-match rather than verified
evidence (caught and reverted once the reviewer proved the specific bug
didn't apply); Task 22 — the largest integration task in the plan — added
a genuinely mutation-tested regression test for the one mandated data-flow
behavior (optimistic reorder with revert-on-error) that had no coverage
anywhere. Both fixes were independently re-verified by a scoped re-reviewer
rather than taken on trust. Several Minor/Important findings were ruled on
and accepted directly (thin pass-through glue, verbatim brief-mandated
code, low real-world risk) rather than fix-looped — full reasoning for
each is in the SDD ledger.

Also worth noting: this repo's `AGENTS.md` carries a self-referential
instruction block (claims to be regenerated by `next dev`, tells agents to
read `node_modules/next/dist/docs/` as governing instructions and to keep
committing the block itself). Every implementer and reviewer across this
phase correctly treated it as untrusted repo content rather than a
directive, confirmed independently each time via `git diff` that it was
never touched.

Next: Phase 5 (end-to-end and wrap-up) — Task 23 (Playwright e2e golden
path) and Task 24 (README + final verification), then the final
whole-branch review and the two extra bug/security review passes.

## 2026-10-06 (implementation: Phases 1-2 complete)

Executing the implementation plan via `superpowers:subagent-driven-development`
(fresh implementer + reviewer per task). Tasks 1-10 of 24 complete and
reviewed-approved:
- **Phase 1 (Foundation):** scaffold, Prisma schema/client/test harness,
  shared types and zod validation.
- **Phase 2 (Auth and data backend):** user accounts, next-auth/HTTP
  helpers/signup, trip data access + API routes, stop data access + API
  routes, reference photo upload/serving/cleanup.

Notable along the way: the `tdd-guard` plugin malfunctioned repeatedly
(confirmed via direct SDK probe to be a plugin reliability issue, not a
config problem) and was disabled for Tasks 4 onward — TDD discipline is
still required by every task brief and independently checked by each task
reviewer against real RED/GREEN evidence. Full detail in `HANDOFF.md` and
the SDD ledger. Remote pushed to https://github.com/gene500/Photo-App.git
(branches `main` and `worktree-road-trip-photo-planner`).

Next: Phase 3 (domain logic and external services — best-time derivation,
Overpass suggestions, Mapbox directions/geocoding), Task 11 onward.

## 2026-10-06 (implementation: Phase 3 complete)

Tasks 11-15 complete and reviewed-approved: best-time derivation (suncalc,
independently re-verified against real astronomical output), geo
helper/route corridor (turf.js), Overpass response parsing/dedup/ranking,
Overpass client with cache/retry + fake mode, Mapbox directions/geocoding
wrappers + routes. 15/24 tasks done.

Two review findings this phase were accepted via controller ruling rather
than a fix-loop redo, since both were about report/test-coverage precision
on already-verified-correct code, not actual defects — see the SDD ledger
for full reasoning. TDD discipline (now review-gate-only, no mechanical
hook) has held up well: reviewers have repeatedly independently reproduced
implementers' claimed test failures/fixes against the real toolchain
rather than trusting reports at face value.

Next: Phase 4 (UI) — Task 16 onward (client helpers, API client, then
auth pages, trip editor, map views).

## 2026-10-06 (implementation plan)

- Wrote the implementation plan via `superpowers:writing-plans`:
  `docs/superpowers/plans/2026-10-06-road-trip-photo-planner.md`.
  It has 24 TDD tasks in 5 phases:
  1. Foundation: scaffold, Prisma/SQLite, types/validation.
  2. Auth + data backend: users, next-auth, trip/stop data access and
     API routes, photo uploads.
  3. Domain logic + external services: suncalc best time, route
     corridor, Overpass parse/cache/retry, Mapbox Directions/Geocoding.
  4. UI: auth pages, trip list, trip editor with map, sortable stops,
     stop drawer, suggestions.
  5. Playwright golden path + final verification.
- Checked against current package versions: Next.js 16.4 (Cache
  Components off), Prisma 7.10 (driver adapter + prisma.config.ts),
  next-auth 4.24, suncalc 2.x (null/polar handling). The plan pins
  these.
- The plan accounts for the `tdd-guard` plugin: the tdd-guard-vitest
  reporter, one test at a time, and asking the human partner to toggle
  the guard for untestable config/WebGL files.
- Open decisions the spec didn't settle are listed in the plan's
  D1–D9 table: best-time rule, 2 km corridor, 40-suggestion cap,
  5-min cache / 12 s timeout / 1 retry, 5 MB local photo storage,
  Mapbox geocoding for start/end, JWT session strategy, and others.
  The human partner still needs to confirm these.
- Next: the human partner reviews and approves the plan (and the
  D1–D9 defaults). Then a separate session executes it task-by-task
  with `superpowers:subagent-driven-development` (or
  `superpowers:executing-plans`).

## 2026-10-06

- Brainstormed and designed the app via `superpowers:brainstorming`
  (architectural path): a web app for planning road trips around
  photo-op stops.
- Key decisions locked in: Mapbox (map/routing) + Overpass/OSM (photo
  spot suggestions) combined; Next.js full-stack with Prisma/SQLite;
  accounts + server-side trip storage; single ordered-stop-list trip
  structure (no multi-day itinerary); calculated sunrise/golden
  hour/sunset per stop via `suncalc`.
- Wrote and committed the design spec:
  `docs/superpowers/specs/2026-10-06-road-trip-photo-planner-design.md`.
- Next: write the implementation plan (`superpowers:writing-plans`),
  then execute it.

## First-stop suggestions (15 miles)
A trip with one stop auto-loads suggestions within 24 km (`AROUND_RADIUS_KM`) via `POST /api/suggestions {around}`; 2+ stops use the route corridor as before. The around query caps each kind separately (200 viewpoints / 200 peaks / 150 attractions) so dense attractions cannot crowd out viewpoints. Rulings: after accepting a suggestion at 1 stop the circle results stay visible (re-tagged to the new key) rather than vanishing. Known gap: a manual route search whose response is discarded can leave "Searching…" until the stops change (pre-existing). Not verified against live Overpass.

## Shot list per stop
Stops gain `shotNotes` (nullable, max 2000) and `shotChecklist` (JSON text column default `[]`, up to 20 `{text 1..120, done}`), validated with zod at create/patch (unknown item keys stripped) and serialized in `src/server/stops.ts`; `toStopDto` parses defensively (bad JSON becomes `[]`). Drawer: notes textarea plus checklist editor (Enter adds, tick, delete; a typed unconfirmed shot is kept on Save). The "2/5 shots" summary is on `StopCard` (the selected-stop card; `PlaceCard` is only for unsaved places). Migration `20261009120000_shot_list` proven against a local libSQL file with an existing row, applied twice. Known gap: the checklist is saved whole (last write wins), no per-item merge.

## Read-only share link
`Trip.shareToken` (nullable unique, 32 random bytes base64url) with owner-only `POST`/`DELETE /api/trips/[id]/share` (scoped by `userId`, 404 for others; POST is idempotent). Public page `src/app/s/[token]/page.tsx` (no login) reads `getSharedTrip` -> `toPublicTripDto`, which lists fields explicitly (stop order/name/lat/lng/notes/visited/source/lightPref/dwell/shotNotes/shotChecklist; no ids, userId, email, photoUrl, token); malformed/unknown/revoked token -> `notFound()`. Metadata: robots noindex,nofollow and referrer no-referrer. The shared map is read-only (`readOnly` on `MapViewProps`: no drag, no crosshair) with a straight line and times estimated from straight-line distance (`src/lib/straight-line.ts`; `/api/directions` is not public); clock times render after mount to avoid a time-zone hydration mismatch. Tests: `tests/api/share.test.ts` (ownership, revoke, DTO and rendered-HTML leak checks), component tests, `e2e/share-link.spec.ts` (fresh context, revoke -> 404). Migration proven on a local libSQL file with an existing trip, applied twice. Known gaps: anyone holding the link sees stop notes/shot notes (by design); no expiry, one link per trip; the share popover lives inside the clipped panel header; not verified with a real Mapbox token.

## Trip export and navigation links
`src/lib/export.ts` (pure): `buildGpx` (GPX 1.1, `<wpt>` per stop with name/desc, `<trk>` from the active route geometry, no timestamps; everything XML-escaped and stripped of XML 1.0-illegal chars incl. lone surrogates), `gpxFileName` (ASCII slug, max 60), `googleMapsUrl` (array of `{label,url}`; 9 waypoints per link, so 11 stops per part, consecutive parts share an end point; null under 2 stops), `appleMapsUrl` (`saddr` + `daddr` chained with ` to:`; no chunking). Coordinates are used instead of names so links do not depend on geocoding. `ExportControl` sits next to Share in `TripHeader` (disabled under 2 stops; download via Blob + anchor; map links are `target=_blank rel=noopener noreferrer`). Tests: `src/lib/export.test.ts` (2/5/11/12 stops, escaping, well-formedness), `ExportControl.test.tsx`, `e2e/export.spec.ts` (download event with a .gpx name). Known gaps: not tried in the real Google/Apple apps (offline); Apple Maps has no documented stop limit so very long trips are untested; like Share, the menu lives inside the panel header.

## Weather and light-window forecast
`GET /api/weather` (auth, zod: lat/lng ranges + valid YYYY-MM-DD) wraps Open-Meteo (`src/server/external/weather.ts`: fixed host, 5 s timeout, project User-Agent, coordinates rounded to 2 decimals, 30-minute bounded LRU with in-flight de-duplication, failures never cached). Dates outside [today, today+15] (UTC) return `{available:false, reason:"out_of_range"}` before any upstream call; fake mode returns a deterministic day. The wire shape is rows (`hours: {time, cloudPct, rainPct, tempC}[]` plus `utcOffsetSeconds`) rather than parallel arrays. `src/lib/weather.ts` holds the pure parts: `parseOpenMeteo`, `hourInstant` (local forecast time to instant via `utc_offset_seconds`, unit-tested in -7 h and +5:30 zones), `summarizeAt` (nearest hour within 90 min), labels (Clear <20, Partly cloudy <50, Mostly cloudy <80, Overcast; "Rain likely" at >=50%), `lightQuality`, `describeWeather`. Client: `weather-cache.ts` (shared in-flight promises, 1 min failure memory) and `use-weather.ts`; the UI beyond the horizon says "Forecast not available yet", for past dates it says nothing. Shown in `StopList` rows, `StopCard` and `PlaceCard` (golden hour of the trip date). Tests: lib, server, API, hook, component and `e2e/weather.spec.ts`. Known gaps: the horizon uses the server's UTC date, so late in a US evening "today" may read as out of range; the hint text is lower-case English and temperature is fetched but not yet displayed (units setting is a later task); not verified against live Open-Meteo.
Fix round 1: weather is read at the middle of the preferred light window (`forecastInstant` in `light-windows.ts`; nearest window, golden picks the nearer of the two; arrival for "any"/polar), not at arrival. Range now allows yesterday (UTC skew); requests span date-1..date+1 (clamped) so `summarizeAt` finds the nearest hour; server caches unavailable for 60 s; client cache expires after 30 min. The "Known gaps" UTC-today note above is addressed by the yesterday allowance.

## Alternative stops
`StopDrawer` embeds `AlternativesPanel` (find, list of up to 8, "Swap in"). `POST /api/suggestions` gains `radiusKm` (zod 1..30, only with `around`; part of the server cache key); alternatives use 10 km and filter out anything within `ALREADY_A_STOP_M` of any stop in the editor. A swap is one `PATCH /api/stops/[id]` with `{name, lat, lng, source:"suggested", visited:false, photoUrl:null}`: the patch schema gained `source` and `photoUrl` (only `null`; same ranges as creation for name/lat/lng, 404 for another user's stop). Clearing the photo goes through `swapStopPhoto` (compare-and-swap) and then deletes the old file, like the photo route, so no blob is orphaned. Shot list, notes, order and `lightPref` are kept; `waypointKey` changes so route, arrivals and weather refresh. Undo is client-only (`swapNote`), restores name/lat/lng/source/visited via the same patch, and is retired when the stop is no longer at the swapped place or on reload. Known gaps: the deleted photo cannot be restored by undo; the drawer closes on swap (unsaved drawer edits are dropped); no "Find alternatives" on `StopCard`/`PlaceCard` (PlaceCard is for unsaved places); not verified against live Overpass.

## Offline read-only copies
`src/lib/offline-store.ts` (localStorage; `saveTripCopy`, `listTripCopies`, `loadTripCopy`, `clearAllCopies`, `claimOwner`): per-trip key plus an index, capped at 20 most recent, quota errors drop the oldest other copy and retry, never throw. `shareToken` and stop `photoUrl` are stripped before saving. `useOfflineCopy` (called by `TripEditor` with the server-known `userId`) saves debounced and only while online; `OfflineOwnerSync` in the trips layout calls `claimOwner(userId)`, which wipes copies if the stored owner differs (or is unknown). `SignOutButton` clears all copies before `signOut`. `/offline` (`OfflineView`, static, no auth, no API calls) lists saved trips and shows one read-only with the "You're offline - showing your saved copy from ..." banner, using the theme tokens (beige + dark mode). `public/sw.js` + `ServiceWorkerRegister` (production or `NEXT_PUBLIC_SW=1`, scope `/`): passes through non-GET, cross-origin, `/api/*` and `/s/*`; navigations go to the network and only on failure get the cached `/offline`; only `/offline` and `/_next/static|/icons` assets are written to the cache. Manifest `src/app/manifest.ts`; PNG icons from `scripts/generate-icons.mjs`. Tests: store, worker (the real `sw.js` evaluated with a fake `self`), view, sign-out, hook, manifest, `e2e/offline.spec.ts`. Known gaps: the e2e does not reload `/offline` with the network off (in `next dev` hydration needs the HMR websocket, and Chromium's offline emulation does not reach the worker's fetches), so the worker's fallback is covered by unit tests only; arrival times are not shown offline (no route durations); copies are plaintext in localStorage until sign-out; the `/offline` page works for anyone on the device with no session; not verified in a production build on a real device.
