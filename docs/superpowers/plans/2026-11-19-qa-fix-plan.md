# QA full sweep: fix plan

> For agentic workers: use superpowers:test-driven-development; one commit per bug.

**Goal:** fix what the QA sweep (docs/QA_ARCHITECTURE.md, qa-report/findings-p3.md, qa-report/findings-p4.md) reproduced, without changing product behaviour.

**Spec:** the QA brief given by the owner on 2026-11-19 (fix bugs, crashes, error handling, layout and a11y problems, behaviour-neutral perf, non-breaking dependency patches; ask before UX changes, feature removal, major upgrades, schema changes, auth).

## Global constraints

- Work only on branch `qa/full-sweep`; never push to `main`.
- Every fix: failing test first, minimal fix, then typecheck, lint, vitest and the related e2e specs.
- Never print or commit secrets.

## Review Focus

- A keyboard-shrunk portrait phone must keep the bottom sheet (P3-001).
- Typed text must not become part of a field's accessible name (P3-004).
- The in-app Reduce motion setting must reach JS animations.
- A dependency patch must not change the build or test results.

## Priority list

| Order | ID | Sev | Decision | Task |
|---|---|---|---|---|
| 1 | P3-001 | medium | fix | Side-panel layout needs width of at least 480px (`src/lib/short-landscape.ts`, `src/app/globals.css`); unit test plus `e2e/keyboard-portrait.spec.ts` |
| 2 | P3-004 | low | fix | Stop drawer fields use `for`/`id` labels (`StopDrawer.tsx`); structural unit test |
| 3 | R-001 | low | fix | In-app Reduce motion also stops map animated moves (`src/lib/reduced-motion.ts`, `MapPanel.tsx`, `FakeMapPanel.tsx`) |
| 4 | P4-002 | low | fix | Manifest `id` equal to start URL, `lang` |
| 5 | H-001 | low | fix | `TripEditor.firstStop.test.tsx` mocks `api.locate` (unhandled error in the baseline run) |
| 6 | DEP | mod | fix | `npm audit fix` without `--force` (13 to 8 findings) |
| 7 | SMOKE | n/a | add | `e2e/smoke.spec.ts`, the core journey end to end |
| - | P3-002, P4-005 | low | needs decision | Tap targets below 44 px change the look of the stop list, markers and settings |
| - | P4-001 | low | needs decision | theme-color / apple-touch-icon change browser chrome colour and need a new icon asset |
| - | P4-003, P4-004 | low | needs decision | bfcache (pages are no-store because of the CSP nonce) and eager first thumbnail |
| - | prisma audit | high | needs decision | Needs a major Prisma upgrade |
