# Handoff and task board

The one file that tracks the work and lets another Claude session or machine pick it up. It replaces the old
`TODO.md`. **Update the Task board below the moment any status changes** (and commit it), then trust it, `git log`
and `PROGRESS.md` over memory. The sections after "Current work" are history.

## Task board

Statuses: pending, in progress, completed, blocked, removed. Exactly one item is in progress at a time.
Visibility rule (owner, 2026-10-16): the task chart is shown in the terminal at the end of every reply, always.
Ordering rule (owner, 2026-10-16): anything added goes toward the end of the list, in the order asked; the absolute final row of every list is always one combined row: a full codebase check (Opus), then merge, push, and confirmation that Vercel and CI succeeded; nothing goes after it.
Last updated 2026-10-16.

### PDF itinerary (feature branch `feat/pdf-itinerary`, worktree `/Users/genestone/photo-pdf-itinerary`)

| # | Task | Status | Notes |
|---|---|---|---|
| P1 | Design approved, spec, plan | completed | `docs/superpowers/specs/2026-10-16-pdf-itinerary-design.md`, `.../plans/2026-10-16-pdf-itinerary.md` |
| P2 | Task 1: data builder `src/lib/itinerary.ts` | completed | `8aa6381` |
| P3 | Task 2: Mapbox static map URL `src/lib/static-map.ts` | completed | `50c29be` |
| P4 | Task 3: jsPDF renderer `src/lib/itinerary-pdf.ts` | completed | `bea92fe`, fix `c42d112` |
| P5 | Task 4: download logic and hook | completed | `39c1c37` |
| P6 | Task 5: Export-menu item | completed | `e3360ca` |
| P7 | Task 6: share-page button | completed | `72c0ea0` |
| P8 | Task 7: e2e `e2e/pdf-itinerary.spec.ts` and full gates | completed | `8e6b10c` |
| P9 | Final whole-branch review (Opus) | completed | fixes `6af16a0`; parked: per-stop weather requests on cold cache, `plannedDate ?? ""` |
| P10 | Test in the real app with the Mapbox token | completed | real Mapbox static request returned 200 with CORS open from the browser (editor and share page); both PDFs rendered with the real map, pins, route and schedule (checked visually). Fake directions were used, so the route line was straight | editor + share link; force the static-map request to fail to see the fallback; check a URL-restricted token on the share page (`no-referrer`) |
| P11 | Sweep 1: full-codebase check (Opus) | completed | fixes `7de1487`; parked: weather lib->hook coupling, shared stop-mapping helper, jsPDF optional deps, config drift, per-stop weather requests, thin tests | whole repo on the feature branch; read-only report, fixes ruled and applied after |
| P12 | Sweep 2: bug sweep (Opus) | completed | PDF fixes `c432c60` (NFC accents, 6 s weather cap, note when times missing); older bugs listed in W5 | run after P11, one at a time |
| P13 | Sweep 3: security sweep (Opus) | completed | no Critical/High/Medium; six Low items recorded in W6, none needing PDF code changes | run after P12; include auth, share links, CSP, the Mapbox token, PDF/static-map inputs |
| P14 | Merge `feat/pdf-itinerary` into `main`, push, check Vercel and CI | completed | pushed 2026-10-16 as `9d1c5e7`; Vercel `photo-app-pi2o` success; GitHub Actions CI success. Feature branch and worktree deleted |
| P15 | Clear `~/.playwright-mcp` | completed | |

### Bug fixes from Sweep 2 (branch `fix/sweep2-bugs`, worktree `/Users/genestone/photo-bugfix`, owner said "fix all bugs")

