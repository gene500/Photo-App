# Handoff and task board

The one file that tracks the work and lets another Claude session or machine pick it up. It replaces the old
`TODO.md`. **Update the Task board below the moment any status changes** (and commit it), then trust it, `git log`
and `docs/archive/PROGRESS.md` over memory. Where things are: this file = START HERE, board, standing rules, Claude Code setup. `docs/BACKLOG.md` = owner follow-ups and known gaps. `docs/LOCAL-PLACES.md` = local map data. `docs/design/` = specs and design notes. `docs/archive/` = history (old board rows, progress log, plans, test reports).

## START HERE (a fresh Claude session reads this first; updated 2026-11-18)

**Goal:** Photo Op Planner, a road-trip photo planner (Next.js 16, Prisma/libsql, next-auth, Mapbox). Live at https://photo-app-pi2o.vercel.app (Vercel project `photo-app-pi2o` only; `photo-app` is an empty duplicate).

**QA sweep (2026-11-19, MERGED and PUSHED to `main`, live; CI `check` and `e2e` and Vercel `photo-app-pi2o` succeeded on `9e476ec`):** fixes P3-001 side panel needs 480px width, P3-004 drawer labels, in-app Reduce motion reaches the map, manifest id/lang, test mock fix, `npm audit fix`, plus `effect` override `^3.22.1` (clears the prod audit high without a Prisma major upgrade), `e2e/smoke.spec.ts` and `e2e/keyboard-portrait.spec.ts`. Report: `qa-report/REPORT.md` (its "Needs my decision" list is still open for the owner; item 3, the Prisma upgrade, is no longer needed for the audit). Leftovers: worktree `.claude/worktrees/qa+full-sweep` and branches `qa/full-sweep`, `worktree-qa+full-sweep` can be deleted; `/tmp/qa-*` scratch copies.

**Starting point (verify with `git status` and `git log`; trust them over this text):**
- Repo `~/Photo-App` (older machine: `/Users/genestone/road-trip-photo-planner`), branch `main`, remote `gene500/Photo-App`. Last pushed commit: `3461492` (A89 cleanup/optimization plus F11/F12, pushed 2026-11-18; Vercel `photo-app-pi2o` success, CI `check` and `e2e` success; legal pages reviewed, no change needed). A90-A94 pushed on 2026-11-19; A93 waits on the owner.
- **Pushed in `2ee3008` (nothing else uncommitted except this file):** A61 (optimizer: lost-cause light misses capped, so equal-priority routes stop zigzagging), A62 (Start from my location), A63 (NPS alerts + OSM opening-hours notices; `docs/design/A63-DESIGN.md` is tracked now), A64 (Visited checkbox + quiet auto re-optimize), A65 (themed PDF), F12 (fixes from the Opus FINAL review), plus test-stability edits (`tests/setup.ts` asyncUtilTimeout 5 s, optimize stall threshold 500 ms, fake timers in TripEditor tests).
- Last verification before F16-F19 (2026-10-29, my runs): tsc clean, lint clean, vitest 2101/2102 (the one failure was the wall-clock check "9 stops" taking 8 s under load; 1.1 s alone), e2e 58/59 (swap-undo failed under load; passed alone 2/2).

**What needs to be done:** see the Open tasks below (A71 owner browser check; everything else is in the archive). Docs were reorganised on 2026-11-05 (A66). Owner follow-ups are in the paragraph below and in `docs/BACKLOG.md`.

