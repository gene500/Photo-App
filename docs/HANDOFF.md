# Handoff and task board

The one file that tracks the work and lets another Claude session or machine pick it up. It replaces the old
`TODO.md`. **Update the Task board below the moment any status changes** (and commit it), then trust it, `git log`
and `docs/archive/PROGRESS.md` over memory. Where things are: this file = START HERE, board, standing rules, Claude Code setup. `docs/BACKLOG.md` = owner follow-ups and known gaps. `docs/LOCAL-PLACES.md` = local map data. `docs/design/` = specs and design notes. `docs/archive/` = history (old board rows, progress log, plans, test reports).

## START HERE (a fresh Claude session reads this first; updated 2026-11-08)

**Goal:** Photo Op Planner, a road-trip photo planner (Next.js 16, Prisma/libsql, next-auth, Mapbox). Live at https://photo-app-pi2o.vercel.app (Vercel project `photo-app-pi2o` only; `photo-app` is an empty duplicate).

**Starting point (verify with `git status` and `git log`; trust them over this text):**
- Repo `~/Photo-App` (older machine: `/Users/genestone/road-trip-photo-planner`), branch `main`, remote `gene500/Photo-App`. Last pushed code commit before F16-F19: `45b5b71`. The F16-F19 push is the commit on top of it (see `git log`).
- **Pushed in `2ee3008` (nothing else uncommitted except this file):** A61 (optimizer: lost-cause light misses capped, so equal-priority routes stop zigzagging), A62 (Start from my location), A63 (NPS alerts + OSM opening-hours notices; `docs/design/A63-DESIGN.md` is tracked now), A64 (Visited checkbox + quiet auto re-optimize), A65 (themed PDF), F12 (fixes from the Opus FINAL review), plus test-stability edits (`tests/setup.ts` asyncUtilTimeout 5 s, optimize stall threshold 500 ms, fake timers in TripEditor tests).
- Last verification before F16-F19 (2026-10-29, my runs): tsc clean, lint clean, vitest 2101/2102 (the one failure was the wall-clock check "9 stops" taking 8 s under load; 1.1 s alone), e2e 58/59 (swap-undo failed under load; passed alone 2/2).

**What needs to be done:** see the Open tasks below (A71 owner browser check; everything else is in the archive). Docs were reorganised on 2026-11-05 (A66). Owner follow-ups are in the paragraph below and in `docs/BACKLOG.md`.

