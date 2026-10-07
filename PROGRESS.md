# Progress Log

Running record of what's happened on this project. Updated
periodically as work proceeds — newest entries on top.

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