**Owner follow-ups (not code):** PDF CJK fonts (F3-F6): for text with kana the app loads the Noto Sans JP subset (JIS X 0208 level 1+2, 2.28 MB, Latin Extended/Greek/Cyrillic merged in from Noto Sans); if that file lacks any of the text's characters (e.g. simplified hanzi such as 宫 们 这, or symbols like № ①) the Noto Sans SC file is loaded too and the one missing fewer characters is used (Japanese on ties). Remaining limits: a character in neither file still prints "?"; a text with both simplified-only hanzi and JIS level 2 kanji cannot be fully covered by one font, so the minority prints "?"; Han-only Japanese text (no kana) uses the SC font and can print "?" for JIS level 2 kanji; look at a real PDF in a viewer; try Optimize on the real Yosemite trip (A61: the zigzag is reduced, not eliminated; a 100-case random run showed median drive ratio 2.59 to 1.94 vs drive-only; fallback idea: reject out-and-back orders directly); create a free NPS key (https://www.nps.gov/subjects/developer/get-started.htm) and set `NPS_API_KEY` in Vercel (Production and Preview) and local `.env`; look at the real Mapbox map and a real PDF static map (light pins like `#e0a98a` may have a hard-to-read white label); real-browser geolocation permission flow; L3 (notice fetches may be frozen on Vercel after the response; consider `after()`) and L4 (NPS: only 10 parks, `limit=100` alerts, loose 35 km park matching); known gaps: ticks from the Stops tab list, drawer and OfflineView do not trigger auto-optimize, sparse trailing PDF page, no test for 503 busy with an origin. The macOS `StorageManagementService` process slows tests and causes load-only failures.

**Next steps after FINAL / open owner decisions (not started):** stop/place card covering the sheet header on portrait phones; background refresh of a stale tab; limiter 10,000-key lockout; Mapbox and Flickr cost caps; Google sign-in privacy copy; Mapbox `pk.` token URL restriction and spend cap. Owner follow-ups that are not code are in `docs/BACKLOG.md`. Ask the owner which to take next.

**Setup on a new machine:**
1. `git clone https://github.com/gene500/Photo-App.git road-trip-photo-planner && cd road-trip-photo-planner && npm ci` (postinstall runs `prisma generate`). Node 25.x, `gh` logged in with access to the repo.
2. Copy `.env.example` to `.env` and `.env.local`; fill in values (names listed under "Claude Code setup"). The Mapbox token is not in git; never print or commit it or any `TURSO_*` value.
3. `npx playwright install chromium` (chromium only; no Safari/WebKit locally).
4. Recreate the gitignored `.claude/` folder (see "Claude Code setup"); `~/claude-config` is the private repo behind `~/.claude/CLAUDE.md`: `git -C ~/claude-config pull --ff-only`.
5. Read `AGENTS.md`: Next.js 16 has breaking changes, read `node_modules/next/dist/docs/` before writing Next-specific code.

**Commands:**
- `npm run typecheck && npm run lint` ; `npx vitest run` (run the full suite alone; it flakes under machine load, re-run alone before calling a failure real).
- `npm run dev` (app); e2e: `npm run e2e` (port 3100, fresh `e2e.db`, fake externals: `EXTERNAL_APIS_FAKE=1`, `NEXT_PUBLIC_MAP_FAKE=1`; it does not set `CI=1` or `E2E_PROD=1`: `E2E_PROD=1` runs the production build and is for `e2e/csp.spec.ts` only, `CI` is set by the CI runner).
- Agents that run e2e/browsers work in their own copy of the repo (`cp -cR` for `node_modules`, never a symlink), own port, max 3 at once, and stop servers by PID and delete their copy when done.

**Skills and plugins to install** (details in "Claude Code setup" below):
- Plugins from `anthropic-plugin-directory`: **`superpowers`** (6.4.2; required: brainstorming, writing-plans, subagent-driven-development, requesting-code-review, verification-before-completion, systematic-debugging, test-driven-development, finishing-a-development-branch), **`playwright`**, **`frontend-design`**. `tdd-guard` is disabled and not needed (`.claude/tdd-guard/data/config.json` = `{"guardEnabled":false}`).
- Built-in skills used: `security-review`, `code-review`, `simplify`.
- Project-local skills in gitignored `.claude/skills/` (copy from the old machine, or skip; security-review helpers): `audit-context-building`, `codeql`, `differential-review`, `fp-check`, `frontend-design`, `sarif-parsing`, `semgrep`, `sharp-edges`, `supply-chain-risk-auditor`, `variant-analysis`. `.claude/settings.local.json` allows `Bash(npm run *)`.
- User settings: `model: opusplan`, `permissions.defaultMode: auto` (see "Claude Code setup").