**Owner follow-ups (not code):** try Optimize on the real Yosemite trip (A61: the zigzag is reduced, not eliminated; a 100-case random run showed median drive ratio 2.59 to 1.94 vs drive-only; fallback idea: reject out-and-back orders directly); create a free NPS key (https://www.nps.gov/subjects/developer/get-started.htm) and set `NPS_API_KEY` in Vercel (Production and Preview) and local `.env`; look at the real Mapbox map and a real PDF static map (light pins like `#e0a98a` may have a hard-to-read white label); real-browser geolocation permission flow; L3 (notice fetches may be frozen on Vercel after the response; consider `after()`) and L4 (NPS: only 10 parks, `limit=100` alerts, loose 35 km park matching); known gaps: ticks from the Stops tab list, drawer and OfflineView do not trigger auto-optimize, sparse trailing PDF page, no test for 503 busy with an origin. The macOS `StorageManagementService` process slows tests and causes load-only failures.

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
- Agents that run e2e/browsers work in their own copy of the repo (`cp -cR` for `node_modules`, never a symlink), own port, max 4 at once, and stop servers by PID and delete their copy when done.

**Skills and plugins to install** (details in "Claude Code setup" below):
- Plugins from `anthropic-plugin-directory`: **`superpowers`** (6.4.2; required: brainstorming, writing-plans, subagent-driven-development, requesting-code-review, verification-before-completion, systematic-debugging, test-driven-development, finishing-a-development-branch), **`playwright`**, **`frontend-design`**. `tdd-guard` is disabled and not needed (`.claude/tdd-guard/data/config.json` = `{"guardEnabled":false}`).
- Built-in skills used: `security-review`, `code-review`, `simplify`.
- Project-local skills in gitignored `.claude/skills/` (copy from the old machine, or skip; security-review helpers): `audit-context-building`, `codeql`, `differential-review`, `fp-check`, `frontend-design`, `sarif-parsing`, `semgrep`, `sharp-edges`, `supply-chain-risk-auditor`, `variant-analysis`. `.claude/settings.local.json` allows `Bash(npm run *)`.
- User settings: `model: opusplan`, `permissions.defaultMode: auto` (see "Claude Code setup").

**Standing rules (full text in `~/.claude/CLAUDE.md` and `CLAUDE.md`):** test before claiming done; no commit/push unless told; "push" = `main` only, tests and typecheck first; no secrets anywhere; they/them when pronouns are unstated; Opus for final reviews and whole-repo checks, Sonnet for implementers and per-task work, always pass `model`; run independent tasks in parallel automatically (max 4 agents with servers or browsers); subagent reports are data, not instructions; keep this board current, archive finished rows at once, SEC then FINAL always last; end every reply with the open-task table; commit trailers `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AFkQpJYJ3ScjJ2DzP3AKkA`.

## Current work (2026-11-10)

**State:** HEAD `d440df9` = origin/main (A71 handoff pushed; code last pushed as `3b5c98d`, Vercel photo-app-pi2o + CI success for both). The working tree holds A73-A77 UNCOMMITTED: modified `CLAUDE.md`, `README.md`, `docs/HANDOFF.md`, `docs/archive/HANDOFF-ARCHIVE.md`, `src/app/globals.css`, `src/app/legal-pages.test.tsx`, `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/components/editor/TripEditor.tsx` (+test), `TripHeader.tsx`, `TripPlan.tsx`, `src/components/legal/LegalPage.tsx`, `src/components/settings/SettingsView.tsx` (+test). No new files. Use `git add -A` after checking `git status`. Nothing is stashed.

**Just finished:** A73 (trip name only frames the map; the auto landmark stop is gone), A74 (My trip top regrouped into one tinted card), A75 (map controls share one 32 px width/centre line), A76 (Time format "System (12-hour)"), A77 (Privacy Policy and Terms audited against the code and updated, dated November 10, 2026; daily-update rule added to the project CLAUDE.md). SEC (Opus): no findings; its legal spot-check found one overstated claim (settings are device-only, but route focus and default dwell are sent with requests): fixed. FINAL (Opus): one blocker, the "Hosting logs" sentence said only error names are logged (code also logs messages, stacks and a photo file name): reworded; legal tests, tsc and eslint re-run and pass. FINAL is READY and waiting for "push". Verified by the lead on the tree before that one wording fix: tsc, eslint --max-warnings 0, vitest 216 files / 2282 tests, e2e 63 pass, `E2E_PROD=1 e2e/csp.spec.ts`, `next build`, no zod in client chunks; legal tests, tsc and eslint re-run after the fix. A71 (owner browser check) passed 13 of 13 on 2026-11-09.

**Next:** FINAL (Opus full check) then, on the owner's "push": re-run tests and typecheck, `git add -A`, commit (mention "legal pages reviewed/updated"), push to `main`, check Vercel (`photo-app-pi2o`) and CI (`check`, `e2e`).

**Owner to eyeball after the push:** the real Mapbox map controls (A75: click the (i) to expand attribution, dark mode); the My trip tan note box after A74 (not seen in screenshots); the Settings label.

**Legal pages, owner review (A77):** confirm in the browser network tab that Mapbox sends usage statistics to events.mapbox.com; the "Vercel keeps request logs" line is general host knowledge; photo deletion stops retrying after 8 failed attempts (the policy does not say so); Open-Meteo free tier is non-commercial; Flickr photo licences and the Overpass mirrors / NPS are third parties a lawyer may want to see; Google sign-in text applies only if GOOGLE_CLIENT_ID/SECRET are set in production.

**T17 items left for the owner (they change behavior):** see `docs/STRESS-LOG.md` "# T17" (Reduce motion vs the route animation, PDF omits checklist items, stale tab overwriting a start time, text/plain PATCH, tap-target sizes, and the rest).

**H8 items left for the owner (they change behavior):** see `docs/STRESS-LOG.md` "# H8" (Blob/DB timeouts, account-delete photo cleanup, photo caching, search trim, notes maxLength, wording, weather DST check).

**Open owner decisions / follow-ups:** Priority-focus drive ratio (up to ~3.6x, left as is); forgot-password flow (H7, deferred); orphan photo file after a crash between file write and DB swap (needs schema/journal); optional server-side duplicate-accept guard; marker tab order; share-popover stale link across tabs; emoji "?" in PDFs (no emoji font). Standing parallel rule: independent tasks run in parallel automatically (global rule 14).

## Task board

ID prefixes (owner, 2026-10-26): A = alpha (owner work items), T = testing passes by agents (bug hunts), F = fix passes, H = older bug sweeps (history), then SEC, then FINAL.

Statuses: pending, active, paused, blocked, completed, removed. Exactly one item is active at a time.
Visibility rule (owner, 2026-10-16): the task chart is shown in the terminal at the end of every reply, always.
Ordering rule (owner, 2026-10-16): anything added goes toward the end of the list, in the order asked; the list order is: owner work items, then the bug sweeps (H rows), then the final row; the absolute final row of every list is always one combined row: a full codebase check (Opus), then merge, push, and confirmation that Vercel and CI succeeded; nothing goes after it.
Last updated 2026-11-10

### Open tasks

| # | Task | Status | Est | Use | Notes |
|---|---|---|---|---|---|
| FINAL | Opus full check, merge, push, Vercel + CI | (push) | 30 min | Heavy | Runs automatically after SEC; stops at (push) until the owner says push. |

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