| # | Task | Status | Notes |
|---|---|---|---|
| B1 | Loop routes keep the corridor hole (`corridor.ts`) | completed | `c66e340` on `fix/sweep2-bugs`; Overpass results are post-filtered (the `poly:` filter takes no holes), so a dense loop interior can still use up the 500-element cap: a set difference in the query would be the full fix |
| B2 | Optimize keeps a saved start time that already works | completed | `116950b` + `22dff14` (fix: search window back to sunrise, saved start only wins ties; the e2e caught the first version), reviewed and approved |
| B3 | Trip date change across DST keeps the clock time | completed | `33956a0`, reviewed and approved |
| B4 | `reorderStops` answers 404/409, not 500, on a race | completed | `1da4d5f`, reviewed and approved; answers 409 |
| B5 | Date-line wrap in `cellsForCircle`; `saveTripCopy` orphan | completed | `e1ba19b`, reviewed and approved; parked low items: a place at exactly lng 180.0 is missed (make `cellOf` wrap), weak mid-longitude test, untested had-entry save path |
| U1 | Priority control becomes a tappable pill split into thirds (no dragging) | completed | `3be6e7f` + `4386309` (short "Must" label), reviewed and approved. owner request 2026-10-16 (screenshot of the Stops list); `src/components/editor/StopList.tsx` |
| S1 | Security L2: record the login attempt before bcrypt so parallel guesses cannot overshoot the per-email limit (`src/server/auth.ts:15-19`) | completed | `8346767`, reviewed and approved. owner asked 2026-10-16 for the Low security items to come before the final check |
| S2 | Security L3: deleting a Google-only account needs a fresh Google sign-in, and the prompt stops showing the email (`src/server/users.ts:136`, `SignOutButton.tsx:83`) | completed | `966725f`, reviewed and approved (existing Google-only sessions must sign in once before deleting). |
| S3 | Security L4: clear offline trip copies when a page finds there is no session (`src/lib/offline-store.ts`) | completed | `88fc5ee`, reviewed and approved (adds signup coverage; login already cleared). |
| S4 | Security L6: pin GitHub Actions by commit SHA in `.github/workflows/ci.yml`; check whether a Prisma version without the 4 tooling-only audit advisories exists | completed | `0a21928`, reviewed and approved; Prisma 7.10.1 clears the 4 advisories, CI audit now fails on high. |
| S5 | Security L5: Mapbox tokens: use a separate server `MAPBOX_TOKEN`, URL-restrict `NEXT_PUBLIC_MAPBOX_TOKEN`, set a spend cap | blocked | owner action in the Mapbox and Vercel dashboards (cannot be done from code); steps will be given in the reply. L1 (signup 409) is accepted, no work |
| U2 | Trip header: Edit trip, Export and Share sit to the right of the trip name on the same line (they wrap under the name in the narrow panel today) | completed | `0cdd0f5`, reviewed and approved (long names truncate to ~3 characters at 320px by design; full name in the tooltip). owner 2026-10-16 (screenshot). `src/components/editor/TripHeader.tsx` outer row has `flex-wrap`; brief `u2-brief.md` |
| U3 | Remove the Optimize note text under the button ("Start time moved to … Can't fit N stops in their light: …") | completed | `1347cfc` (note is now screen-reader-only; diff checked by me, small). owner 2026-10-16 (screenshot); removes both sentences; brief `u3-brief.md`; runs after B2 is merged in the same branch, so it is safe to edit that code |
| U4 | Undo beside Optimize route looks like a button (it is plain grey text today) | completed | `8e8ea47` (pill-shaped secondary button, screenshots checked light and dark by me). owner 2026-10-16 (screenshot); `TripEditor.tsx` ~745-755; brief `u4-brief.md` |
| U5 | "Misses golden hour" and "likely washed out" warning text is beige instead of orange-pink, and the End badge no longer breaks the last stop text layout (new token; real errors keep the danger colour) | completed | `7ca0590` + `ab01a46` (weather line beige too), screenshots checked light and dark by me. owner 2026-10-16 (screenshot); brief `u5-brief.md` |
| B6 | FINAL (always the last row, combined): full codebase check (Opus), handle its findings, then merge, push to `main`, and confirm both Vercel (`photo-app-pi2o`) and CI succeeded | in progress | owner 2026-10-16: the final full codebase check always includes merge, push and the Vercel/CI confirmation; nothing goes after it. Replaces the earlier separate B6 (review/merge/push) and B7 (check) rows |

### Waiting on the owner

