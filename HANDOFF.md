# Handoff

How to pick this project back up in a new session, device, or after a
compaction. Updated at phase transitions, not every task — check the
ledger (below) for exact task-by-task status.

## What this is

Road Trip Photo Planner — see `docs/superpowers/specs/2026-10-06-road-trip-photo-planner-design.md`
for the full design. Being implemented from
`docs/superpowers/plans/2026-10-06-road-trip-photo-planner.md` (24 tasks,
5 phases) using `superpowers:subagent-driven-development`.

## Map-first UI (2026-10-07)

Second feature round: the app is now map-first (see
`docs/superpowers/specs/2026-10-07-map-first-ui-design.md` and the plan next to
it). Built on branch `map-first-ui` (since merged and deleted; follow-up fixes landed via a `final-fixes` branch), ledger at
`.superpowers/sdd/2026-10-07-map-first-ui/progress.md` (git-ignored; recover
from `git log` if gone). Status is in `PROGRESS.md`. Merging to `main`
auto-deploys to Vercel and applies the Turso migration, so: do not push the
feature branch (Preview builds hold the Turso credentials), re-count live trips
before merging (the migration drops trip start/end), and smoke-test the live
site afterwards with a throwaway account.

## Beige map + photo popups (2026-10-07)

On branch `ui-redesign` (not pushed or merged). Wikipedia photos need no key. The
runtime basemap recolour (`src/lib/map-theme.ts`) and the Mapbox popup were never
run against real Mapbox (no token in this environment): check them in a browser
with `NEXT_PUBLIC_MAPBOX_TOKEN` set, including dark mode.

<<<<<<< HEAD
## Photo sources (2026-10-07, branch `photo-sources`, not pushed)

Photos: Flickr (dormant unless `FLICKR_API_KEY`; unverified against the live API)
-> Commons -> Wikipedia; suggestions are ranked by "photos nearby" (Commons count
without a Flickr key, a weaker signal). Still needs a real-browser/Mapbox check of
popups (and an iPhone tap check: first tap on a dot must select it) and, if a key
ever exists, a live Flickr check. See README "Photo sources".

## Light-aware optimization (2026-10-08)

On branch `light-aware` (from `ui-redesign`; not pushed or merged). Adds an
additive Turso migration (`20261008120000_light_aware_stops`: Stop.lightPref,
Stop.dwellMinutes, Trip.departAt), so merging to `main` applies it live on the next
build; it does not drop anything, but verify the build log. Hand-merge note: the
README/PROGRESS/HANDOFF edits sit next to the photo-popup ones from the other
branch. Not yet exercised against real Mapbox.
>>>>>>> light-aware

## Optimize route (2026-10-07)

Built on branch `optimize-route` (not pushed or merged). Uses the Mapbox Matrix
API via `MAPBOX_TOKEN`; verified only against fakes and injected fetch so far, so
smoke-test it with a real token and on a phone-width browser before merging.

## Where the work lives

The project is finished and merged. All code is on `main` of
`origin` → https://github.com/gene500/Photo-App.git. The worktree and
feature branch used during implementation have been deleted. Clone the
repo, `npm install`, and see `README.md` for setup.

## Resume procedure

There is no worktree any more; work in the main checkout of the repo
(`/Users/genestone/road-trip-photo-planner`, branch `main`, or a fix branch off it).

1. Read `PROGRESS.md` (newest entry first) for the latest state.
2. `HISTORY.md` (committed, durable) has per-task completion facts for the
   original 24-task build. The SDD ledgers under `.superpowers/sdd/` are local
   and git-ignored; they may be gone, so trust `git log` and `PROGRESS.md`.
3. For new work, branch off `main`, use
   `superpowers:subagent-driven-development`, and follow the standing rules
   below. Never push a non-`main` branch (see the deploy caution above).

## Standing rules for this project (confirmed by the human partner)

- **Model allocation (updated 2026-10-07 by the human partner):** every
  implementer and every regular (per-task and scoped re-) review runs on
  **Sonnet**. Every *final* review runs on **Opus**: the final whole-branch
  review and the final bug and security passes. (This replaces the earlier
  "Sonnet only" rule; planning is also Opus.)
- **Extra reviews requested beyond the skill's default process:** after all
  24 tasks are complete and the final whole-branch review is clean, dispatch
  two additional subagents in parallel (both Opus, both read-only against
  the finished diff): one hunting for bugs, one for security issues. These
  are in addition to, not instead of, the per-task reviews and the final
  whole-branch review the skill already runs.
- The D1-D9 open decisions table in the plan was presented to the human
  partner and not objected to — treat all nine defaults as confirmed, not
  as still-open questions.
- Keep `PROGRESS.md` (project root, both checkouts conceptually share one
  log, but it physically only exists where last committed) updated at
  phase-level checkpoints — this is a standing preference, not specific to
  this project.
