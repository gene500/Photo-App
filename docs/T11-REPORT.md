# T11 report: redundant and unused code (Opus read-only sweep, HEAD eadac0e, 2026-10-27)

Order for F8: Batch 1, then 6 (types only), 4, 5, 7, 8. Each batch: typecheck, lint, full vitest. Batch 7 also proxy test + CSP e2e.

## Batch 1: dead production code (Low, remove)
1. `src/lib/visited-run.ts` `visitedChanges`: only its test uses it (callers went when the cascade moved to the server). Keep `leadingVisited`, `pinVisitedFirst`.
2. `src/server/share.ts` `getSharedTrip`: only tests/api/share.test.ts uses it; switch the test to `loadSharedTrip`.
3. `src/server/shared-limit.ts` `limitKey` (+ unused `createHash` import): zero references.
4. `src/server/optimize-slots.ts` `optimizationsInFlight`: zero references.
5. `src/lib/short-landscape.ts` `SIDE_PANEL_WIDTH`: zero references; the literal is hard-coded 5 times in Tailwind classes. Delete (keep `sidePanelPx()` in sync).
6. `src/lib/validation.ts` `type TripInput`: zero references.
7. `src/app/layout.tsx` `Geist_Mono` font and `--font-mono` in globals.css: nothing uses mono. Saves a webfont download.

## Batch 2: test-oracle code (keep, owner decision)
`optimize-schedule.ts` `optimizeSchedule`, `scheduleCost`, `optimizeScheduleExact` used only by tests; test reset hooks are a normal pattern. Recommendation: keep.

## Batch 3: unnecessary `export` keywords (~120 symbols, optional)
Used only inside their own file. Skip, or add `knip` to CI. Owner decision.

## Batch 4: duplicated helpers (Low-Medium, consolidate)
FOCUSABLE selector (Dialog, StopDrawer; use-popover has a near copy, check first), `isObj` (api-shapes, offline-store), `isNum` (suggestions-store, hike/nps), `round2` (weather, typical-weather), `METERS_PER_MILE` (format, hike), `PENALTY` (optimize-order, optimize-schedule), `SUNRISE_COLOR`/`SUNSET_COLOR` (MapPanel, FakeMapPanel), stop-name limit 200 in three places, `sessionSchema` (two geocode routes), `disabled()` (shared-limit, rate-limit), `storage()` (suggestions-store, offline-store), `noop`, `renderStamp`. Leave alone: `cellOf` script vs places-grid (tested), TTL constants, KM_PER_DEG variants. `ROUTE_COLOR` in static-map.ts (blue) vs the app route colour is an inconsistency (owner decision, already open).

## Batch 5: duplicated test helpers (Medium, test-only)
30 e2e specs repeat the signup flow; `tripWith`/`downloadPdf` identical in pdf-cjk and pdf-fonts-offline; `signInAs` identical in four tests/api files. Add `e2e/helpers.ts` and a tests/helpers one.

## Batch 6: dependencies
- `@types/better-sqlite3` (dev): unused, remove.
- `better-sqlite3` ^13 (top-level) vs the adapter's own nested 12.11.1: two native copies. Owner decision; needs build + e2e.
- Everything else has a use.

## Batch 7: repo files
- `public/file.svg globe.svg next.svg vercel.svg window.svg`: create-next-app leftovers; referenced only by the proxy matcher and proxy test. Delete and simplify matcher (run proxy test + CSP e2e).
- `scripts/bench-*` one-off benchmarks: keep or delete (owner decision).
- `.gitignore` duplicates (`.DS_Store`, `.vercel`, `test-*.db`).
- Local leftover `test-54116.db` (gitignored) can be deleted.
- `.agents/skills/**` and `skills-lock.json` tracked third-party skill caches (owner decision).

## Batch 8: CSS
Only dead item is `--font-mono` (Batch 1 item 7). Everything else is used or an intentional pair.

## Clean
No orphan source modules, Prisma models all used, env example matches code, README/HANDOFF paths exist, no stale identifiers in comments.
