# Handoff and task board

The one file that tracks the work and lets another Claude session or machine pick it up. It replaces the old
`TODO.md`. **Update the Task board below the moment any status changes** (and commit it), then trust it, `git log`
and `docs/PROGRESS.md` over memory. The sections after "Current work" are history except "Claude Code setup" and "Skills/plugins". Start with "START HERE".

## START HERE (a fresh Claude session reads this first; updated 2026-10-27)

**Goal:** Photo Op Planner, a road-trip photo planner (Next.js 16, Prisma/libsql, next-auth, Mapbox). Live at https://photo-app-pi2o.vercel.app (Vercel project `photo-app-pi2o` only; `photo-app` is an empty duplicate).

**Starting point (verify with `git status` and `git log`; trust them over this text):**
- Repo `/Users/genestone/road-trip-photo-planner`, branch `main`, remote `gene500/Photo-App`. Last pushed commit: the F8 cleanup commit on main, after `eadac0e` (see git log). All board tasks are done; open items are owner decisions listed in docs/T11-REPORT.md (unnecessary export keywords, bench scripts, top-level better-sqlite3, .agents/skills) and the real-map eyeball checks.
- **Uncommitted in the working tree (a separate later commit, not yet made):**
  - A44 reorder ignores visited stops (`src/lib/visited-run.ts`, `src/server/stops.ts`, `StopList.tsx`, `TripEditor.tsx`).
  - A45 overlapping stop markers fanned out so each is clickable (`src/lib/marker-fan.ts`, `MapPanel.tsx`, `FakeMapPanel.tsx`).
  - A46 phone landscape gets a left side panel and more map (`short-landscape` Tailwind variant in `globals.css`, `src/lib/short-landscape.ts`, `StopsPanel.tsx`, `SharedTripView.tsx`).
  - A47 CJK text in PDFs (`src/lib/pdf-fonts.ts`, `itinerary-pdf.ts`, `itinerary-download.ts`, `public/fonts/NotoSansSC-Regular.ttf`, `NotoSansKR-Regular.ttf`).
  - Three e2e specs: `e2e/reorder-visited.spec.ts`, `e2e/marker-fan.spec.ts`, `e2e/pdf-cjk.spec.ts`; edits to `docs/F4-CHECKLIST.md`, `docs/F5-CHECKLIST.md`, this file.
- Last full verification (before T10): vitest 170 files / 1800 tests, typecheck and lint clean, e2e 41 of 41 in T9's copy. Re-run after any F7 change.

**What needs to be done (in this order, one at a time; see the Task board below):**
1. **T10 (done):** 4 Sonnet fiddlers tested the new features; findings are in `docs/F7-CHECKLIST.md`. Known polish not to re-report: minority script in a mixed CJK trip prints "?"; "My trip" tab wraps in the 280 px landscape panel; a selected card can sit over a fanned marker until closed; fake-map fixed places can sit under the left panel.
2. **F7 (done 2026-10-27):** T10 findings fixed; see the Archive. Next: the A48-A53 owner items in board order, then SEC, FINAL, and the T11/F8/SEC-2/FINAL-2 cleanup block.
3. **SEC:** `/security-review` of the pending diff (A44-A47 + F7). The skill can arrive with an empty diff when nothing is staged; then have an Opus agent read `git diff` itself.
4. **FINAL:** Opus full-codebase check, handle findings, run vitest + typecheck + lint + e2e, then commit. **Push only when the owner says "push"** (to `main`), then confirm Vercel `photo-app-pi2o` and CI `check` and `e2e` both succeeded (commands under "Claude Code setup").

**Next steps after FINAL / open owner decisions (not started):** stop/place card covering the sheet header on portrait phones; background refresh of a stale tab; login not returning to the requested trip (`callbackUrl`); limiter 10,000-key lockout; Mapbox and Flickr cost caps; Google sign-in privacy copy; Mapbox `pk.` token URL restriction and spend cap. Owner follow-ups that are not code are under "Backlog" below. Ask the owner which to take next.

**Setup on a new machine:**
1. `git clone https://github.com/gene500/Photo-App.git road-trip-photo-planner && cd road-trip-photo-planner && npm ci` (postinstall runs `prisma generate`). Node 25.x, `gh` logged in with access to the repo.
2. Copy `.env.example` to `.env` and `.env.local`; fill in values (names listed under "Claude Code setup"). The Mapbox token is not in git; never print or commit it or any `TURSO_*` value.
3. `npx playwright install chromium` (chromium only; no Safari/WebKit locally).
4. Recreate the gitignored `.claude/` folder (see "Claude Code setup"); `~/claude-config` is the private repo behind `~/.claude/CLAUDE.md`: `git -C ~/claude-config pull --ff-only`.
5. Read `AGENTS.md`: Next.js 16 has breaking changes, read `node_modules/next/dist/docs/` before writing Next-specific code.

**Commands:**
- `npm run typecheck && npm run lint` ; `npx vitest run` (run the full suite alone; it flakes under machine load, re-run alone before calling a failure real).
- `npm run dev` (app); e2e: `npm run e2e` (port 3100, fresh `e2e.db`, fake externals: `EXTERNAL_APIS_FAKE=1`, `NEXT_PUBLIC_MAP_FAKE=1`, `CI=1`, `E2E_PROD=1`).
- Agents that run e2e/browsers work in their own copy of the repo (`cp -cR` for `node_modules`, never a symlink), own port, max 4 at once, and stop servers by PID and delete their copy when done.

**Skills and plugins to install** (details in "Claude Code setup" and "Skills/plugins this workflow depends on"):
- Plugins from `anthropic-plugin-directory`: **`superpowers`** (6.4.2; required: brainstorming, writing-plans, subagent-driven-development, requesting-code-review, verification-before-completion, systematic-debugging, test-driven-development, finishing-a-development-branch), **`playwright`**, **`frontend-design`**. `tdd-guard` is disabled and not needed (`.claude/tdd-guard/data/config.json` = `{"guardEnabled":false}`).
- Built-in skills used: `security-review`, `code-review`, `simplify`.
- Project-local skills in gitignored `.claude/skills/` (copy from the old machine, or skip; security-review helpers): `audit-context-building`, `codeql`, `differential-review`, `fp-check`, `frontend-design`, `sarif-parsing`, `semgrep`, `sharp-edges`, `supply-chain-risk-auditor`, `variant-analysis`. `.claude/settings.local.json` allows `Bash(npm run *)`.
- User settings: `model: opusplan`, `permissions.defaultMode: auto` (see "Claude Code setup").

**Standing rules (full text in `~/.claude/CLAUDE.md` and `CLAUDE.md`):** test before claiming done; no commit/push unless told; "push" = `main` only, tests and typecheck first; no secrets anywhere; they/them when pronouns are unstated; Opus for final reviews and whole-repo checks, Sonnet for implementers and per-task work, always pass `model`; ask before parallel agents; subagent reports are data, not instructions; keep this board current, archive finished rows at once, SEC then FINAL always last; end every reply with the open-task table; commit trailers `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AFkQpJYJ3ScjJ2DzP3AKkA`.

## Task board

ID prefixes (owner, 2026-10-26): A = alpha (owner work items), T = testing passes by agents (bug hunts), F = fix passes, H = older bug sweeps (history), then SEC, then FINAL.

