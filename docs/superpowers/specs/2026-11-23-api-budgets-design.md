# API budgets (stay at or under 80% of each free tier) design

Date: 2026-11-23. Status: draft, awaiting owner approval.

## Intent and why

The owner has entered no payment method with any provider, so nothing can bill them, but going over a free tier would break the app instead (Mapbox refuses requests, Turso fails queries, Vercel Hobby pauses the project). The owner wants "no bills, no abuse, and my account at 80% of the total usage each API gives". Read as: the app must never use more than 80% of each provider's monthly free allowance, and no single user or bot may use up the budget.

## Goals

- Monthly counters, per provider and product, shared across server instances (in the existing shared database), that stop or degrade the feature at 80% of the verified free allowance.
- Covers every metered thing the app calls: Mapbox Geocoding (search + retrieve + reverse), Mapbox Directions, Mapbox Matrix, Mapbox map loads (counted by a small client ping each time the map starts), Flickr (already has an hourly app-wide budget; add a monthly view).
- An owner-only usage page showing each provider's use against its 80% line and the month's reset date.
- A per-user share so one account cannot spend the whole monthly budget.
- A checklist (docs only) of the dashboard alerts to switch on for what code cannot cap: Turso rows read/written/storage, Vercel usage, Mapbox token URL restriction.

## Non-goals

- Capping Turso or Vercel usage from code.
- Paid plans, billing, or payment handling.
- Changing the existing per-minute per-user rate limits.

## Anti-goals

- A counter outage must not silently allow unlimited paid calls: paid routes keep failing closed (503) when the shared store is down, as today.
- Counting must not noticeably slow routes or add a database write per map tile.
- No secrets (Mapbox `pk.` token, `TURSO_*`) printed or committed.

## Constraints

- Existing shared counter: `src/server/shared-limit.ts` (`hitShared`, `RateLimitCounter` table: key, count, resetAt) and `POLICIES` in `src/server/rate-limit.ts`, with the Flickr hourly budget `flickr-app` as the pattern for "spent, then degrade". Follow those patterns.
- Mapbox free allowance without a payment method (per Mapbox's signup docs, to be confirmed on the owner's dashboard): 5,000 web map loads; Directions 10,000; Matrix 10,000 elements. Geocoding is not confirmed. Turso free: 500M rows read, 10M rows written, 5 GB. All allowances live in one config file with the source and the date checked beside each number.
- Browser map loads go straight to Mapbox, so the count is approximate (ad blockers and failed pings miss loads).
- Privacy pages must be reviewed if a new stored field or client ping is added (project rule in `CLAUDE.md`).

## Approaches considered

- **A. Counters in the app plus map-load counting (picked).** Server-side monthly counters at 80%, a ping to count map loads, usage page, per-user share, dashboard checklist.
- **B. A plus a hard stop on the map past 80%.** Safest for the map's small allowance, but the whole app loses its map for the rest of the month.
- **C. Provider settings only.** Token URL restriction and usage emails; no enforcement of 80%.

Owner chose A on 2026-11-23.

## Decisions made

- Approach A. Limit = 80% of each verified allowance, per calendar month (UTC).
- No payment method on any provider, so exceeding the free tier breaks the app rather than billing.

## Open for the owner (see "Facts and calls" below)

- What the map does at 80% of map loads under approach A (see the call below).

## Facts and calls (assistant's, not agreed with the owner)

- Month window is the calendar month in UTC (Mapbox's own window is a calendar month); counters are rows in `RateLimitCounter` keyed `budget:<provider-product>:<YYYY-MM>`.
- At 80%, Geocoding, Directions and Matrix refuse with a clear "monthly budget reached" message (HTTP 429 with a message, not 503). Flickr falls back to Commons as today.
- Per-user share: one account may use at most 30% of a provider's monthly budget.
- Map loads past 80%: the owner's usage page and a banner warn from 70%; at 80% pages that anyone can open without signing in (shared `/s/[token]` trip links) stop starting the interactive map and show the stop list instead; signed-in users keep the map until 95% so the owner is not locked out of their own app. This departs from a strict 80% for signed-in use, so it is the owner's call.
- The owner is identified by an `OWNER_EMAIL` environment variable matched to the signed-in account's email (new env var; document it in `.env.example`).

## Added after the builder check

Checked in the code:
- Mapbox Static Images (`src/lib/static-map.ts`, used by `src/lib/itinerary-download.ts`) are fetched from the browser with the token, so they are a metered product that bypasses the server, like map loads.
- `sweepSharedLimits` deletes rows whose `resetAt` has passed, so a monthly row (resetAt = end of the month) survives until the month ends.
- Credentials sign-up has no email verification (only Google sign-in checks `email_verified`).
- The shared page `src/app/s/[token]/page.tsx` has no obvious stop-list view without the map; building a simple one is part of this work if it does not exist.

Calls (assistant's, not agreed with the owner; the owner can override any):
- Static Images count like map loads, through the same client ping, with their own row and a placeholder allowance until the owner confirms it from the Mapbox dashboard.
- Reserve before the call: a request is counted first and refused if it would pass the cap. Matrix counts elements (origins x destinations), not requests. A cached or failed call is not refunded.
- The monthly counter is a new variant of `hitShared`: key per month, limit from the allowances config, no in-memory layer, not affected by `RATE_LIMIT_DISABLED` in production.
- The 30% per-user share is 30% of the 80% cap. The owner account is exempt. Calls with no account (public pages) count only toward the provider total, with the existing per-IP limits as the abuse guard; the map-load ping gets its own per-IP limit (30 per minute), and a spammed ping inflating the count is an accepted risk.
- Unconfirmed allowances (Geocoding, Static Images) ship with a conservative placeholder, 80% of 10,000 (the lowest figure seen), until the owner supplies the real number.
- `OWNER_EMAIL` must match an existing account. Because credentials sign-up does not verify email, the owner must already have signed up with that address (nobody else can then register it); the usage page also requires being signed in.
- Flickr's monthly view is a new monthly counter beside the existing hourly `flickr-app` budget, which stays as is.

## Left to the builder

- Exact module names and file layout; the config file for allowances; how the client ping is sent (beacon vs fetch) and debounced so one page view is one load.
- How to read Mapbox's real usage from its dashboard figures if the owner supplies them.
- Usage page design; the checklist wording.
- Tests: counter month rollover, 80% boundary, per-user share, fail-closed when the store is down.