- **tdd-guard is disabled for the remainder of this plan (Tasks 4-24),
  as of Task 4.** Superseded two narrower attempts: (1) setting
  `TDD_GUARD_MODEL_VERSION=claude-sonnet-5` in `~/.claude/settings.json`
  `env` to work around an apparent retired-model failure mode, and (2) a
  pre-authorized toggle-per-incident exception for all-or-nothing schema
  files. A direct probe of the exact SDK call tdd-guard makes (same model,
  same config) returned a clean success response, disproving the
  model-retirement theory. The guard went on to block 3 of 4 tasks across
  three unrelated code shapes (calendar validation logic, a zod schema,
  plain data-access functions) with no identifiable fixable cause — this
  looks like an inherent LLM-judge reliability problem in the plugin
  itself. The human partner confirmed disabling it entirely rather than
  continuing to toggle per incident. **TDD discipline is still required**
  by every task brief and is independently checked by each task reviewer
  against the implementer's RED/GREEN evidence — enforcement moved from
  mechanical (hook) to review-gate, it was not dropped. `TDD_GUARD_MODEL_VERSION`
  can be left set; it's harmless now that the hook won't run anyway.

## Skills/plugins this workflow depends on

This machine has these installed via Claude Code's plugin system
(`~/.claude/plugins/installed_plugins.json`). A different device needs
the first two installed before resuming — the rest of this workflow
assumes their skills exist:

- **`superpowers@superpowers-marketplace`** (v6.3.0, marketplace repo
  `obra/superpowers-marketplace`) — required. Provides every
  `superpowers:*` skill this project's workflow uses:
  - `brainstorming` — used to design the spec (already done)
  - `writing-plans` — used to write the implementation plan (already done)
  - `using-git-worktrees` — used to set up this worktree
  - `subagent-driven-development` — the skill currently driving task-by-task
    implementation (dispatch, per-task review, fix loops, final review)
  - `requesting-code-review` — its `code-reviewer.md` template is what the
    final whole-branch review in subagent-driven-development dispatches
  - `verification-before-completion` — used in Task 24's final verification
  - `finishing-a-development-branch` — used once the final review is clean
  - `systematic-debugging` — referenced as a fallback if the Task 23
    Playwright e2e test is flaky
  - `test-driven-development` — the general TDD methodology every task follows
  To install on another device: add the marketplace
  (`obra/superpowers-marketplace`) via Claude Code's `/plugin` command, then
  install the `superpowers` plugin from it.

- **`tdd-guard@tdd-guard`** (v1.3.0, marketplace repo `nizos/tdd-guard`) —
  required for the workflow to behave exactly as the plan assumes. This is
  a PreToolUse hook that blocks writing implementation code without a
  failing test first, and blocks adding more than one test at a time. The
  plan's Global Constraints section and every task brief are written
  assuming it's active (including the "ask the human partner to toggle
  `tdd-guard off`/`on`" instruction for the handful of files with no
  meaningful unit test). Without it installed, nothing breaks, but the
  TDD discipline becomes advisory instead of enforced, and those
  toggle-the-guard steps become no-ops.
  To install: add the marketplace (`nizos/tdd-guard`) via `/plugin`, then
  install the `tdd-guard` plugin from it.

Two other plugins are installed on this machine (`clangd-lsp`,
`claude-subconscious`) but neither is used by this project — no action
needed for those.

## Current status

Complete and deployed at https://photo-app-pi2o.vercel.app (Vercel +
Turso + Vercel Blob). Pushes to `main` redeploy automatically. Env vars
are managed in Vercel; set them with `vercel env add NAME env --value ...`
(not via stdin, not by pasting into the web form: both caused stray
whitespace). Remaining: restrict the Mapbox token to the site URL. The
map-first UI is merged and deployed (2026-10-07) and the live smoke test
passed. See `PROGRESS.md`. The sections above are historical context for the build.


## Local map data (photo-spot suggestions)

Suggestions are answered from a `Place` table (a copy of OpenStreetMap viewpoints, named peaks and attractions for the 50 states + DC),
not from the public Overpass servers, which often return 504/429. Overpass is only asked when the search is outside the US boxes
(`inLocalCoverage` in `src/server/suggestions/local-places.ts`), or the local copy returns fewer than `MIN_LOCAL_PLACES` (5) places;
if Overpass then fails, the thin local answer is used.

- Build the data: `scripts/build-places.sh` (about 1 hour, 10 GB of downloads, needs `uv`) writes `data/places/*.jsonl` (git-ignored).
- Load it: `node scripts/import-places.mjs data/places --replace` (set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to load the live DB, otherwise `DATABASE_URL`).
- The table is created by migration `20261011120000_local_places`; until it is filled, searches behave exactly as before (Overpass).
- Refresh every few months. Relations (rare multipolygon attractions) are not included; ways use the centroid of their nodes.
- Known gap: just inside the US border a search reaching across it (e.g. San Diego near Tijuana) shows only the US side.
- Query shape (2026-10-09): a search is one database round trip however long the route. Cells are merged into runs read as `cell BETWEEN a AND b` terms (at most 100 per statement, extra statements run in parallel), corner cells outside a circle are skipped, and every cell read is remembered in memory for 30 minutes (`createCellReader`), so a nearby second search needs only the new cells. After a re-import a long-lived server may serve old cells for up to 30 minutes. Around-point results are ranked kind tier, named, then nearest first (routes: kind, named, id).
