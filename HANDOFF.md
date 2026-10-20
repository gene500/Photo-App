# Handoff and task board

The one file that tracks the work and lets another Claude session or machine pick it up. It replaces the old
`TODO.md`. **Update the Task board below the moment any status changes** (and commit it), then trust it, `git log`
and `PROGRESS.md` over memory. The sections after "Current work" are history except "Claude Code setup".

## Task board

Statuses: pending, in progress, completed, blocked, removed. Exactly one item is in progress at a time.
Visibility rule (owner, 2026-10-16): the task chart is shown in the terminal at the end of every reply, always.
Ordering rule (owner, 2026-10-16): anything added goes toward the end of the list, in the order asked; the list order is: owner work items, then the bug sweeps (H rows), then the final row; the absolute final row of every list is always one combined row: a full codebase check (Opus), then merge, push, and confirmation that Vercel and CI succeeded; nothing goes after it.
Last updated 2026-10-19. Est = rough working time for Claude, excluding deploy waits and your review time. Use = rough token usage (Light, Medium, Heavy). Within each group (work, then sweeps) rows are sorted Light to Heavy; the FINAL row stays last.

### Open tasks

| # | Task | Status | Est | Use | Notes |
|---|---|---|---|---|---|

### Archive (completed and removed tasks)

| # | Task | Status | Notes |
|---|---|---|---|
| H3 (run 1) | Bug sweep: Sonnet 1, API routes and server error paths | completed | 2026-10-19: report in session scratchpad `sweep-H3-api.md`; 7 findings (no auth/ownership gaps): signup without email verification lets someone register a victim's email, upload leaks a file if the DB swap throws, `updateTrip` 500 on concurrent delete, photo deletes not queued before commit, paid limits charged before validation, share-page Mapbox calls use only the per-instance limiter, stale session-version cache. Triage in H7 |
| H4 (run 1) | Bug sweep: Sonnet 2, UI components, empty/loading/error states, a11y | completed | 2026-10-19: report in session scratchpad `sweep-H4-ui.md` (read from code, not reproduced in a browser); top findings: no error/loading/not-found/global-error pages and no WebGL check or map error handler, route-fetch error hidden in TripEditor, login/Google buttons can stay disabled, focus lost when a focused control unmounts, SearchBar combobox lacks listbox roles and keyboard navigation. Triage in H7 |
| H6 (run 1) | Bug sweep: Sonnet 4, build, config, CI, env, deps, e2e | completed | 2026-10-19: report in session scratchpad `sweep-H6-build.md`; no high-severity defects, eslint/tsc clean, npm audit 0; findings: CI e2e never runs the production-CSP spec (`E2E_PROD=1`), preview builds may point at the production DB, no migration concurrency guard, no production guard on `EXTERNAL_APIS_FAKE`, `.env.example` omits `CRON_SECRET`/Google/`SIGNUP_MIN_SECONDS`, no `engines`/`.nvmrc`, fixed `waitForTimeout(150)` in two e2e specs, no Playwright traces uploaded. Triage in H7 |
| A19 | Share page: Apple Maps and Google Maps links | completed | 2026-10-19: links under the header in `SharedTripView.tsx` (built from names and coordinates only, no notes; Google parts labelled for long trips); 2 tests; tsc, eslint clean; local only |
| B7 | FINAL: Opus check, merge, push, Vercel and CI | completed | 2026-10-19: Opus check GO after fixing e2e/light-aware and e2e/settings locators; pushed fee698e to main; Vercel photo-app-pi2o success, CI success (2 checks) |
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
| A10 | Add the exact Claude Code setup to HANDOFF.md | completed | 2026-10-19: new "Claude Code setup" section; fixed outdated plugin/tdd-guard text |
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

## Current work: local UI batch and sweeps (2026-10-19)

**Goal:** the Task board above. The PDF itinerary (2026-10-16) and the C1-C6 UI batch are merged and pushed (`7a46785`).
The A-batch (A4-A9, A11, A12, A14-A18, A6) is done and tested locally but **not committed or pushed**: it goes out with
the FINAL row (B7), after the sweeps (H rows), triage (H7) and `/security-review` (H8). Do not push until the owner says "push".

**Where the code is:** branch `main` in `/Users/genestone/road-trip-photo-planner` with uncommitted changes. Sweep agents
are read-only and write reports to the session scratchpad. Never push a non-`main` branch (Preview builds hold the Turso
credentials, see the deploy caution below).

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
  two additional subagents (both Opus, both read-only against
  the finished diff; since 2026-10-19 one at a time unless the owner says yes to parallel, see `CLAUDE.md` item 11): one hunting for bugs, one for security issues. These
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