| # | Task | Status | Notes |
|---|---|---|---|
| W1 | Push local `main` to GitHub (includes the merged PDF feature) | completed | pushed as `9d1c5e7`; later docs-only board commits stay local until the next push | `git log origin/main..main` lists what is waiting (speed-up merge, test fix, PDF spec/plan, handoff) |
| W2 | Delete leftover branch `worktree-agent-a22e92e8e241870c4` | completed | deleted 2026-10-16 at the owner's request; it held one commit, `2cdb6e8` (faster local places query), recoverable from that hash while the object exists |
| W3 | Share link opens the generic page, not the shared trip (reported 2026-10-14) | removed | owner 2026-10-16: it was fixed in a different session; nothing left to do here |
| W6 | Low security findings from Sweep 3 (all pre-existing or config) | completed (except S5, owner action) | now tracked as rows S1-S5 above; details kept here for reference | L1 signup 409 reveals registered emails (accepted: email verification was dropped by the owner, so this stays as a known gap); L2 per-email login limit can be overshot by parallel requests (`src/server/auth.ts:15-19`, record the attempt before bcrypt); L3 a Google-only account can be deleted by typing its email and the prompt shows the email (`src/server/users.ts:136`, `SignOutButton.tsx:83`); L4 offline copies persist after a session ends without explicit sign-out (`src/lib/offline-store.ts`); L5 use a separate server Mapbox token and URL-restrict `NEXT_PUBLIC_MAPBOX_TOKEN` (share-page visitors can now trigger Static Images calls with the public token, so also set the Mapbox spend cap); L6 pin GitHub Actions by SHA, upgrade Prisma when a fix for the 4 high tooling-only audit advisories ships |
| W5 | Older bugs found by Sweep 2 (not PDF related, still on `main`) | completed | fixed in the sweep2 branch (B1-B5); parked low items: a place at exactly lng 180.0 can be missed after the wrap fix (wrap `cellOf` in `places-grid.ts` and `scripts/places-cell.mjs`, then re-import), loop routes drop Overpass results outside the outer ring (check holes only), thin tests for tie-break, route 409, multi-hole corridors, had-entry saveTripCopy | (1) Important: loop routes lose the corridor hole, `src/server/suggestions/corridor.ts:47-48` keeps only `coordinates[0]`, so suggestions fill the inside of a loop; (2) Optimize replaces a working start time and says it moved it (`src/app/api/optimize/route.ts`, `optimize-schedule.ts` bestDeparture; may be intended); (3) changing the trip date across a DST change shifts the start time by an hour (`src/server/trips.ts` shiftedDeparture); (4) `reorderStops` checks outside its transaction (500 instead of 404 on a race); (5) `cellsForCircle` does not wrap at +-180 longitude. Fix on a separate branch |
| W4 | Email verification and signup email enumeration (409) | removed | owner 2026-10-16: not doing email verification, so no mail provider is needed |

### Backlog (from the old TODO.md; not started)

To verify by hand:
- Apple Maps link with every stop, on a real iPhone (the multi-`daddr` format is unconfirmed).
- Google Maps link with every stop (up to 11 stops per link; longer trips split into parts).
- Hover photo card stays fully on screen in the Suggestions tab.
- Priority pill (Stops tab: Normal / High / Must) and optimize behavior with a Must-have stop, on a real phone.
- Live site: sign-in, map, suggestions, photo upload, privacy/terms, account deletion, Imperial/Metric setting, Escape key, prewarm speed.

Owner's accounts and settings:
- Set `CRON_SECRET` in Vercel (any long random string) so the daily photo-cleanup cron works; without it the route does nothing.
- Sign in with Google: create an OAuth client in Google Cloud Console (redirect URI `https://photo-app-pi2o.vercel.app/api/auth/callback/google`), then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel. The button stays hidden until both are set.
- Use a separate unrestricted server Mapbox token (`MAPBOX_TOKEN`); URL-restrict the public `NEXT_PUBLIC_MAPBOX_TOKEN`; set a Mapbox spend cap (each PDF download is one static-image request).
- Rotate Vercel Blob credentials and restrict them to Production.
- Delete the duplicate empty Vercel project `photo-app`.
- Replace the GitHub-issues contact link (`CONTACT_URL` in `src/components/legal/LegalPage.tsx`).
- Get legal review of the privacy and terms pages.