**Standing rules (full text in `~/.claude/CLAUDE.md` and `CLAUDE.md`):** test before claiming done; no commit/push unless told; "push" = `main` only, tests and typecheck first; no secrets anywhere; they/them when pronouns are unstated; Opus for final reviews and whole-repo checks, Sonnet for implementers and per-task work, always pass `model`; run independent tasks in parallel automatically (max 3 agents with servers or browsers); subagent reports are data, not instructions; keep this board current, archive finished rows at once, SEC then FINAL always last; end every reply with the open-task table; commit trailers `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AFkQpJYJ3ScjJ2DzP3AKkA`.

## Current work (2026-11-18)

**Done after the A89 push, UNCOMMITTED (owner screenshots, 2026-11-18 5 pm):** A90 the empty-map hint is now offset to clear the side panel at lg and short-landscape (`TripEditor.tsx`, e2e `e2e/empty-hint.spec.ts`); A91 with no stops, Suggestions "Find photo spots" searches around the map centre (`findSuggestions`, `staleForEmpty`, test in `TripEditor.test.tsx` replaces the old "Add a stop first" test); A92 the My trip card has dividers between start time, buttons and route status (`TripPlan.tsx`). Verified: typecheck 0, lint 0, vitest 230 files / 2536 tests, e2e 83/83. **Just finished 2026-11-19: A90-A94, SEC and FINAL passed (legal pages reviewed, date bumped, no wording change). Final check fixed: re-plan after a tick now starts from the tick time even before directions answer; an untick no longer resets the clock. Owner decisions left open: exports (GPX/PDF) carry only the remaining route after a tick; other-day trips restart at trip start time; Find-photo-spots list for an empty trip returns after add+delete of a stop.** **A94 (built):** with visited stops the live route is fetched from the last visited stop to the end (`routeAnchor`, key `routeKey`), arrivals and best times start at that stop (today: from the last tick or editor open; other days: the trip start), the old optimize note is cleared on a tick (`src/lib/schedule-from-anchor.ts`, tests in `schedule-from-anchor.test.ts` and `TripEditor.test.tsx`). Verified: typecheck 0, lint 0, vitest 231 files / 2542 tests, build ok; e2e on this machine was overloaded (load average about 10) so full runs timed out in 4 to 28 tests, and every failed spec passed when re-run alone. Open: A93. The owner said Optimize itself was fine (their stops were just in that order).

**Status at the end of the A89 batch (2026-11-18):** A89b cleanup (passes 1 and 2), sweeps T7-T11, fix F11, repeat sweeps T12-T16, fix F12, SEC (Opus, no Critical/High/Medium) and the FINAL Opus full check are all done and archived in `docs/archive/HANDOFF-ARCHIVE.md`. Verified on the final tree: typecheck 0, lint 0, vitest 230 files / 2536 tests, `npm run build` ok, e2e 79/79. Pushed as `3461492`; FINAL is complete.

**F11 (stale zone):** `src/lib/intl-cache.ts` now caches a formatter only when an explicit `timeZone` is passed; with no zone it builds a fresh one per call (the default zone can change while a page is open). In production only `formatDateOnly` (UTC) is cached, so the clock-formatter speed-up no longer applies (owner may simplify the cache later). **F12:** `TripPlanList` passes the device time zone to the memoized `TripRow` as a prop so rows re-render on a zone change (test added); the list handler ref in `TripEditor.tsx` is refreshed in `useLayoutEffect` (FINAL note L1). **Owner decisions left:** keep or drop the formatter cache; add `IF NOT EXISTS` to the index migration (it fails the Vercel build only if someone created `Stop_photoUrl_idx` by hand); the old `scripts/perf*` / `bench-*` copies (about 5,700 lines).

