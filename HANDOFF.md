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

**No remote is configured on this repo** (`git remote -v` is empty). It is
local to this machine only. Moving to a genuinely different device means
copying the repo directory over yourself (or pushing to a remote you set
up first) — git history alone will not follow you.

## Resume procedure

1. Enter the worktree above.
2. Read the SDD ledger:
   `.superpowers/sdd/2026-10-06-road-trip-photo-planner/progress.md`
   — it names which tasks are `complete`, which are mid fix-loop, and the
   preflight conflict-scan table. Trust it over any memory of "where we were."
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

## Current status (as of this file's last edit)

Task 1 (scaffold) was dispatched to a Sonnet implementer subagent and was
still running when this file was written. Check the ledger for whether it
completed and was reviewed. Nothing has been committed to this branch yet
beyond what the ledger shows.