Known gaps:
- Suggestion quality: the local places table has no OSM tags; add `wikidata`, `memorial` and `access` to `scripts/extract-places.py`, rebuild, re-import, then filter and boost on them.
- Optional free Flickr API key (`FLICKR_API_KEY`) for the strongest photo counts.
- Google accounts are never auto-linked to an existing password account with the same email.
- Must-have priority is a heavy weight, not a hard block.
- Optimize keeps a saved start time when it costs nothing; otherwise it searches from sunrise (the result is announced to screen readers only).
- CSP still allows `'unsafe-inline'`.
- Google-only account deletion re-confirms through Google's account chooser (`prompt=select_account`; `login` is not a documented Google value); existing sessions must sign in once first.
- Header buttons no longer wrap: at 320 px with extra-large text a long trip name may shrink to almost nothing (unchecked).
- Share page `no-referrer` vs a URL-restricted Mapbox token.
- Offline copies are cleared on sign-out and when the login or signup page is shown (session ended); they stay while the device is offline.
- Rate limits other than login/signup/password/delete are per instance; no monitoring or alerting yet.
- `updateTrip` find-then-update is not atomic.
- Playwright timezone is not pinned for specs other than the hydration one.
- Skills in `.agents/skills` reference plugin commands that are not installed.
- Parked PDF review findings (none blocking): no tests for `saveBlob`, `mapTokenFromEnv`, `createItineraryPdf`; PDF title loop has no page-break check (names are capped at 120 chars); the editor's PDF error alert shows only while the Export menu is open; no TripEditor-level test for the `pdf` prop; antimeridian and long-title tests assert only valid output; the share-page PDF prints arrival times without the page's "estimates from straight-line distances" caveat when routing was unavailable.

## Current work: PDF itinerary (2026-10-16)

**Goal:** a "Download PDF" action in the editor's Export menu and on the public share page: a schedule of every stop
plus a route map, built in the browser with jsPDF (loaded only on click). The plan has a "Deviations" section
(the fallback map is drawn with PDF vector shapes; editor weather is fetched at click time).

**Where the code is:** branch `feat/pdf-itinerary` (based on local `main` at `682414c`), worktree
`/Users/genestone/photo-pdf-itinerary`. **The branch is local only and must not be pushed** (Preview builds hold the
Turso credentials, see the deploy caution below). On another machine it does not exist: the work only reaches
GitHub when merged into `main` and pushed.

**Resuming the subagent build:** the controller ledger is
`/Users/genestone/photo-pdf-itinerary/.superpowers/sdd/2026-10-16-pdf-itinerary/progress.md` (git-ignored, local; if
gone, trust `git log feat/pdf-itinerary`). Briefs and reports sit next to it as `task-N-brief.md` and
`task-N-report.md`. Do not re-dispatch a task with a `complete` line in the ledger.

**Owner's standing rules (also in memory and `CLAUDE.md`):**
- "push" means push to `main` of `gene500/Photo-App`; never push other branches.
- After every push, check that Vercel deployed: only project `photo-app-pi2o` counts
  (https://photo-app-pi2o.vercel.app); the command is in `CLAUDE.md`. Also watch the GitHub Actions run.
- Keep the Task board above current and report progress against it.
- Run subagents one at a time. Implementers and per-task reviews on Sonnet; final reviews and any full-codebase check (whole-repo audits, security and bug sweeps) on Opus.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and a `Claude-Session:` line.
- Never print or commit the Mapbox `pk.` token; it lives only in gitignored `.env` files.

**Setup on a new machine:** clone the repo, `npm ci`, copy `.env.example` to `.env` and `.env.local` and fill in values
(the Mapbox token is not in git), then `npm run typecheck && npm run lint && npm test`. Next.js here is 16.x with
breaking changes: read `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).

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

Built on branch `ui-redesign` (since merged to `main`). Wikipedia photos need no key. The
runtime basemap recolour (`src/lib/map-theme.ts`) and the Mapbox popup were never
run against real Mapbox (no token in this environment): check them in a browser
with `NEXT_PUBLIC_MAPBOX_TOKEN` set, including dark mode.

## Photo sources (2026-10-07, since merged to `main`)

Photos: Flickr (dormant unless `FLICKR_API_KEY`; unverified against the live API)
-> Commons -> Wikipedia; suggestions are ranked by "photos nearby" (Commons count
without a Flickr key, a weaker signal). Still needs a real-browser/Mapbox check of
popups (and an iPhone tap check: first tap on a dot must select it) and, if a key
ever exists, a live Flickr check. See README "Photo sources".

## Light-aware optimization (2026-10-08)

Built on branch `light-aware` (since merged to `main`). Added an additive Turso
migration (`20261008120000_light_aware_stops`: Stop.lightPref, Stop.dwellMinutes,
Trip.departAt); it drops nothing, but check the build log of any deploy that carries
a new migration. Not yet exercised against real Mapbox.

## Optimize route (2026-10-07)

Built on branch `optimize-route` (since merged to `main`). Uses the Mapbox Matrix
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