**Push checklist:** `git add -A` (the untracked new files are imported by tracked code); commit message says "legal pages reviewed (no change needed)" (busy-day rule: 11 files under `src/server`; `LEGAL_UPDATED` is "November 19, 2026" (reviewed 2026-11-19, no wording change); if the push happens on a later day do the daily legal review first and bump the date); run typecheck and tests; push to `main`; check Vercel `photo-app-pi2o` and CI (`check`, `e2e`); watch the Turso migration step closely (the `e8c6584` deploy failed once for an unseen reason).

**Cleanup pass 2 (components, 2026-11-18, uncommitted, behavior unchanged):** `TripEditor.tsx`: `waypointKey`, `ownPlacesKey`, `idsKey`, `prefsKey`, `planKey` and the header `exportData` are `useMemo`; the list handlers go to the rows through stable `useCallback` wrappers that call the newest logic via a ref refreshed every render. `StopList.tsx`/`TripPlanList.tsx`: rows are `React.memo`; `ids` (keyed on the joined ids), `idsKey`, `announcements` memoized; dnd-kit sensor options hoisted to module constants (new option objects every render were re-rendering every sortable row). `MapPanel.tsx`: stop-marker effect skips DOM writes whose value is unchanged (background remembered in a WeakMap). Skipped: fan-offset effect signature (a drag-end that leaves the coordinates unchanged resets the offset and relied on the re-run to re-fan, so not provably equivalent). New test `TripEditor.rows.test.tsx` (render-count probe).

**Cleanup pass 1 (server + lib, 2026-11-18, uncommitted, behavior unchanged):** removed `WALK_METERS_PER_MINUTE` (not bit-identical to the 60/4000 arithmetic) and the dead `KIND_TAGS` branch; shared helpers `src/server/prisma-helpers.ts` (`hasPrismaCode`, `photoUrlsOf`), `sanitiseDurations` (optimize-order), `memoLookup` (popularity), `isNum` swaps in src/lib; cached `Intl.DateTimeFormat` (`src/lib/intl-cache.ts`, used by `formatClock` and `dates.ts`) and a 500-entry `getSunWindows` memo (callers get fresh Date copies); new index `Stop_photoUrl_idx` (migration `20261118120000_stop_photo_url_index`). Skipped: uploads route `Buffer` body (tsc rejects it), `loadSharedTrip` select (mapper types), item 3 type imports (still used). Tests: `src/lib/clock-format-equiv.test.ts`, `src/server/prisma-helpers.test.ts`.