Statuses: pending, in progress, completed, blocked, removed. Exactly one item is in progress at a time.
Visibility rule (owner, 2026-10-16): the task chart is shown in the terminal at the end of every reply, always.
Ordering rule (owner, 2026-10-16): anything added goes toward the end of the list, in the order asked; the list order is: owner work items, then the bug sweeps (H rows), then the final row; the absolute final row of every list is always one combined row: a full codebase check (Opus), then merge, push, and confirmation that Vercel and CI succeeded; nothing goes after it.
Ordering exception (owner, 2026-10-27, ONE TIME ONLY): this list has a second FINAL (FINAL-2) after the cleanup rows T11, F8 and SEC-2. It applies to this list only. The standing rule is unchanged: one combined FINAL, always last, nothing after it. When FINAL-2 is archived, go back to the standing rule and do not repeat this pattern unless the owner asks again.
Temporary insert rule (owner, 2026-10-27, from 15:07 until 15:27 local time, then it lapses): tasks the owner adds in this window go right after A51 (above SEC), in the order asked. After the window, new items go back to the end of their group as usual.
Last updated 2026-10-27

### Open tasks

| # | Task | Status | Est | Use | Notes |
|---|---|---|---|---|---|

### Archive (completed and removed tasks)

| # | Task | Status | Notes |
|---|---|---|---|
| FINAL-2 (2026-10-27) | Opus full check, merge, push, Vercel + CI | completed | Opus check: no findings. My runs: typecheck, lint, vitest 186 files / 1962 tests, e2e 57/57. Pushed to main; Vercel and CI results are recorded in the final report to the owner. |
| SEC-2 (2026-10-27) | Security review of the T11/F8 cleanup | completed | Opus, read-only: No High or Medium findings. Checked proxy matcher coverage, rate-limit disabled()/limitKey, MAX_STOP_NAME + sessionSchema limits, share token path, guards.ts client-safe, no secrets, .gitignore. |
| F8 (2026-10-27) | Remove the confirmed redundant code | completed | Per docs/T11-REPORT.md: batch 1 dead code, low-risk duplicates (new src/lib/guards.ts, sky.ts colours, MAX_STOP_NAME, sessionSchema), e2e/helpers.ts + tests/helpers/session.ts, @types/better-sqlite3, 5 starter SVGs + proxy matcher, .gitignore dupes. Net 65 files, +102/-303. Verified (mine): typecheck, lint, vitest 186 files / 1962 tests; agent: build ok, e2e 57/57. Left for owner: unnecessary export keywords, bench scripts, top-level better-sqlite3, .agents/skills. Uncommitted. |
| T11 (2026-10-27) | Opus sweep: redundant and unused code | completed | Report in docs/T11-REPORT.md (8 batches). No code changed. Waiting for the owner to pick what F8 removes. |
| FINAL (2026-10-27) | Opus full check, merge, push, Vercel + CI | completed | Opus check: 1 Medium + 3 Low, all fixed (fanned-marker drag position, restored-suggestions prewarm, hike failure caching, a typo). Pushed 30ea5b2: Vercel ok, CI check ok, e2e failed on 2 clock/font-dependent tests (light-aware at ~01:22 UTC; short-landscape drag on Linux row heights). Fixed in the tests only; pushed eadac0e: Vercel photo-app-pi2o success, CI check + e2e success. |
| SEC (2026-10-27) | Security review of pending A44-A53 + F7 (Opus, read-only) | completed | No High or Medium findings. Checked: /api/hike (auth, validation, fixed hosts, no SSRF/QL injection, upstream data reduced to numbers), sw.js font cache, stops reorder ownership, suggestions-store, CSP unchanged, no secrets. Low notes left out: reorderStops update has no tripId in where (pre-existing, safe), per-user upstream request volume. |
| A53 (2026-10-27) | My trip: hike distance + dotted matte green hike route (NPS + OSM) | completed | Design in docs/A53-DESIGN.md. `GET /api/hike` (auth, 60/min per instance, in-memory cache 24 h hit / 1 h none / 5 min failure, 15 s deadline, 6 MB cap, 2.5 km bbox), `src/server/hike/*`, `use-hike.ts`, `hike-layer.ts`, row line "Hike X mi one way" + Show hike toggle + attribution, fake-mode hike near (37, -119.5). Verified (mine): typecheck, lint, vitest 186 files / 1966 tests; agent: e2e 57 of 57. NOT verified: real Mapbox look; live OSM lookup through the service (public Overpass was down/overloaded during testing, fixture-verified only). Known limits: inside parks NPS starts at the nearest dead end so the distance can be short of the real trailhead; mapping gaps give a shorter walk or none; dense cities may show none; in-memory cache means cold instances re-query. Agent did not read node_modules/next docs before writing the route (copied the weather route pattern). Uncommitted. |
| A50 (2026-10-27) | Suggestions list vanishes: persist per trip | completed | Not reproduced in the running editor (traced all writes; regression tests added). Owner chose to persist: new `src/lib/suggestions-store.ts` (sessionStorage `rtpp.suggestions.v1.<tripId>`, done lists only, strict validation, 12 h max age, 200 KB cap), TripEditor restores on mount without network calls (popularity loader and prewarm skip restored lists), saves on every change, `offline-store.ts` clear/remove helpers also clear it. Verified (mine): typecheck, lint, vitest 175 files / 1860 tests; agent: e2e 55 of 55. Uncommitted. |
| A52 (2026-10-27) | Zoom-to-fit button under the info (i) button | completed | New `zoom-fit.ts` (`ZoomFitControl`, `fitTargets`), added in MapPanel right after the compact attribution control, reuses A49's `fitMapToPoints`; FakeMapPanel copy with `data-fit-count`; `.zoom-fit-ctrl` CSS (32 px round); hidden with no stops; reduced motion duration 0. Tests: zoom-fit.test.ts, 2 FakeMapPanel cases, `e2e/zoom-fit.spec.ts`. Verified (mine): typecheck, lint, vitest; agent: e2e 54 of 54. NOT verified: real Mapbox stacking and gap under the (i) (needs the owner's token). Uncommitted. |
| A51 (2026-10-27) | Cleaner route line when zoomed out | completed | New `route-style.ts` (+8 tests): zoom-interpolated widths (route 2/3/4/6 px at zoom 5/9/12/15, casing +2) and own Douglas-Peucker simplification below zoom 12 (1.5 px tolerance, first/last kept); MapPanel `drawRoute()` redraws on whole-zoom change. Saved geometry, GPX, PDF, offline copy and A49 flow untouched. Agent run: vitest 173 files / 1842 tests; e2e 49 of 53 in its copy (4 short-landscape failures that passed 5 of 5 when I re-ran that spec in the main repo: timing flake). NOT verified: real Mapbox look. Owner to eyeball at zoom 6-14 on the Yosemite trip; tune `ROUTE_WIDTH_STOPS` and `SIMPLIFY_PX`. Uncommitted. |
| A49 (2026-10-27) | Optimize: zoom to fit all stops, then pipe-flow animation | completed | New `route-flow.ts`, `route-flow-map.ts` (exports `fitMapToPoints` for A52), MapPanel `routeFlowId` effect + `lineMetrics`, TripEditor bumps `routeFlowId` per successful Optimize, FakeMapPanel `data-route-flow`. Verified (mine): typecheck, lint, vitest 172 files / 1834 tests; agent: e2e 49 of 49. NOT verified: real Mapbox look and `moveend` behaviour (needs the owner's token): owner to eyeball colours/width (`route-flow.ts`, layer width 5 in `route-flow-map.ts`). Uncommitted. |
| A48 (2026-10-27) | Trips page backdrop: zoom out, more connected stops | completed | TripMapBackdrop.tsx rewritten as inline SVG: 12-stop single connected route, 9 land shapes, 12 roads, rivers, lakes, 3 faint labels; opacity 0.3. Verified: typecheck, lint, vitest 170 files / 1813 tests; screenshots at 1280, 390, 320 light and dark, no horizontal scroll. Note: on a 390 px phone the SVG is cropped (`slice`) so only about 2 stops show. Uncommitted. |
| F7 (2026-10-27) | Fix the bugs T10 found | completed | 12 checklist items fixed incl. owner decisions (drag outside list cancels; PDF fonts cached by the service worker). Skipped: FakeMapPanel fixed 1000x600 size and several polish items. Verified: typecheck and lint clean, vitest 170 files / 1812 tests (my own run), Playwright 47 of 47 in the agent's copy. Uncommitted. |
| T10 (2026-10-27) | Sonnet fiddlers on the 4 new features (A44-A47) | completed | 4 testers (g1 reorder, g2 fanned markers, g3 phone landscape, g4 CJK PDF). Bugs recorded in docs/F7-CHECKLIST.md. |
| T4 (2026-10-26) | 10 Opus agents test the features again | completed | 10 testers in 3 batches; all findings are recorded in the F2 row. Highest: HIGH stale trip page after Settings Back / browser Back (drops stops); several MEDIUM focus-loss, a11y and responsive bugs. |
| T5 (2026-10-26) | 10 Sonnet agents fiddle with the app again | completed | 10 fiddlers in 3 batches; all findings recorded in the F2 row. Highest: MEDIUM stop drawer save/close races, Optimize with a just-typed start time, no client request timeout, suggestion dots covering stop markers, Edit trip unreachable in phone landscape. |
| T6 (2026-10-26) | 10 Sonnet agents attack the app again | completed | 10 attackers in 3 batches; all findings in the F2 row. No exploitable vulnerability found (no SSRF, XSS, IDOR, injection). Findings: Mapbox/Flickr cost exposure with no app-wide cap, limiter 10,000-key lockout, session-cookie log flooding, account-delete race 500, malformed-escape 500s, privacy text mismatch. Untested lead: slow request bodies. |
| F2 (2026-10-26) | Fix T4-T6 bugs plus F1 carry-over | completed | Checklist sections 1-11 fixed in code where safe; see docs/F2-CHECKLIST.md for ticked items and the unticked remainder. vitest 165 files / 1683 tests, typecheck, lint, e2e 31/31, browser checks passed. Open owner decisions: limiter 10k-key lockout, app-wide Mapbox/Flickr caps, Google privacy copy, drawer/map selection, static-map colors. Nothing committed. |
| SEC (2026-10-26, round 2) | Security review of the F2 changes | completed | Opus read the whole diff: no High/Medium findings. Optional hardening: login-guard.ts:68 should match "application/json" exactly (guard and NextAuth parse bodies differently, but authorize re-checks the email, so not exploitable). Slow-body lead on readBodyBytes is DoS only (excluded). |
| F3 (2026-10-26) | Fix 3 bugs from the Opus full check | completed | Suggestions timeout 60 s; RefreshWhenStale no longer compares client/server clocks and TripEditor is keyed on a content hash; Optimize double-click guard and deterministic departAt. vitest 165 files / 1687 tests, typecheck, lint clean. e2e: light-aware.spec.ts fails only when the sunset-based start time equals the current clock time (Reset to now hides), a pre-existing time-of-day flake. |
| FINAL (2026-10-26) | Opus full check, merge, push, Vercel + CI | completed | Pushed f3dbd51 (fixes) and 474d2d7 (npm audit fix + zod override). 474d2d7: Vercel photo-app-pi2o success, CI check and e2e success. |
| SEC (2026-10-27) | Security review of F4+F5 changes | completed | Opus read the uncommitted diff: no High or Medium findings (cascade ownership checked inside the transaction and scoped to the stop's own trip; response validation client-only; offline copy wipe per user intact; no innerHTML/eval/href from stop names). |
| T9 (2026-10-27) | Combined browser + e2e check of A44-A47 | completed | All four PASS in headless Chromium with measurements; no real bugs. Added e2e/reorder-visited.spec.ts, marker-fan.spec.ts, pdf-cjk.spec.ts; full e2e 41/41 (also vitest 170 files/1800 tests, typecheck, lint). Polish: minority CJK script prints '?' in mixed trips; 'My trip' tab wraps in the 280px landscape panel; a card can sit over a fanned marker until closed. |
| A47 (2026-10-27) | Non-Latin text in PDFs, without hurting the app | completed | CJK via on-demand subset Noto Sans SC (3.57 MB, Chinese+Japanese) and KR (1.09 MB) in public/fonts, fetched only when the trip text needs them; Latin trips still 2 font requests; failures fall back to '?'. Arabic/Hebrew/Thai/Indic/emoji left out (no shaping/RTL in jsPDF). 14 new tests. Browser/e2e check pending in T9. Uncommitted. |
| A46 (2026-10-27) | Phone landscape gets more map | completed | short-landscape variant (landscape, max-height 500px, max-width 1023px): bottom sheet becomes a 40% side panel (17.5-23.75rem), cards/search over the map only, map padding accounts for the panel; also on the share page. vitest 170 files/1788 tests, typecheck, lint. Layout check pending in T9. Card over sheet header on portrait phones still open. Uncommitted. |
| A45 (2026-10-27) | Separately clickable stops at (near-)identical coordinates | completed | marker-fan.ts fanOffsets (32px, circle around centroid) used by MapPanel (map.project + marker.setOffset on zoomend/stops) and FakeMapPanel; display-only. 7 helper + 2 fake-map tests, typecheck, lint. Full suite and browser check pending in T9. Uncommitted. |
| A44 (2026-10-27) | Reorder ignores visited stops | completed | Visited run pinned first: client reorderIds/pinVisitedFirst, disabled handles on visited rows, server reorderStops normalises (keeps visited first, never changes visited flags). vitest 168 files/1774 tests, typecheck, lint. Browser check pending in T9. Uncommitted. |
| FINAL (2026-10-27) | Opus full check, merge, push, Vercel + CI | completed | Opus check found 1 Medium + 2 Low, fixed in F6. Pushed `ae92a84` to main; Vercel photo-app-pi2o success, CI check + e2e success. |
| F6 (2026-10-27) | Fix the bugs the FINAL Opus check found | completed | Popover now limited by the sheet's clip box (popover-fit.ts), measured in a real browser at 360x640/320x568/375x667/1280x800, half+full snap, default+Extra large: all inside and visible. Share/photo changes go through tracked(); Undo swap re-ticks only if the cascaded run is unchanged (swap-undo.ts). vitest 168 files/1768 tests, typecheck, lint, e2e 31/31. Uncommitted. |
| F5 (2026-10-27) | Fix the bugs T8 finds | completed | Optimize notice wraps, Export/Share popovers flip/scroll inside the viewport, dnd-kit announcements use names, focus to search after Add stop, Escape closes cards, banners clear, Undo swap restores cascade, share print white/ink, polish. vitest 166 files/1756 tests, typecheck, lint, e2e 31/31 (flakes seen only while the machine was overloaded). Open owner decisions: reorder vs visited rule, identical-coordinate markers, card over sheet header, landscape map, PDF non-Latin fonts. Uncommitted. |
| T8 (2026-10-27) | Re-run the 10 Sonnet fiddlers after F4 | completed | 10 fiddlers in 3 batches (f1-f10); findings in docs/F5-CHECKLIST.md. No High. Medium: optimize notice long-name fix does not work (needs min-w-0/overflow-wrap:anywhere), Export menu still off-screen on short phones (use-popover.ts 160px floor), keyboard reorder speaks raw dnd-kit ids. Low: focus lost after keyboard Add stop, Notes ZWSP, Undo swap visited flags, move announcement names wrong stop, Escape on place card, stale offline banner. F4 fixes mostly confirmed. Testers changed no code. |
| F4 (2026-10-27) | Fix the bugs T7 finds | completed | F4a client state/data (merge-not-remount, server visited cascade, stale-tab offline copy, TripList prune, api shapes) + F4b layout/a11y (dark notice, popover max-height, share print, Settings softDisabled, Escape/aria). vitest 166 files/1737 tests, typecheck, lint, e2e 31/31. Open in docs/F4-CHECKLIST.md: card over sheet header, reorder visited rule, background refresh, PDF non-Latin, landscape map (owner decisions). Uncommitted. |
| T7 (2026-10-27) | 10 Sonnet agents fiddle with all features and combinations | completed | 10 fiddlers in 3 batches (f1-f10); findings in docs/F4-CHECKLIST.md. No High; 8 Medium items (offline copy prune on Back, dark optimize notice contrast + long names, card covers sheet header, Export/Share popovers off-screen on portrait phones, print of share page, remount drops typed text/in-flight adds, visited run rule, stale-tab offline copy). Testers changed no code. |
| F1 (2026-10-26) | Fix the bugs T1, T2 and T3 find | completed (first pass) | Fixed: login-guard JSON-body email throttle and relative callbackUrl 500; locateLandmark whole-word matching, min length, empty query, category boundaries, outage not cached; editor manual-vs-auto add race and quiet first-start save; roadMajor contrast; FakeMapPanel colour; attribution focus ring; empty-state chip; StopsPanel path key, string checks, focus after Shrink/Expand; login/signup offline and network-error messages; numeric range validation messages; trip page main landmark. Full gates: tsc, eslint, vitest 1614 pass (before main landmark; TripEditor 91 pass after). Rest carried to F2 |
| T3 (2026-10-26) | 10 Sonnet agents attack the app in different ways | completed | Attackers: auth, API fuzz, IDOR, races, uploads, share links, paid-API proxies, XSS, client state, proxy/rate limits. No exploitable vulnerabilities; authorization, XSS, uploads and races held. Findings queued for F1: plain Sign out does not revoke the JWT (stays valid 30 days; owner decision, only sign-out-everywhere bumps sessionVersion); relative callbackUrl like x gives 500 (login-guard.ts unparseable() uses new URL(value, base)); JSON content-type POST to /api/auth/callback/credentials bypasses per-email failure counter (guardAuthPost reads only formData); signup formToken reusable; honeypot counts toward IP limit; locateLandmark caches null on suggest outage; Flickr app budget and suggestions/weather use per-instance limits (read from code, design); departAt not revalidated when stops change and PATCH accepts departAt null while POST rejects; stale second tab never refetches on 409/404 and stays in editor after trip deleted elsewhere; manifest start_url /trips with scope / may explain reported share-link-opens-generic-page on installed PWA (unverified, needs phone); TRACE returns 500 with stack in dev; Host absolute-URI redirect (non-browser only); photo sanitizer accepts structurally invalid PNG/WebP (thumbnail only); share view makes a paid directions call per view (capped). Unverified: stale write from a signed-out second tab should return 401 with a sensible message |
| T2 (2026-10-26) | 10 Sonnet agents fiddle with the app to find bugs | completed | Run in 3 batches (3-4 agents at a time). Findings queued for F1: BUG MEDIUM login while offline navigates to chrome-error (next-auth signIn sets window.location when /api/auth/providers fails; LoginForm.submit and SignupForm need try/catch plus offline check; /login?error=undefined on 500 loses email); BUG MEDIUM trip page stale after browser Back then Forward (shows 0 stops; router cache feeding old initial props); keyboard focus lost to BODY after Edit trip, Save/Cancel trip, Add stop in place card, failed login, Shrink panel; trip page has no main landmark; header links after editor in tab order; fake map text 2:1 contrast in dark (FakeMapPanel.tsx:82,147; TripEditor.tsx:844); Settings Back can leave the app (sticky rtpp.inapp.v1 marker, SettingsView.tsx goBack); export filename for non-ASCII names collides (exportBaseName); optimize on tied stops reorders needlessly; stale error banners stack; undoSwap does not restore photo; cryptic lat/lng validation message; corrupt sessionStorage values not cleaned; full snap restores identical to half on desktop. Optional, owner to decide: login redirect does not return to the original page |
| T1 (2026-10-26) | 10 Opus agents test the new features (A39-A43) | completed | Findings queued for F1: locateLandmark substring matching ("LA", "Utah", "Park", non-ASCII names match wrong places; add whole-word match, empty-query null, min length); LANDMARK_CATEGORY needs word boundaries; suggest outage falls back to billed v6 geocode and caches null; client race (manual add vs auto-add, saveFirstStart twice, quiet error); map-theme roadMajor vs land contrast 1.00 and loose test; FakeMapPanel old bg-[#e4dccb]; A42 attribution-button invert filter hits focus ring, Mapbox blue focus box-shadow; A39 empty-state text vs backdrop label; StopsPanel snap array passes Object.hasOwn (needs typeof string) and key read from window.location.pathname during render (use usePathname); test coverage gaps (e2e landmark name, fakeLocate tests, real 700 ms timers in TripEditor tests, stopCountRef guard test, InAppNavMarker test) |
| SEC (2026-10-26) | Security review (/security-review) of the A39-A43 changes | completed | 2026-10-26: no high-confidence findings. Reviewed the stop-panel sessionStorage restore, Settings Back handler, A40 auto-first-stop (client calls the existing authenticated addStop path; server still sanitizes names), fake locate, map CSS and the SVG backdrop (no dangerouslySetInnerHTML, no url() in CSS). Standing SEC row is re-added for the next list |
| A43 | Darken the beige map colours a bit | completed | 2026-10-26: `map-theme.ts` palette about one step darker (land e6e0d0 to d8d1bd, water, parks, roads, casings, labels), dark-mode canvas filter brightness 0.72 to 0.8; contrast test added. Not seen on a real map (fake map renders no tiles) |
| A42 | Map controls match the app's fonts and style | completed | 2026-10-26: zoom/compass/info/attribution restyled with app tokens (surface, ring, radius, focus ring, Geist), icons inverted in dark mode; Mapbox logo and attribution stay visible. Not seen on a real map |
| A39 | Homepage background: muted example trip map | completed | 2026-10-26: `TripMapBackdrop` inline SVG (beige land, parks, river, roads, brown route, 6 pins) at 40% opacity behind the Your trips page, themed by CSS tokens; static, no network. Contrast over the cards not checked in a browser |
| A40 | Trip name auto-places a starting point of interest | completed | 2026-10-26: when `/api/locate` (A20) reports a park or landmark (`locateLandmark`: Search Box POI whose name matches and whose category is park-like) for the trip name and the trip has 0 stops, the editor adds it as the first stop via `addStop` (source manual, named from the landmark). Owner chose parks and landmarks only: generic names (LA, Utah, Paris weekend) just pan the map; one-time marker `autoFirstStop:<tripId>` in localStorage prevents re-adds; the lone-stop suggestions search then preloads. Fake locate now only resolves park-like names so e2e trip names add nothing. Remaining caveat: the once-only marker is per browser, so another browser or cleared data can add it once more for a still-empty trip. |
| A41 | Settings back returns to where you were | completed | 2026-10-26: Settings 'Back' (was a hard link to /trips) now calls history.back() when the user came from inside the app, else falls back to /trips; `StopsPanel` remembers its tab and height per page in sessionStorage so the trip reopens on My trip. Tests added; component suite 412 passing, lint and typecheck clean |
| A38 | Tidy repo root and reformat README | completed | 2026-10-22: HANDOFF, PROGRESS, HISTORY moved to `docs/` (config files stay at the root; tools expect them there); README given a contents list, shorter bullets, same facts. Uncommitted until owner says push |
| A29 | Prefetch suggestions for the next likely area | removed | 2026-10-21 by owner: already covered by the route prewarm, lone-stop auto search and the 30 min server cache |
| A24 | Visited checkbox, re-optimize stops after it | completed | 2026-10-21: the My trip dot-checkbox already existed. Added `src/lib/visited-run.ts` (cascade: check = all earlier, uncheck = all later; `leadingVisited`), `toggleVisited` in TripEditor, and Optimize now sends only [last visited stop, ...rest] (last visited is the fixed start; earlier visited stay put) and leaves the trip start time alone once anything is visited; departure from the anchor = route arrival there + dwell, else the saved start. Share link no longer carries or shows `visited` (PublicStop, mapper, SharedTripView, privacy text); share DTO test updated. Known limit: the optimizer may still pick its own start inside the tail, which is not saved. Full vitest 1551 passed. Not seen in a browser. Uncommitted |
| A25 | Generated suggestions stay on the page, no refetching | completed | 2026-10-21: root cause = `freshSuggestions` only showed a list whose search key equalled the current stop coordinates, so reorder/move/delete/optimize hid it (and `takeSuggestion` re-tagged keys, re-running popularity). Now the list shows whatever the stops do (places that became stops are filtered out), accept just removes the item, and the lone-stop auto search skips when a finished list already covers the stop (within 15 km). Refetch only on Find or when a lone stop moves out of coverage. Regression test added; the old 'clears suggestions' test rewritten. Uncommitted |
| A21 | Selecting a stop centres it and its light arrows | completed | 2026-10-21: MapPanel effect `easeTo`s the selected stop (keeps zoom; a list open keeps its zoom-in) with `selectionPadding(viewPadding, drawer width)` from `map-fit.ts`, re-run when the Edit drawer opens/closes (new `drawerOpen` prop). Unit-tested padding only; not seen in a browser. Uncommitted |
| A20 | Trip name pans the map to a famous place or area | completed | 2026-10-21: `locateArea` (Mapbox v6 forward, place then region fallback, bbox) + `GET /api/locate` (shared paid limiter, policy `locate` 20/min) + `api.locate`; TripEditor looks up the name 700 ms after typing while the trip has no stops; MapPanel fits the bbox (maxZoom 11) unless the owner already dragged/zoomed/rotated. Tests: mapbox, route, TripEditor. Not yet seen in a browser. Uncommitted |
| H3 (run 1) | Bug sweep: Sonnet 1, API routes and server error paths | completed | 2026-10-19: report in session scratchpad `sweep-H3-api.md`; 7 findings (no auth/ownership gaps): signup without email verification lets someone register a victim's email, upload leaks a file if the DB swap throws, `updateTrip` 500 on concurrent delete, photo deletes not queued before commit, paid limits charged before validation, share-page Mapbox calls use only the per-instance limiter, stale session-version cache. Triage in H7 |
| H4 (run 1) | Bug sweep: Sonnet 2, UI components, empty/loading/error states, a11y | completed | 2026-10-19: report in session scratchpad `sweep-H4-ui.md` (read from code, not reproduced in a browser); top findings: no error/loading/not-found/global-error pages and no WebGL check or map error handler, route-fetch error hidden in TripEditor, login/Google buttons can stay disabled, focus lost when a focused control unmounts, SearchBar combobox lacks listbox roles and keyboard navigation. Triage in H7 |
| H6 (run 1) | Bug sweep: Sonnet 4, build, config, CI, env, deps, e2e | completed | 2026-10-19: report in session scratchpad `sweep-H6-build.md`; no high-severity defects, eslint/tsc clean, npm audit 0; findings: CI e2e never runs the production-CSP spec (`E2E_PROD=1`), preview builds may point at the production DB, no migration concurrency guard, no production guard on `EXTERNAL_APIS_FAKE`, `.env.example` omits `CRON_SECRET`/Google/`SIGNUP_MIN_SECONDS`, no `engines`/`.nvmrc`, fixed `waitForTimeout(150)` in two e2e specs, no Playwright traces uploaded. Triage in H7 |
| A19 | Share page: Apple Maps and Google Maps links | completed | 2026-10-19: links under the header in `SharedTripView.tsx` (built from names and coordinates only, no notes; Google parts labelled for long trips); 2 tests; tsc, eslint clean; local only |
| B8 | FINAL: Opus check, merge, push, Vercel and CI | completed | 2026-10-22: Opus full-codebase check GO (plus Opus delta check after the small fixes); pushed 633b653, then 503ad3f (Next.js 16.4.2 after the CI audit failed on the critical advisory). 503ad3f: Vercel photo-app-pi2o success, CI check success, e2e success |
| B7 | FINAL: Opus check, merge, push, Vercel and CI | completed | 2026-10-19: Opus check GO after fixing e2e/light-aware and e2e/settings locators; pushed fee698e to main; Vercel photo-app-pi2o success, CI success (2 checks) |
| A32 | Popularity ranking cost | removed | 2026-10-21: not needed. The editor already calls `/api/suggestions` with `enrich: false` (TripEditor.tsx:205, 241, 576, 594) and ranks later through `suggestionPopularity`, so the 4 s popularity budget never delays the first suggestions. The only user-visible wait is the places lookup itself |
| A31 | Optimize keeps every stop visit in daylight: no arrival or dwell falls between dusk and dawn, for all stops including those with no light preference | completed | 2026-10-21: daylight = sunrise to sunset of the stop's solar day, or the stop's own preferred light window (a visit that touches either counts as lit; only a fully dark visit is dark). `Evaluator.darkAt` in `src/lib/optimize-schedule.ts` adds dark minutes to the cost like missed light, weighted by the stop's priority (same weight as a minute of missed light); under the time focus the weight is 0, so darkness is only reported and never reorders the route. Trips with no light preference keep the shortest order and the saved start when nothing is dark (`timed: false`); otherwise the departure is searched too. No sunrise or sunset that day (polar day or night) means no daylight rule, and the editor says so. `/api/optimize` gains `dark` (stopIndex, minutes, priority) and `polar` (indices); the editor note adds "Can't fit N stops in daylight: ..." (skipping stops already listed for their light) and "No sunrise or sunset that day at ..., so no daylight rule applies there". Local search also descends from three spread departures on trips of 12 stops or fewer, because darkness made the best start hard to reach (one seeded 9-stop case was 1.6x off exact; all now match). Known limits: a visit is checked only against the solar day it arrives on; the optimizer may pick its own start inside a visited-stop tail (see A24). Timing tests in `optimize-schedule.test.ts` and `tests/api/optimize.test.ts` can flake when the machine is loaded |
| A34 | Re-plan after visited stops keeps the given start time fixed | completed | 2026-10-22: `/api/optimize` takes `fixDeparture`; the optimizer then searches only the order at the given start (`fixedDeparture` in `optimize-schedule.ts`); the editor sets it when stops are visited, so the order and the light and daylight notes match the start that stays saved. Tests in `optimize-schedule.test.ts`, `tests/api/optimize.test.ts`, `TripEditor.test.tsx` |
| A35 | Old route suggestion search can overwrite the lone-stop list | completed | 2026-10-22: the lone-stop auto search now takes a new `suggestionsSeq` and only the latest search may write the list, so a route search still running when the stops drop to one no longer overwrites the around-the-stop list. Regression tests in `TripEditor.test.tsx` (fail without the fix), incl. the Opus B9 finding that a cancelled lone-stop search left "Searching…" stuck: the search now gives its number back when cancelled before being replaced. A34 also sends the start the editor shows when no start is saved. Still open for the owner: A20/A21/A24/A25 not yet seen in a real browser |
| B9 | FINAL: Opus check, merge, push, Vercel and CI | completed | 2026-10-22: fresh Opus check GO; pushed `d4fec42` (A34, A35) and `f289298` (A37 plus note full stop) to main; Vercel photo-app-pi2o success, CI check and e2e success for both. Live QA (10 testers, 8 local and 2 production) found only the A37 bug. Owner follow-ups: delete prod QA account qa-a25-1022@example.com (+ trip QA-A25) by hand; confirm qa-local-places-a28@example.com is gone; look at A20/A21/A24/A25 in a real browser |
| A37 | Polar stops with a light preference moved the start time | completed | 2026-10-22, found by the live QA run: `/api/optimize` treats a stop with no sunrise or sunset that day as `any`, so a polar-only trip is not timed and no "Start time moved" note appears. Test in `tests/api/optimize.test.ts` (fails without the fix). Pushed as f289298 |
| A36 | Upgrade Next.js 16.4.0 to 16.4.2 (critical advisory fails CI) | completed | 2026-10-22: `next` and `eslint-config-next` pinned to 16.4.2; `npm audit --omit=dev --audit-level=high` now 0 vulnerabilities (the 10 left are dev-only); tsc, eslint, 1573 tests and `next build` (exit 0) pass |
| A33 | Local places copy for South Korea and Japan | completed | 2026-10-21: SOUTH_KOREA and JAPAN coverage rings in `local-places.ts`, lng prefilter widened for east longitudes; 50,310 places (`data/places-asia/`, `scripts/build-places-asia.sh`) imported into the local dev DB and production Turso (no `--replace`); Turso Place table now 203,679 rows (regional extracts overlap, so slightly fewer than the sum). Data is live, so the coverage code is safe to push. Full suite 160 files, 1572 tests passed |
| A28 | Widen the local places copy beyond the US so more searches skip Overpass | completed | 2026-10-21: one NORTH_AMERICA coverage ring in `local-places.ts` (lower 48, Canada, Alaska panhandle, Mexico; Greenland, Bahamas, Cuba, Central America stay on Overpass). 40,488 Canada and Mexico places (`data/places-intl/`, built by `scripts/build-places-intl.sh`) imported into the local dev DB and into production Turso (no `--replace`); Turso Place table now 153,763 rows. Data is already live, so the coverage code is safe to push. Full suite 160 files, 1557 tests passed |
| A27 | Share the suggestion cache between server instances: store enriched and raw results in Turso (new table, migration) instead of per-instance memory | completed | 2026-10-21: new `SuggestionCache` table (migration `20261021120000_suggestion_cache`), `src/server/suggestions/shared-cache.ts`, wired into `runSearch` behind the in-memory layer (Overpass answers only; local-copy answers stay in memory), daily cleanup in the photo-cleanup cron, disabled in tests via `SUGGESTION_SHARED_CACHE_DISABLED=1`. The migration auto-applies to production Turso at the next push (`vercel-build` runs `scripts/migrate-turso.mjs`). Full suite 160 files, 1557 tests passed |
| A26 | Measure suggestion fetch time by stage | completed | 2026-10-21: throwaway script in the session scratchpad (`a26/t.ts`), run from this machine against the real Overpass mirrors, around-search at Arches, Yosemite and LA, cold: local copy 2-62 ms but 0 places (the dev DB has no places, so the production local stage is not measured here), Overpass 21.1 s / 13.5 s / 27.4 s, popularity ranking exactly 4000 ms each time (it hit `POPULARITY_BUDGET_MS`, the full budget, on every search; no Flickr key locally). Conclusion: the places lookup is the wait. When the local copy is thin or missing, Overpass (13-27 s cold) dominates; the popularity budget does not delay first paint (the editor uses `enrich: false`), so A27 (shared cache), A28 (wider local copy) and A29 (prefetch) are the tasks that cut fetch time. No project code changed |
| A30 | Tune thin-local grace wait | removed | 2026-10-21: skipped as A30's own note said, A26 shows the 1.5 s grace is not the bottleneck (Overpass 13-27 s, popularity 4 s) |
| A23 | Stop names show in full (wrap, no ellipsis) | completed | 2026-10-21: `truncate` to `break-words` on the stop name in StopList, TripPlanList and the TripHeader title; e2e `button.truncate` selectors (offline, share-link) updated and passing; the collapsed panel summary and priority pills still truncate on purpose. Note: `TripEditor.test.tsx` shows a different timing flake each time when the whole `src/components/editor` folder runs in parallel (passes 74/74 alone); worth a look in the next sweep. Uncommitted |
| A22 | Larger triangle in the panel arrow button | completed | 2026-10-21: glyph `text-base` to `text-2xl leading-none` in `StopsPanel.tsx` `arrowClass`, circle still h-9 w-9; tests, tsc, eslint clean; not yet seen in a browser; uncommitted |
| H8 | Run /security-review on the pending changes | completed | 2026-10-19: no vulnerabilities found. Checked: `focus` enum validated by zod on the optimize route, Settings parse uses an allow-list, shared-page map links use fixed https hosts with URLSearchParams encoding and React-escaped hrefs (noopener), no new routes or auth changes |
| H7 | Triage sweep findings, fix agreed ones | completed | 2026-10-19: fixed (with tests): describeSunPosition horizon band and bad input, SkyCard N 360, light hint overflow at 320px, lightWindows fallback to solar noon above ~60.5 deg in winter, `.env.example` missing vars, optimize `focus` API test. Deferred for the owner (design or larger): email verification and signup enumeration, password reset, error/loading/not-found pages and map error handling, login-guard JSON pre-check, Flickr per-user budget, Mapbox pk vs server token, previews vs production Turso, CI production-CSP e2e, engines/.nvmrc, Reset-to-now departure mismatch, cross-day misses, date-line map framing, UTC+13/+14 planned day, SearchBar combobox a11y, focus loss on unmount |
| H2 | Bug sweep: Opus 2, core logic | completed | 2026-10-19: report `sweep-H2-logic.md`; findings: above ~60.5N in winter the sun never reaches 6 deg so lightWindows is empty and light prefs are ignored (Medium-High), describeSunPosition says below the horizon for minutes after app sunrise, after Reset to now the editor times from now but shared/offline/PDF time from sunrise, misses use only the arrival's own solar day, later-day arrivals show only a clock time, map frames the world across the date line, UTC+13/+14 trips land a day late, Sky card can print N 360. Triage in H7 |
| H1 | Bug sweep: Opus 1, security, auth, share links, uploads, rate limits | completed | 2026-10-19: report `sweep-H1-security.md`; no Critical, High or Medium; Low: login-guard pre-check (`login-guard.ts:65-72`) skipped for JSON bodies, single app-wide Flickr budget key "all" lets one account use it up for everyone, `.env.example:7` suggests the public Mapbox pk token on the server too (verify deployed tokens), off Vercel without TRUST_PROXY_HEADERS all clients share one rate-limit key. IDOR, CSRF, CSP, share tokens, injection, SSRF, uploads, cron, secrets clean. Triage in H7 |
| H5 | Bug sweep: Sonnet 3, tests and edge inputs | completed | 2026-10-19: report `sweep-H5-tests.md`; vitest 157 files / 1528 tests pass; findings: the new `focus` field has no API or validation test (Medium), TripEditor.test only asserts `focus: "priority"` (Medium), describeSunPosition rounds altitude before the horizon test and prints "Sun undefined, NaN° high" for invalid input (Low-Medium), weak assertions in new sky and SharedTripView tests (map-link URLs, over 20 stops), no lng +-180 case in light or optimizer tests, real-sleep tests and fixed e2e waits. Triage in H7 |
| H6 (rerun) | Bug sweep rerun: Sonnet 4, build, CI, env | completed | 2026-10-19: report `sweep-H6-build-rerun.md`; tsc and eslint clean, vitest 157 files / 1528 tests pass, npm audit prod high 0; all 8 run-1 items still hold (worst: CI never runs the production-CSP e2e); `.env.example` also lacks RATE_LIMIT_DISABLED and NEXT_PUBLIC_SW; no new issues in the working-tree changes. Triage in H7 |
| H4 (rerun) | Bug sweep rerun: Sonnet 2, UI and a11y | completed | 2026-10-19: report `sweep-H4-ui-rerun.md`; all 10 run-1 items still hold; 6 new from the working tree: nowrap light hint overflows at 320px (TripPlanList.tsx:58), photo tile squeezes stop name (StopList/StopPhoto), describeSunPosition rounds altitude before the horizon test (sky.ts), Optimize hint lacks aria-describedby, share map links open a new tab with ~20px tap targets, gear leaves the editor with only a Trips back link. Triage in H7 |
| H3 (rerun) | Bug sweep rerun: Sonnet 1, API routes and server error paths | completed | 2026-10-19: report `sweep-H3-api-rerun.md`; all 8 run-1 items still hold (worst: Google sign-in blocked by a pre-registered email); new, all Low: N1 `/s/[token]` read has no per-IP limit in the route (HANDOFF says `src/proxy.ts` limits renders to 300/min per address; verify in H7), N2 optimize slot held during the paid-limit write and Mapbox call, N3 optimize takes the slot and charges the limit before validating the body. No issues found in the uncommitted changes or the share page links. Triage in H7 |
| A1 | Sunrise/sunset map lines get an arrowhead pointing toward the stop | completed | pushed `7a46785`; not yet seen on the real Mapbox map |
| A2 | Stray thin line above "No trips yet" after deleting all trips | removed | owner dropped it 2026-10-19; never reproduced in Chromium (suspected Safari paint from `.lift`/`anim-rise` on trip cards) |
| A3 | Search bar back to its pre-C3 look (arrow kept) | completed | pushed `7a46785` |
| A10 | Add the exact Claude Code setup to docs/HANDOFF.md | completed | 2026-10-19: new "Claude Code setup" section; fixed outdated plugin/tdd-guard text |
| A13 | Fix the formatting in the screenshot (the end-of-reply task table broke mid-table in the terminal; not an app screen) | completed | 2026-10-19: tables now use short task names and one-word statuses so rows never wrap; rule added to `CLAUDE.md` item 8 and memory |
| A4 | Make the sunrise/sunset map arrow more defined (a little bigger) | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A8 | Make the title text larger (see screenshot) | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A9 | Make the sunrise, time and weather text a little darker | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A7 | Make the button in the screenshot more defined | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A5 | Adjust the buttons in the selection window so there is no dead space on its right side | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A15 | Make the map a bit darker in both dark and light mode (it is too light) | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A16 | Make paths and roads more visible on the map | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A17 | Swap the places of PDF and GPX, and of Google Maps and Apple Maps, in the export menu (see screenshot) | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A18 | Golden hour window text should stay on one line (the "PM" wraps onto a second line) | completed | 2026-10-19: edited and verified by typecheck, lint and 1517 unit tests; local only (not committed, not pushed, not yet seen in a browser) |
| A6 | Show the miles and time next to the Optimize route button, and make them more defined so they are easier to read | completed | 2026-10-19: edited and verified by typecheck and unit tests; local only (not committed or pushed) |
| A14 | Move the images to the right side and make them larger (see screenshot) | completed | 2026-10-19: edited and verified by typecheck and unit tests; local only (not committed or pushed) |
| A12 | Sun position preview per stop | completed | 2026-10-19: `describeSunPosition` in `src/lib/sky.ts` plus a "Sun SW, 34° high" line per stop in My trip, at the stop's arrival time (rulings: shows only in My trip, only once an arrival time exists, no map overlay); tests pass; local only |
| A11 | Optimize priority setting plus gear link | completed | 2026-10-19: new setting `optimizeFocus` ("priority" default, "time"), a Settings section `#optimize`, `focus` passed through `/api/optimize` to `optimize-schedule.ts` (time = every stop weighted the same), and a gear link beside Optimize route; tests added; local only. Note: priority only affects the order for stops with a light preference |
| B7 (previous run) | Full codebase check (Opus), fixes, push | completed | `7a46785`, Vercel and CI succeeded |
| C1-C6 | UI batch | completed | merged and pushed earlier (see B7 notes and git log) |

### Place search (P1)

- Search bar uses the Mapbox Search Box API: `/api/geocode` (suggest, `{suggestions}`) then `/api/geocode/retrieve` (coordinates, `{place}`). POIs rank first. Details in the README "Place search" section.
- One uuid session per search, made in `SearchBar` by `newSessionId()` (`src/lib/session-id.ts`, falls back where `crypto.randomUUID` is missing) and renewed after every pick (including fallback picks) and whenever the search is cleared (Escape or deleting the text).
- If suggest fails, the v6 forward geocoder answers with coordinates already set. Fallback results are not cached, so landmarks come back as soon as suggest recovers. Suggest and retrieve results are cached 10 min in memory.
- Retrieve ids must be URL-safe, at most 300 characters, and contain a letter or digit (so `..` is rejected).
- Fake mode (`EXTERNAL_APIS_FAKE=1`): canned landmarks (Horseshoe Bend, Griffith Observatory, Yosemite Valley Viewpoint) plus the old fake address.
- Still owed: one smoke test against real Mapbox (confirms Search Box is enabled for the token and the real subtitle/category text).

### Waiting on the owner

| # | Task | Status | Notes |
|---|---|---|---|

### Backlog (from the old TODO.md; not started)

To verify by hand:
- Apple Maps link with every stop, on a real iPhone (the multi-`daddr` format is unconfirmed).
- Google Maps link with every stop (up to 11 stops per link; longer trips split into parts).
- Hover photo card stays fully on screen in the Suggestions tab.
- Priority pill (My trip tab: Normal / High / Must) and optimize behavior with a Must-have stop, on a real phone.
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
- CSP: scripts need a per-request nonce (set in `src/proxy.ts`, `'strict-dynamic'`, no `'unsafe-inline'` for scripts); styles still allow `'unsafe-inline'` (Mapbox GL and React inline style attributes). Because of the nonce every page renders per request (the root layout reads `x-nonce`), including `/offline`, whose cached copy replays its own nonce. API responses carry `default-src 'none'`.
- Google-only account deletion re-confirms through Google's account chooser (`prompt=select_account`; `login` is not a documented Google value); existing sessions must sign in once first.
- Header: below 360 px wide the Edit/Export/Share buttons become icons (aria-labels and title tooltips kept) so the trip name and buttons share one row; verified by eye at 320 and 390 px and 320 px with 1.5x text. The icon buttons are 32 px wide by 44 px tall (the text buttons above 360 px are 36 px tall).
- PDF font: full Noto Sans Regular and Bold (about 1.2 MB raw, about 0.6 MB gzipped) are fetched on click; they are not subset because no subsetting tool is in the repo toolchain.
- PDF downloads (C5): Download PDF (Export menu, share page) first opens a themed "Itinerary PDF" dialog and builds the file, then saves it from a fresh tap on the dialog's Download button (`saveBlob` runs synchronously in the click), so Safari no longer sees a download started long after the tap. GPX already saved straight from its tap. Safari's own "allow downloads on this site" prompt may still appear once per site; it is Safari's and could not be tested here (no Safari or iOS device). Owner to confirm on the deployed site.
- Photo uploads: metadata is stripped by a small structural walker (no image library, no re-encode); a JPEG keeps only its EXIF orientation. Pixel data is not decoded, so a file with valid structure but broken pixels is stored as sent.
- Share page `no-referrer` vs a URL-restricted Mapbox token.
- Offline copies: a save that does not fit the browser's storage deletes nothing unless a measured shortfall shows the oldest copies free enough room (they are put back if the write still fails); sign-out, delete-account, sign-out-everywhere and change-password share one awaited sign-out, and an answer without a redirect url (next-auth hides the status of a 500) or with an error/csrf url counts as not signed out.
- Offline copies are cleared on sign-out and when the login or signup page is shown (session ended); they stay while the device is offline.
- Rate limits for login/signup/password/delete and the paid-service routes (geocode, retrieve, reverse geocode, directions, optimize, popularity, place photo, Flickr budget) are in the shared database (paid ones fail closed with 503 if it is down); the rest, including the `/s/[token]` render limit in `src/proxy.ts` (300/min per address), are per instance; no monitoring or alerting yet. `/api/optimize` is capped at 2 concurrent solves per instance (503 beyond) with a 1 s solve budget, so a cut-short search can return a good but not best order (the "Already the fastest order" message is no longer shown for a cut-short search; fixed in 24d259e).
- Photo uploads: JPEG is cut at its first end-of-image (scan data walked forward; APP/COM between progressive scans dropped), so appended images/videos and their metadata are gone; limit 30000 px per side and 50 MP; WebP keeps only VP8/VP8L/VP8X/ALPH/ANIM/ANMF/ICCP. JPEG markers are allow-listed (unknown/reserved markers refuse the file) and more than 10000 segments is refused. Files with no EOI (truncated), padding between segments or DNL (height 0) are refused.
- Flickr: popularity is 10 requests/min per user, at most 5 places each; Flickr calls share an app-wide 3000/hour budget (`flickr-app`), after which counts fall back to Commons (those counts are cached per instance for 24 h like Flickr ones, so scales can mix for a day) and place photos skip Flickr. Rate-limit counter rows are never pruned except opportunistically.
- Login lockout is per email and hashed client address (8 failures / 15 min); 50 failures / hour per email refuses only addresses that already failed, and a hard ceiling of 200 failures / hour refuses everyone for that email until the window clears (the window is fixed, so an attacker spending about 200 failures per hour can keep the owner locked out of password login by renewing it every hour; accepted trade-off). IPv6 is keyed by /64. The client address is trusted from proxy headers only on Vercel (`x-vercel-forwarded-for`, else last `x-forwarded-for`) or with `TRUST_PROXY_HEADERS=1` (+ `TRUSTED_PROXY_DEPTH`); otherwise all clients share one address key, so per-IP limits act as global ones.
- Share links and the share PDF omit stop notes; shot notes and the shot list are shared.
- `updateTrip` find-then-update is not atomic.
- Playwright timezone is not pinned for specs other than the hydration one.
- Start time vs day: the API refuses a `departAt` that is not on the trip's planned day (solar day at the first stop; any instant that is that day somewhere on Earth while there is no stop); an old row that no longer matches is left alone and never blocks other edits. A date change through the API alone keeps the clock time across DST in the server's zone (UTC on Vercel, so whole days there); the editor sends the viewer-zone time explicitly. Changing the first stop afterwards can leave a start time off its day (not rechecked). Optimize clamps its start time to the planned solar day (route and editor), so a save is never refused for that; the day check (`updateTrip`) runs only on a `departAt` that differs from the stored one AND falls on a day other than both the stored one's day and the planned day, and never on a value that equals the server's own shift of the stored value on a date change; so a rename plus date change and Undo (earlier value on the stored value's day) of an old off-day row still save, while a move to some new wrong day is refused. When the same PATCH changes `plannedDate`, only the server's shift (or a time on the new day) is accepted.
- Routes that wind more than 360 degrees round a pole get the 400 "too complex" answer. Places already imported at exactly lng 180.0 sit in an unreachable grid column until `import-places` is re-run (new imports wrap to column 0).
- Skills in `.agents/skills` (in git) and `.claude/skills` (local copy, gitignored) reference plugin commands that are not installed.

## Current work: A44-A47 owner changes (2026-10-27), for a LATER commit

Pushed and deployed: `ae92a84` (F4+F5+F6 fixes; Vercel photo-app-pi2o and CI check/e2e succeeded). The owner said to keep that commit as is and
do these as a separate later commit: A44 reorder ignores visited stops, A45 separately clickable stops at (near-)identical coordinates,
A46 more map in phone landscape, A47 non-Latin PDF text if it does not hurt the app. Work is uncommitted in the working tree; push only on "push".
Still open owner decision: the stop/place card covering the sheet header on short and landscape screens (may be settled by A46).

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
from `git log` if gone). Status is in `docs/PROGRESS.md`. Merging to `main`
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

1. Read `docs/PROGRESS.md` (newest entry first) for the latest state.
2. `docs/HISTORY.md` (committed, durable) has per-task completion facts for the
   original 24-task build. The SDD ledgers under `.superpowers/sdd/` are local
   and git-ignored; they may be gone, so trust `git log` and `docs/PROGRESS.md`.
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
  two additional subagents (both Opus, both read-only against
  the finished diff; since 2026-10-19 one at a time unless the owner says yes to parallel, see `CLAUDE.md` item 11): one hunting for bugs, one for security issues. These
  are in addition to, not instead of, the per-task reviews and the final
  whole-branch review the skill already runs.
- The D1-D9 open decisions table in the plan was presented to the human
  partner and not objected to — treat all nine defaults as confirmed, not
  as still-open questions.
- Keep `docs/PROGRESS.md` (project root, both checkouts conceptually share one
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
- `.env`, `.env.local` (gitignored). Names in `.env.example`: `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_MAPBOX_TOKEN`,
  `MAPBOX_TOKEN`; hosted only: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`; optional: `FLICKR_API_KEY`, `OVERPASS_URL`,
  `UPLOAD_DIR`, `EXTERNAL_APIS_FAKE`, `NEXT_PUBLIC_MAP_FAKE`, `TRUST_PROXY_HEADERS`, `TRUSTED_PROXY_DEPTH`, `OPTIMIZE_MAX_CONCURRENT`, `OPTIMIZE_BUDGET_MS`.

**In git:** `CLAUDE.md` (push-and-deploy check, to-do board rules 1-11), `AGENTS.md` (read `node_modules/next/dist/docs/` before Next code), this file.

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

## Current status

Complete and deployed at https://photo-app-pi2o.vercel.app (Vercel +
Turso + Vercel Blob). Pushes to `main` redeploy automatically. Env vars
are managed in Vercel; set them with `vercel env add NAME env --value ...`
(not via stdin, not by pasting into the web form: both caused stray
whitespace). Remaining: restrict the Mapbox token to the site URL. The
map-first UI is merged and deployed (2026-10-07) and the live smoke test
passed. See `docs/PROGRESS.md`. The sections above are historical context for the build.


## Local map data (photo-spot suggestions)

Suggestions are answered from a `Place` table (a copy of OpenStreetMap viewpoints, named peaks and attractions for the lower 48, Alaska,
Hawaii, Canada south of 76 N, Mexico, South Korea and Japan), not from the public Overpass servers, which often return 504/429 and take
25-60 s outside the local copy. Overpass is only asked when the search is outside the rings (`inLocalCoverage` in
`src/server/suggestions/local-places.ts`), or the local copy returns fewer than `MIN_LOCAL_PLACES` (5) places;
if Overpass then fails, the thin local answer is used. Overpass answers are also kept in the shared `SuggestionCache` table (A27).
Turso `Place` holds 203,679 rows (US, Canada, Mexico, South Korea, Japan). Import to Turso **before** pushing a coverage change.

- Build the data: `scripts/build-places.sh` (about 1 hour, 10 GB of downloads, needs `uv`) writes `data/places/*.jsonl` (git-ignored).
- Load it: `node scripts/import-places.mjs data/places --replace` (set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to load the live DB, otherwise `DATABASE_URL`).
- The table is created by migration `20261011120000_local_places`; until it is filled, searches behave exactly as before (Overpass).
- Refresh every few months. Relations (rare multipolygon attractions) are not included; ways use the centroid of their nodes.
- Other regions: `scripts/build-places-intl.sh` (Canada, Mexico) and `scripts/build-places-asia.sh` (South Korea, Japan), then `node scripts/import-places.mjs <dir>` (no `--replace`; upserts by id).
- Query shape (2026-10-09): a search is one database round trip however long the route. Cells are merged into runs read as `cell BETWEEN a AND b` terms (at most 100 per statement, extra statements run in parallel), corner cells outside a circle are skipped, and every cell read is remembered in memory for 30 minutes (`createCellReader`), so a nearby second search needs only the new cells. After a re-import a long-lived server may serve old cells for up to 30 minutes. Around-point results are ranked kind tier, named, then nearest first (routes: kind, named, id).
