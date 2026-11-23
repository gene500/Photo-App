# API budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app from using more than 80% of each provider's monthly free allowance (Mapbox products first), stop one user or bot from spending a whole budget, and show the owner where usage stands.

**Architecture:** A new monthly budget module counts spend per provider product in the existing `RateLimitCounter` table (one atomic conditional upsert, key per UTC month). Server-side Mapbox calls are counted at their single choke point (`getJson` in `src/server/external/mapbox.ts`), after the cache check. Per-user shares are counted in the six routes that already call `enforcePaidLimit`. Browser-side loads (map start, Static Images) are counted by a small ping route. Page loaders read a map state and switch to the existing no-map fallback.

**Tech Stack:** Next.js 16, Prisma on libsql/Turso (raw SQL like `src/server/shared-limit.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-api-budgets-design.md`

## Global Constraints

- Cap = 80% of the verified monthly allowance, per calendar month in UTC. All allowances live in one config file, each with its source and the date checked beside it.
- Allowances used (Mapbox without a payment method): web map loads 5,000; Directions 10,000; Matrix 10,000 elements (one request costs origins x destinations); Geocoding and Static Images are unconfirmed and use a placeholder allowance of 10,000 each (80% = 8,000) until the owner confirms from the Mapbox dashboard. Flickr has no monthly cap: its monthly counter is display-only; the hourly `flickr-app` budget stays as is.
- Map-load state thresholds: banner from 70%; at 80% the shared trip page (`/s/[token]`) starts no interactive map; signed-in users keep the map until 95%.
- Per-user share: 30% of the 80% cap, per product per month. The owner account is exempt. Accounts-less calls count only toward the provider total.
- Reserve before the call (refuse if it would pass the cap); cached calls are not counted; failed or refused upstream calls are not refunded.
- Paid routes fail closed (503) if the shared store is unreachable; `RATE_LIMIT_DISABLED` must not disable budgets in production.
- Owner is the signed-in account whose email equals `OWNER_EMAIL`; the usage page also requires being signed in.
- Existing per-minute limits and the `flickr-app` hourly budget are unchanged.
- Never print or commit the Mapbox `pk.` token or `TURSO_*` secrets. Do not commit or push unless the owner says so (global rule): leave work in the working tree.
- Project rule: adding a stored field or client ping requires a legal-pages review (`LEGAL_UPDATED`, see `CLAUDE.md`).
- Any process you start (dev server, browser) must be stopped before finishing.

## Review Focus

- Month rollover: a spend at 23:59:59 UTC on the last day and one at 00:00:00 the next day land in different counters; the new month starts at zero (pinned in Task 1).
- Concurrency: many parallel spends can never push a counter past its cap (pinned in Task 1).
- Store outage: when the database is unreachable a paid Mapbox call is refused with 503, not allowed (pinned in Task 2).
- A refused budget reaches the user as a clear 429 message, not a 500 or the generic 502 "routing failed" text (pinned in Task 2).
- A Matrix request with 25 stops spends 625 units, not 1 (pinned in Task 2).
- The ping route rejects an unknown kind (400), cross-origin posts, and more than 30 pings a minute from one address (pinned in Task 5).
- The owner is never refused by the per-user share, and an account with `OWNER_EMAIL` unset is nobody (pinned in Task 3).

---

### Task 1: Budget core

**Files:**
- Create: `src/server/budget-config.ts`, `src/server/budget.ts`
- Test: `src/server/budget.test.ts` (runs in the `db-and-server` project like `shared-limit.test.ts`; read that file for the DB setup pattern)

**Interfaces:**
- Produces, in `budget-config.ts`:
  `type BudgetProduct = "mapbox-geocoding" | "mapbox-directions" | "mapbox-matrix" | "mapbox-map-load" | "mapbox-static-image" | "flickr"`;
  `BUDGETS: Record<BudgetProduct, { label: string; allowance: number | null; source: string; checked: string; confirmed: boolean }>` (allowance null for Flickr); `BUDGET_FRACTION = 0.8`; `USER_SHARE_FRACTION = 0.3`.
- Produces, in `budget.ts`:
  `monthKey(now: number): string` (UTC `YYYY-MM`);
  `monthEnd(now: number): number` (epoch ms of the first instant of the next UTC month);
  `budgetCap(product: BudgetProduct): number | null` (`Math.floor(allowance * 0.8)`, null when no allowance);
  `spendBudget(product: BudgetProduct, units?: number, now?: number): Promise<void>` throws `HttpError(429, "<label> is used up for this month. It resets on <date>.")` when the cap would be passed, `HttpError(503, ...)` when the store is unreachable; never throws for a product with a null cap (still counts);
  `getBudgetUsage(now?: number): Promise<{ product: BudgetProduct; label: string; used: number; cap: number | null; allowance: number | null; confirmed: boolean; resetsAt: number }[]>`;
  `mapLoadState(now?: number): Promise<"ok" | "warn" | "shared-off" | "all-off">` using the 70/80/95% thresholds on `mapbox-map-load` usage against its allowance (fail open to "ok" if the store is unreachable, since this only decides the display).
- Counter rows: key `budget:<product>:<YYYY-MM>`, `resetAt` = `monthEnd(now)`.

- [ ] **Step 1: Write failing tests** in `budget.test.ts`, names and assertions:
  - `monthKey rolls at the UTC boundary`: `monthKey(Date.UTC(2026,10,30,23,59,59))` is `"2026-11"`, `monthKey(Date.UTC(2026,11,1,0,0,0))` is `"2026-12"`.
  - `cap is 80% of the allowance`: `budgetCap("mapbox-map-load")` is `4000`; `budgetCap("mapbox-directions")` is `8000`; `budgetCap("flickr")` is `null`.
  - `spends up to the cap, then refuses`: with `mapbox-map-load` (cap 4000), `spendBudget(p, 4000)` resolves; `spendBudget(p, 1)` rejects with status 429.
  - `a spend larger than the whole cap is refused and not counted`: `spendBudget(p, 4001)` rejects 429 and usage stays 0.
  - `a new month starts at zero`: spend to the cap in November, then `spendBudget(p, 1, Date.UTC(2026,11,1))` resolves.
  - `parallel spends never pass the cap`: 50 parallel `spendBudget("mapbox-map-load", 100)` calls: exactly 40 resolve, 10 reject, and `getBudgetUsage()` reports `used === 4000`.
  - `flickr is counted but never refused`: 10 spends resolve; usage `used === 10`, `cap === null`.
  - `mapLoadState thresholds`: with used 0 returns "ok"; 3500 (70%) returns "warn"; 4000 (80%) returns "shared-off"; 4750 (95%) returns "all-off". (Spend the counter directly in the test's DB setup, since 4750 exceeds the 80% cap.)
- [ ] **Step 2:** Run `npx vitest run src/server/budget.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `budget-config.ts` with the allowances from Global Constraints (`confirmed: true` for Map loads, Directions, Matrix; `false` for Geocoding and Static Images; sources: Mapbox signup docs `https://docs.mapbox.com/accounts/guides/signup/`, checked 2026-11-23).
- [ ] **Step 4:** Implement `spendBudget` as one raw SQL statement: `INSERT ... ON CONFLICT ("key") DO UPDATE SET "count" = "count" + units WHERE "count" + units <= cap RETURNING "count"`; no returned row means refused. Refuse up front if `units > cap`. Use `prisma.$queryRaw` like `shared-limit.ts`; a thrown DB error becomes the 503.
- [ ] **Step 5:** Implement `getBudgetUsage` and `mapLoadState` (read rows with `prisma.rateLimitCounter.findMany`, key prefix `budget:`).
- [ ] **Step 6:** Run the test file again. Expected: all PASS.

### Task 2: Count Mapbox server calls

**Files:**
- Modify: `src/server/external/mapbox.ts` (the `getJson` helper at ~line 38 and each caller: `getDirections`, `getDurationMatrix`, `geocode`, `locateArea`, `locateLandmark`, `searchPlaces`, `retrievePlace`, `reverseGeocode`)
- Test: `src/server/external/mapbox.test.ts` (extend; check how it injects `fetchImpl` today)

**Interfaces:**
- Consumes: `spendBudget`, `BudgetProduct` from Task 1.
- Produces: `getJson<T>(url, fetchImpl, unreachable, spend: { product: BudgetProduct; units: number })` calls `await spendBudget(spend.product, spend.units)` immediately before the fetch. Products: Directions -> `mapbox-directions` 1; Matrix -> `mapbox-matrix` `coords.length * coords.length`; every geocoding call (geocode, locateArea, locateLandmark, searchPlaces, retrievePlace, reverseGeocode) -> `mapbox-geocoding` 1.

- [ ] **Step 1: Write failing tests**:
  - `a cached directions call does not spend budget`: two identical `getDirections` calls with an injected fetch spend 1 unit total.
  - `matrix with 25 stops spends 625 units`.
  - `a refused budget throws a 429 HttpError, not ExternalServiceError`: set the `mapbox-directions` counter to its cap in DB setup, then `getDirections` rejects with `HttpError` status 429 and the injected fetch was never called.
  - `store outage refuses with 503`: make the budget store throw (mock `spendBudget` or the prisma client as the sibling tests do); the call rejects 503 and fetch is not called.
  - `fake external mode spends nothing` (`isFakeExternal()` true: usage stays 0).
- [ ] **Step 2:** Run `npx vitest run src/server/external/mapbox.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement the `getJson` signature change and pass `spend` from each caller, after its cache check and after the fake-external early return (do not move those).
- [ ] **Step 4:** Check each of the seven routes/pages that import `external/mapbox` (`src/app/api/{directions,locate,optimize,reverse-geocode,geocode,geocode/retrieve}/route.ts`, `src/app/s/[token]/page.tsx`): a `HttpError` thrown by `spendBudget` must reach the client as its own 429 message, not be swallowed by a catch that maps all errors to 502 or hides it; fix any such catch to rethrow `HttpError`, and add a route-level test for `/api/directions` returning 429 with the message.
- [ ] **Step 5:** Run `npx vitest run src/server src/app/api`. Expected: PASS.

### Task 3: Per-user share and owner exemption

**Files:**
- Modify: `src/server/budget.ts`; the six routes above that call `enforcePaidLimit` (add one line beside it); `.env.example`
- Test: `src/server/budget.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 exports; `prisma.user` for the owner lookup.
- Produces: `spendUserShare(product: BudgetProduct, userId: string, units?: number, now?: number): Promise<void>`: counts key `budget-user:<product>:<YYYY-MM>:<userId>` against `Math.floor(cap * 0.3)`, throws `HttpError(429, "You have used your share of <label> for this month. It resets on <date>.")`; returns immediately for the owner and for products with a null cap; `isOwner(userId: string): Promise<boolean>` (compares the user's email to `process.env.OWNER_EMAIL`, case-insensitive; false when `OWNER_EMAIL` is unset or empty; result cached per server instance for 5 minutes).

- [ ] **Step 1: Write failing tests**: a normal user is refused after 30% of the cap (`mapbox-directions`: 2400 of 8000) and a second user is not affected; the owner (user whose email equals `OWNER_EMAIL`) is never refused; with `OWNER_EMAIL` unset nobody is exempt; email comparison ignores case; a different month starts at zero.
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3:** Implement `spendUserShare` (same conditional-upsert statement as Task 1, with the user key) and `isOwner`.
- [ ] **Step 4:** In each of the six routes, add `await spendUserShare(<product>, userId, <units>)` right after the existing `enforcePaidLimit` line (Matrix units for `/api/optimize`: the stop count squared, as in Task 2; read the route to find that count). Add `OWNER_EMAIL` to `.env.example` with a one-line comment.
- [ ] **Step 5:** Run `npx vitest run src/server src/app/api`. Expected: PASS.

### Task 4: Flickr monthly counter

**Files:**
- Modify: `src/server/external/flickr.ts` (`flickrBudgetLeft`, ~line 31)
- Test: `src/server/external/flickr.test.ts` (extend)

**Interfaces:** Consumes `spendBudget("flickr")`.

- [ ] **Step 1: Write failing test**: after a successful `flickrBudgetLeft()` the `flickr` usage is 1; when the hourly budget is spent (returns false) the monthly counter is not incremented.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** In `flickrBudgetLeft`, call `await spendBudget("flickr")` only when the hourly result is ok, and swallow a store error there (Flickr already degrades rather than failing).
- [ ] **Step 4:** Run `npx vitest run src/server/external`. Expected: PASS.

### Task 5: Ping route and client pings

**Files:**
- Create: `src/app/api/usage/ping/route.ts`
- Modify: `src/server/rate-limit.ts` (add policy `"usage-ping": { limit: 30, windowMs: MINUTE, message: "Too many requests. Slow down a little." }`), `src/components/editor/MapPanel.tsx` (map creation effect, ~line 201), `src/lib/itinerary-download.ts` (before `loadMapImage`, ~line 90)
- Test: `src/app/api/usage/ping/route.test.ts`, `src/components/editor/MapPanel` test file if one exists (else test the ping helper)

**Interfaces:**
- Produces: `POST /api/usage/ping` with JSON body `{ kind: "map-load" | "static-map" }`; success `204`; maps `map-load` -> `mapbox-map-load` and `static-map` -> `mapbox-static-image`, each 1 unit via `spendBudget`; a budget refusal returns that 429 (map-load ping refusal is ignored by the client). Uses `assertSameOrigin`, `readJson`, `handle` from `src/server/http.ts` and `enforceSharedLimit("usage-ping", clientIp(req.headers))`. No sign-in required (public share pages load a map). Client helper `sendUsagePing(kind): Promise<boolean>` in `src/lib/usage-ping.ts`, true unless the response is 429.

- [ ] **Step 1: Write failing tests**: unknown kind -> 400; missing/foreign Origin -> rejected as `assertSameOrigin` does elsewhere; the 31st ping in a minute from one address -> 429; a `map-load` ping spends 1 unit of `mapbox-map-load`; a `static-map` ping spends `mapbox-static-image`; `sendUsagePing("static-map")` returns false on a 429 and true on 204.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the route, the policy and `sendUsagePing`.
- [ ] **Step 4:** In `MapPanel.tsx`, send one `map-load` ping right after `new mapboxgl.Map(...)` succeeds, guarded by a ref so React strict-mode double effects send one ping per real map start; ignore the result and failures. In `itinerary-download.ts`, `await sendUsagePing("static-map")` before fetching the static image; if it returns false, skip the map image the same way a failed image load already does (the PDF still downloads without a map).
- [ ] **Step 5:** Run `npx vitest run src/app/api/usage src/components/editor src/lib`. Expected: PASS.

### Task 6: Map state in the pages

**Files:**
- Modify: `src/app/trips/[id]/page.tsx`, `src/app/s/[token]/page.tsx`, and the components that render `MapView` / `MapPanel` (trace from `src/components/editor/MapView.tsx`, `src/components/share/SharedTripView.tsx`, the trip editor) so a `mapAllowed` prop can switch to the existing `onUnavailable` fallback; one small banner component under `src/components/ui/`
- Test: extend `src/app/s/[token]/page.test.tsx` and the nearest editor test

**Interfaces:**
- Consumes: `mapLoadState()` from Task 1.
- Produces: the shared page passes `mapAllowed = state === "ok" || state === "warn"`; the signed-in trip page passes `mapAllowed = state !== "all-off"`; at `"warn"` and above a signed-in user sees a short banner ("Map usage is high this month; the map may pause until it resets"); the fallback shown when `mapAllowed` is false is the existing no-WebGL fallback (the offline preview), with a one-line note saying why. If the shared page has no readable non-map view, build a simple stop list there.

- [ ] **Step 1: Write failing tests**: with `mapLoadState` mocked to `"shared-off"` the shared page renders the fallback and no map container, and the signed-in trip page still renders the map; at `"all-off"` neither renders the map; at `"warn"` the signed-in page shows the banner; at `"ok"` no banner.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the prop plumbing and banner.
- [ ] **Step 4:** Run `npx vitest run "src/app/s" "src/app/trips" src/components`. Expected: PASS.

### Task 7: Owner usage page

**Files:**
- Create: `src/app/settings/usage/page.tsx`
- Test: `src/app/settings/usage/page.test.tsx`

**Interfaces:** Consumes `getBudgetUsage`, `isOwner`, `getCurrentUserId` (`src/server/session.ts`). A non-owner (including signed-out) gets `notFound()`.

- [ ] **Step 1: Write failing tests**: a signed-out visitor and a non-owner user get a not-found result; the owner sees one row per product with used, cap, percent, allowance, an "unconfirmed" marker where `confirmed` is false, and the reset date.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the page as a server component, styled like `src/app/settings/page.tsx`; add a link to it from the settings page only when `isOwner` is true.
- [ ] **Step 4:** Run `npx vitest run src/app/settings`. Expected: PASS.

### Task 8: Docs, privacy review, handoff

**Files:** Modify `README.md`, `docs/HANDOFF.md`, `src/app/privacy/page.tsx`, `src/components/legal/LegalPage.tsx` (`LEGAL_UPDATED`) as the review requires.

- [ ] **Step 1:** README: a "Monthly API budgets" section: the allowances table, the 80% rule, what happens at each threshold, `OWNER_EMAIL`, the usage page path, and the dashboard checklist for what code cannot cap (Mapbox: restrict the public token to the site's URLs and turn on usage emails; Turso: usage alerts for rows read/written and storage; Vercel: usage alerts). Add a note that a 10-stop Optimize costs 100 Matrix elements, so the 8,000 cap allows about 80 such runs a month.
- [ ] **Step 2:** Do the legal review required by `CLAUDE.md` (a new client ping and per-user monthly counter rows keyed by account id are new data); update the privacy page and `LEGAL_UPDATED` only to match what the code does; run `npx vitest run src/app/legal-pages.test.tsx src/app/privacy`.
- [ ] **Step 3:** Update `docs/HANDOFF.md` per the global rules (board rows, current work, owner follow-ups: confirm Geocoding and Static Images allowances from the Mapbox dashboard, set `OWNER_EMAIL` in Vercel, switch on the dashboard alerts); say that nothing is committed.
- [ ] **Step 4:** Run `npx tsc --noEmit` and `npx eslint src scripts e2e tests` and the full `npx vitest run` alone. Expected: PASS; report any failure plainly.