**F10 work done (2026-11-18, uncommitted, tests first):** lot markers (single-linkage grouping, drawn below stop numbers and offset to the lower right, overlapping labels hidden via `hiddenLotLabels`), offline copy shows the park line, share-page fallback times use lots, optimizer start window reaches back by the walk and miss minutes share one rounding (`roundMissMinutes`, misses reported for the returned start), `hasWalkLength` replaces the `/, walk /` text test, OSM lot/trailhead coordinate range check, `/api/stops/[id]/access` deadline (`ACCESS_DEADLINE_MS` 17 s, under the client's 20 s), Overpass heavy retry asks a different mirror, legal review (privacy: parking-spot wording in Mapbox, Google/Apple Maps and offline-copy bullets) and `LEGAL_UPDATED` November 18, 2026. Item F (cosmetic walk print) left as is. F10 itself was pushed in `5181cd2`.

## Current work (2026-11-17)

**A87 work done (2026-11-17, uncommitted, tests first): include estimated walk.** `src/lib/walk-time.ts` (flat 4 km/h, minutes rounded up to 5, cap 300) is the one helper. `computeLotArrivals` (arrive at the lot; leave after walk + dwell + walk) and `computeArrivals` (subject = lot + walk) in `src/lib/best-time.ts`; `Evaluator` in `src/lib/optimize-schedule.ts` takes `walkMinutes` per stop (light judged at the subject, hold time = dwell + 2 walks); `/api/optimize` accepts optional `stops[].walkMinutes` (int 0-300) and uses it for opening-hours arrivals; `TripEditor` sends it and uses lot arrivals for the visited anchor; `parkText` prints "(~N min)" and an optional lot time; PDF and share page pass `lotArrival`. `routeSignature` is unchanged, so a lot arriving does not flip "Your stops changed". e2e: `e2e/parking-route.spec.ts` (walk test). Not committed, nothing pushed.

**A88 work done (2026-11-17, uncommitted, tests first):** every stop with a lot gets a "P" marker with the lot name on the editor and share maps (`src/lib/lot-markers.ts` groups and labels: merge within 30 m, 18-char label, labels hidden below zoom 11, selected one larger by class toggle, markers rebuilt only when the lots change; `MapPanel.tsx`, `FakeMapPanel.tsx`, CSS `.lot-marker`/`.lot-label` in `globals.css`); new `ParkLine.tsx` shows "Park at X, walk N to Y" in the stop card, drawer and My trip rows (row keeps "Hike N one way" only when the walk length is unknown); share popover mentions the parking spot. Real Mapbox markers are not testable here (no WebGL). New untracked files: `src/lib/lot-markers.ts`, `src/lib/lot-markers.test.ts`, `src/components/editor/ParkLine.tsx`, `src/components/editor/ParkLine.test.tsx`. Next: A87 (walk time).

**State (2026-11-17, parking-lot routing, Task 6 done):** Tasks 1-6 of `docs/superpowers/plans/2026-11-17-parking-access-point.md` are in the UNCOMMITTED working tree, nothing pushed. Untracked files to add when committing (from `git ls-files --others --exclude-standard`): `docs/superpowers/plans/2026-11-17-parking-access-point.md`, `docs/superpowers/specs/2026-11-17-parking-access-point-design.md`, `e2e/parking-route.spec.ts`, `prisma/migrations/20261117120000_stop_access_point/migration.sql`, `prisma/migrations/20261117130000_stop_access_walk/migration.sql`, `src/app/api/stops/[id]/access/route.ts`, `src/app/api/stops/[id]/access/route.test.ts`, `src/components/editor/TripEditor.access.test.tsx`, `src/components/editor/use-access-resolver.ts`, `src/components/editor/use-access-resolver.test.tsx`, `src/lib/route-points.ts`, `src/lib/route-points.test.ts`, `src/server/stop-access.ts`, `src/server/stop-access.test.ts` (plus any later additions: check `git status`).

**F9 work done (2026-11-17, uncommitted, tests first):** (1) `moveStop` numbers moves per stop (`movesRef`: `seq`, `pending`, last `saved` place): only the latest answer sets position and merges; the lookup hold is released when no save of that stop is pending (then a re-scan is forced); a failed older save is ignored, a failed latest one rolls back to the last saved place. (2) `useAccessResolver.busy()` counts held stops, and the scan wakes idle waiters, so Optimize waits for a moved stop's lot. (3) A late 404 for a stop deleted meanwhile is swallowed; other errors still show. (4) `fetchOverpass` with `stopOnHeavy` asks ONE more mirror after a heavy remark: both heavy gives `OverpassTooHeavyError` (finished no-lot, `accessResolvedAt` set), second ok gives its answer, second failing gives a plain `OverpassError` (failed, retried); suggestions callers unchanged. (5) `cleanLine` returns null for invisible-only text (write path: `lotName`, `cleanName`); `parkText`, `toAccess` and `normalizeAccess` treat an invisible-only name as none. (6) `osmHikeQuery` clamps the box to lat 90 / lng 180 (no wrap) and `fetchOsmTrails` keeps lots and trailheads only within the radius by haversine; service tests with a 4 km lot now use a U-shaped trail so the lot is inside the 2.5 km circle. No legal wording change needed.

**F8 work done (2026-11-17, uncommitted, verified: typecheck, lint, vitest 224/2447, e2e 78/78):** (1) `fetchOverpass` has an opt-in `stopOnHeavy` that fails at once with `OverpassTooHeavyError` on an out-of-memory / over-size remark (no other mirrors, no retry; suggestions callers do not set it, so they are unchanged); `fetchOsmTrails` turns that into an empty finished result, so `lookupHike` returns no hike with `failed: false` (cached 1 h like "no hike") and `accessResolvedAt` gets set; a plain network failure is still `failed: true`. (2) Google and Apple Maps links use the lot (`ExportStop.access`, `routePoint` in `point()`; share page passes `access`); GPX unchanged. (3) A stop moved before its first lookup: `useAccessResolver` takes `isHeld` and `TripEditor` holds a stop while its move PATCH is in flight (smaller change than sending lat/lng); the optimistic move also clears `access`/`accessResolvedAt` and a failed move restores them. (4) `parseOsm` accepts parking nodes with `lat`/`lon` or `center`. (5) `waitForLots` 30 ms settle left as is: `optimizeRoute` reads `stops`, `arrivals` and more from the render closure, so an exact ref signal is not a small change.

**F7 done (2026-11-17, uncommitted; later superseded where F8/legal say otherwise: Maps links now use the lot, privacy/terms were reworded and need the owner's OK):** fixes from the three QA agents on parking-lot routing, all in the working tree. A: the resolver retries unresolved stops when the browser goes online. B: Optimize (manual and auto) waits for pending lot lookups (`whenIdle`, 8 s cap). C: after the first request, directions wait 1.2 s of quiet (at most 5 s since the first change held back) while lookups are pending; the first draw is never delayed (A86 speed pass: was 300 ms, which made 18 requests for 25 stops looked up 3 at a time with a lot landing about every second, now 10 or fewer). D: `break-words` on the shared park line. E: lot names cleaned and clamped (surrogate-safe) on write and read. F: lots with access customers/permit or parking street_side/lane/underground are skipped. G: the 5000 m walk cap also applies to trailhead markers. Legal pages need no wording change (no new data, provider or storage). Google/Apple Maps and GPX export untouched (owner decision pending).

**A86 speed pass (2026-11-17, uncommitted):** `Graph.nearestEdge` in `src/server/hike/graph.ts` now uses a 40 m edge grid (a 20k-segment trail set took 1.9 s of blocked event loop, now about 0.09 s; same answers, checked against a brute-force scan in `graph.test.ts`); the directions debounce while lots arrive is 1.2 s with a 5 s cap (`TripEditor.tsx`, test in `TripEditor.access.test.tsx`). Measured and left alone: NPS in parallel with OSM (would add an NPS call to every cold lookup to save time only when OSM has no lot), the cache (already shared by `/api/hike` and the resolver), map marker effects, per-render keys (about 8 microseconds), share page and trip queries (no N+1).

**Just finished (2026-11-17):** Task 6: `e2e/parking-route.spec.ts` (parking marker, `/api/directions` body ends at the lot, hike line starts at the lot, share page route starts at the lot, a far stop routes to itself, PATCH move clears and re-resolves); full e2e 78 passed alone on port 3210; no existing spec needed changing. README (new "Hikes and parking-lot routing" section) and `docs/design/A53-DESIGN.md` updated. Legal pages reviewed and updated (privacy: the stored parking spot per stop, shared via share links, the automatic lot lookup sending the stop's coordinates to OpenStreetMap; terms: parking spots may be wrong); `LEGAL_UPDATED` was already November 17, 2026.

**Next:** SEC (`/security-review`), then FINAL (Opus full check), then wait for the owner's "push". Owner decision: confirm the new privacy wording (stored access point, share link exposes it, automatic lookup on add/move/open).

**Earlier state (2026-11-16, superseded where it disagrees):** HEAD `327f649` (= origin/main, the A78-A82 push, deployed and CI green). Everything below is UNCOMMITTED in the working tree and nothing is pushed: A83 (Next 16.4.6), F1-F6 fixes, the new Noto Sans JP PDF font, and the legal date bump. Legal pages reviewed (no wording changes, date bumped to November 17, 2026). The 6 untracked files that must be added when committing: `e2e/layout-fill.spec.ts`, `public/fonts/NotoSansJP-Regular.ttf`, `scripts/subset-noto-sans-jp.py`, `src/app/api/optimize/route.fix-minute.test.ts`, `src/app/forced-colors.test.ts`, `src/components/editor/TripEditor.f2.test.tsx` (plus any later additions: check `git status`).

**Just finished (2026-11-16):** F6 (fixes from the Opus review of F1-F5): (1) PDF font choice is now by coverage, not by script guess: `loadPdfFonts` loads the Japanese file for kana text and, only if it lacks some of the text's characters (or failed), also the Chinese file, then keeps the one missing fewer of the text's code points (Japanese on ties; `missingCount`/`pickCjk` in `src/lib/pdf-fonts.ts`; `JP_COVERAGE`/`jpCovers` removed); "北京故宫" next to kana prints correctly again. (2) Optimize waits for the whole start-time save chain (StartTimeControl `commitRef`, TripEditor `startChainRef`). (3) `scripts/subset-noto-sans-jp.py` writes its intermediate file to a temp dir. (4) `@supports not selector(:has(*))` fallback in `src/app/globals.css` for the editor's definite height. (5) this file and README updated. Earlier in the batch: A83 (Next 16.4.6), F1-F5, legal review. Older: A78-A82 (2026-11-11, see `docs/archive/`).

**SEC and FINAL (Opus, 2026-11-11):** SEC no findings at confidence 8+; FINAL READY, no blockers. Non-blocking notes: with a time budget `optimizeScheduleAsync` results depend on speed by design (faster code can search further before the cutoff; without a budget results are identical); timing-sensitive jsdom tests now run in parallel, so watch CI for flakiness; `cellRuns`/`terms` differ from the old code only for NaN/-0 inputs that validation prevents.

**Next (2026-11-16, owner request):** loop of Sonnet agents that poke the app (T rounds, report only) and fix passes (F rounds) until a T round finds no issues; then SEC, FINAL (Opus full check, then wait for the owner's "push"). Uncommitted: see State above for the 6 untracked files.

**Owner:** eyeball the real map controls and My trip card (A74/A75), legal review points from A77, T17/H8 behavior-changing lists in `docs/STRESS-LOG.md`, and open owner decisions (Priority-focus ratio, forgot-password H7, orphan photo file, weather DST check, optional knip cleanup of `scripts/`).

## Task board

ID prefixes (owner, 2026-10-26): A = alpha (owner work items), T = testing passes by agents (bug hunts), F = fix passes, H = older bug sweeps (history), then SEC, then FINAL.

Statuses: pending, active, paused, blocked, completed, removed. Exactly one item is active at a time.
Visibility rule (owner, 2026-10-16): the task chart is shown in the terminal at the end of every reply, always.
Ordering rule (owner, 2026-10-16): anything added goes toward the end of the list, in the order asked; the list order is: owner work items, then the bug sweeps (H rows), then the final row; the absolute final row of every list is always one combined row: a full codebase check (Opus), then merge, push, and confirmation that Vercel and CI succeeded; nothing goes after it.
Last updated 2026-11-18

### Open tasks

| ID | Task | Status | Est | Use | Notes |
|---|---|---|---|---|---|
| A93 | Parking lot missing for a stop (Tunnel Arch) | blocked | 30 min | Medium | Waiting for which stop and whether it appears after a reload |
| FINAL | Opus full check, merge, push, Vercel+CI | pending | 30 min | Heavy | push waits for "push" |

## Standing rules for this project (confirmed by the human partner)

- **Model allocation (updated 2026-10-07 by the human partner):** every
  implementer and every regular (per-task and scoped re-) review runs on
  **Sonnet**. Every *final* review runs on **Opus**: the final whole-branch
  review and the final bug and security passes. (This replaces the earlier
  "Sonnet only" rule; planning is also Opus.)
- **Extra reviews requested beyond the skill's default process:** after all
  24 tasks are complete and the final whole-branch review is clean, dispatch
  two additional subagents (both Opus, both read-only against
  the finished diff; one at a time, see the global rules 14-15 in `~/.claude/CLAUDE.md`): one hunting for bugs, one for security issues. These
  are in addition to, not instead of, the per-task reviews and the final
  whole-branch review the skill already runs.
- The D1-D9 open decisions table in the plan was presented to the human
  partner and not objected to — treat all nine defaults as confirmed, not
  as still-open questions.
- Keep `docs/archive/PROGRESS.md` (project root, both checkouts conceptually share one
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

## Claude Code setup (exact, as of 2026-10-19; this section wins over older text below)

Everything a new machine needs so a fresh Claude Code session behaves like this one. Secrets are never listed here.

**User settings** (`~/.claude/settings.json`): `model: opusplan` (Opus plans, Sonnet executes); `permissions.defaultMode: auto`;
`modelSettings` `autoCompactWindow: 200000` for `claude-opus-5-5` and `claude-sonnet-5-5`; theme dark; editor mode normal;
`inputNeededNotifEnabled` and `agentPushNotifEnabled` true; status line runs `~/.claude/statusline.sh`.

**Plugins enabled** (all from `anthropic-plugin-directory`): `superpowers` (installed 6.4.2), `playwright`, `frontend-design`.
The older `superpowers-marketplace` and `tdd-guard` plugin entries below are history: tdd-guard is disabled (see "Standing rules"),
and `.claude/tdd-guard/data/config.json` holds `{"guardEnabled":false}`.

**Project-local, NOT in git** (`.claude/` is gitignored, so recreate on a new machine):
- `.claude/settings.local.json`: allows `Bash(npm run *)`.
- `.claude/skills/`: `audit-context-building`, `codeql`, `differential-review`, `fp-check`, `frontend-design`, `sarif-parsing`,
  `semgrep`, `sharp-edges`, `supply-chain-risk-auditor`, `variant-analysis` (security-review helpers; copy from the old machine).
- `.env`, `.env.local` (gitignored). Names: see `.env.example` (it lists every variable, required and optional).

**In git:** `CLAUDE.md` (push-and-deploy check), `AGENTS.md` (read `node_modules/next/dist/docs/` before Next code), this file.

**Memory** lives outside the repo at `~/.claude/projects/-Users-genestone/memory/` (not in git). Its rules, restated so they survive a new machine:
- "push" means push to `main` of `gene500/Photo-App`; never push other branches. Run tests/typecheck first and report failures.
- After every push, check Vercel (`photo-app-pi2o` only; `photo-app` is an empty duplicate) with
  `gh api repos/gene500/Photo-App/commits/$SHA/status --jq '.statuses[] | select(.context | test("photo-app-pi2o")) | {state, description, target_url}'`
  plus `gh api repos/gene500/Photo-App/commits/$SHA/check-runs` for CI; poll every 30 s up to 10 min; state both results explicitly. Live site: https://photo-app-pi2o.vercel.app
- Opus for final reviews, full-codebase checks and bug/security sweeps; Sonnet for implementers and per-task reviews. Always pass `model` explicitly.
- Task list: owner work items, then bug sweeps (H rows), then the FINAL row (combined: full codebase check on Opus, handle findings, merge, push to `main`,
  confirm Vercel and CI). Completed or removed rows move to the Archive. End every reply with the task table (open tasks).

**Working rules from the owner:** subagents run one at a time. Before a batch, check which tasks could run in parallel and ask first; never run parallel without a yes; set an explicit subagent `effort` only if asked;
never print or commit the Mapbox `pk.` token; use they/them for anyone whose pronouns are unstated; do not start new work when the owner says only
to add tasks. Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AFkQpJYJ3ScjJ2DzP3AKkA`.

**Tools:** Node v25.9, `gh` 2.100 (must be logged in with access to `gene500/Photo-App`), Playwright with chromium only (no Safari/WebKit locally), Mapbox GL, Vitest.

## Skills/plugins this workflow depends on

This machine has these installed via Claude Code's plugin system
(`~/.claude/plugins/installed_plugins.json`). A different device needs
the first two installed before resuming — the rest of this workflow
assumes their skills exist:

- **`superpowers`** (now enabled as `superpowers@anthropic-plugin-directory`, 6.4.2; formerly `superpowers-marketplace` 6.3.0) — required. Provides every
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
  NO LONGER REQUIRED: disabled, see "Claude Code setup" above. Originally required for the workflow to behave as the plan assumed. This is
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
