# Handoff

How to pick this project back up in a new session, device, or after a
compaction. Updated at phase transitions, not every task — check the
ledger (below) for exact task-by-task status.

## What this is

Road Trip Photo Planner — see `docs/superpowers/specs/2026-10-06-road-trip-photo-planner-design.md`
for the full design. Being implemented from
`docs/superpowers/plans/2026-10-06-road-trip-photo-planner.md` (24 tasks,
5 phases) using `superpowers:subagent-driven-development`.

## Where the work actually lives

This is a **git worktree**, not the main checkout:

- Main checkout: `/Users/genestone/road-trip-photo-planner` (branch `main`) —
  holds only the spec, plan, PROGRESS.md, this file's counterpart if ever
  merged back.
- **Worktree** (all implementation work happens here):
  `/Users/genestone/road-trip-photo-planner/.claude/worktrees/road-trip-photo-planner`
  on branch `worktree-road-trip-photo-planner`.

To resume: re-enter this worktree (native `EnterWorktree` tool with
`path: "/Users/genestone/road-trip-photo-planner/.claude/worktrees/road-trip-photo-planner"`,
or `cd` there directly if working outside that tooling) before touching any
files. Running git commands from the main checkout path will not see this
branch's work.

**Remote:** `origin` → https://github.com/gene500/Photo-App.git. Both
`main` and `worktree-road-trip-photo-planner` are pushed and tracking.
On another device, clone this repo and check out
`worktree-road-trip-photo-planner` directly (no need to recreate the
worktree setup — just work on that branch in a normal checkout there).

## Resume procedure

1. Enter the worktree above.
2. Read the SDD ledger:
   `.superpowers/sdd/2026-10-06-road-trip-photo-planner/progress.md`
   — it names which tasks are `complete`, which are mid fix-loop, and the
   preflight conflict-scan table. Trust it over any memory of "where we were."
   `HISTORY.md` (committed, durable) has the same per-task completion facts
   in a simpler form, for a quick skim without the ledger's full detail.
3. Re-invoke `superpowers:subagent-driven-development` and continue from the
   first task without a `Task N: complete` line in the ledger.

## Standing rules for this project (confirmed by the human partner)

- **Model allocation:** Opus is used ONLY for the planning step (already
  done — the implementation plan was written by an Opus agent). Everything
  else — every task implementer, every task reviewer, the final whole-branch
  review, and the extra bug/security review passes below — runs on
  **Sonnet**. Do not escalate the final review to a more-capable model even
  though the skill's default guidance suggests it; the human partner
  explicitly overrode that.
- **Extra reviews requested beyond the skill's default process:** after all
  24 tasks are complete and the final whole-branch review is clean, dispatch
  two additional subagents in parallel (both Sonnet, both read-only against
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

## Current status (as of this file's last edit)

Task 1 (scaffold) was dispatched to a Sonnet implementer subagent and was
still running when this file was written. Check the ledger for whether it
completed and was reviewed. Nothing has been committed to this branch yet
beyond what the ledger shows.
