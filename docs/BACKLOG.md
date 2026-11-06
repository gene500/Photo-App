# Backlog and known gaps

Moved out of `docs/HANDOFF.md`. Owner follow-ups that are not code, known limits, and the place-search notes.

## Place search (P1)

- Search bar uses the Mapbox Search Box API: `/api/geocode` (suggest, `{suggestions}`) then `/api/geocode/retrieve` (coordinates, `{place}`). POIs rank first. Details in the README "Place search" section.
- One uuid session per search, made in `SearchBar` by `newSessionId()` (`src/lib/session-id.ts`, falls back where `crypto.randomUUID` is missing) and renewed after every pick (including fallback picks) and whenever the search is cleared (Escape or deleting the text).
- If suggest fails, the v6 forward geocoder answers with coordinates already set. Fallback results are not cached, so landmarks come back as soon as suggest recovers. Suggest and retrieve results are cached 10 min in memory.
- Retrieve ids must be URL-safe, at most 300 characters, and contain a letter or digit (so `..` is rejected).
- Fake mode (`EXTERNAL_APIS_FAKE=1`): canned landmarks (Horseshoe Bend, Griffith Observatory, Yosemite Valley Viewpoint) plus the old fake address.
- Still owed: one smoke test against real Mapbox (confirms Search Box is enabled for the token and the real subtitle/category text).

## Waiting on the owner

| # | Task | Status | Notes |
|---|---|---|---|

## Backlog (from the old TODO.md; not started)

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
- `updateTrip` (src/server/trips.ts) reads the trip, then updates it outside one transaction (Opus L6, 2026-11-05). A date change from another tab in between can shift the start time from a stale date. Rare, own data only; accepted for now.
- `optimizeScheduleExact` and `scheduleCost` (src/lib/optimize-schedule.ts) are used only by tests, as oracles for the heuristic (Opus L8). Kept on purpose.
- `vercel-build` runs `scripts/migrate-turso.mjs` before `next build` (Opus L9), so a build that fails after the migration leaves the live database migrated while the old code stays live. Fine while migrations only add things; never ship a destructive migration in the same push as risky code.
- Optimizer tuning (A70): `DEFAULT_TUNING` in `src/lib/optimize-schedule.ts`; compare settings with `npx vitest run --config scripts/bench-optimize.vitest.mts` (env `CASES`, `MIX=1`, `ONLY=A,H`, `RESULT=<file>`). Road times in the benchmark are a model, so confirm on a real trip.

## T14 findings (2026-11-05, 10 testers; the owner approved all, fixed in F15 except what is listed under "Still open")

Still open after F15: item 9 (search for 9+ stops sometimes returns a worse order) could not be reproduced in 300 fuzz cases, so nothing changed; keep the exact failing trip if it shows up. The 200% text clipping, the 28 px Visited target and the light-hint orphan word were left alone. The shared page now shows visited stops on purpose (F15-11), so anyone with the link sees progress.

Original findings:

Medium:
- Phone zoom-fit: lowest stop sits on the bottom sheet's top edge, half hidden (MapPanel.tsx:118, bottom = 45% with no marker radius). Initial `fitBounds` (MapPanel.tsx:324) has no maxZoom, so stops within ~10 m zoom to ~22 (button path caps at 14).
- Drive budget (A70, driveBudgetRatio 1.3, overSlope 4) also trims High stops: 63 of 1500 realistic all-High trips lost over 10 min (worst 52); wider trips lost 100-840 min. Soft budget reached 1.38x on Normal-only 25-stop trips.
- Search for 9+ stops returns a clearly worse order (even a missed Must) about 1 in 60 trips (localSteps). 9-12 stop runtime 1-2 s on a loaded machine.
- Export menu runs off the bottom in the phone sheet peek state with a long trip name (menu scroll not checked).
Low: right-edge stop under map controls on phone; light hint orphan word on narrow cards; Visited target 28 px; date line clipped at 200% text and 320 px, top bar breaks at 200% text; Settings says "Time priority" but code/docs say "Time focus"; Must note still says must-have under Time focus; tiny Must miss (<30 s) accepted silently; tick then offline within 600 ms loses the re-plan; Undo stays visible after it can no longer restore; quiet auto runs can show notes ("Can't fit...", "Already the fastest order") (TripEditor.tsx ~807/825); `fixDeparture` returns a clamped departAt and is accepted without departAt; no wording when the search is cut short (complete:false); validation messages name the array index; stale comment at validation.ts:115 (trips cap at 25 stops); no test for the !VERCEL fake guard; shared page/PDF always show visited:false (SharedTripView.tsx:32) and the PDF omits priority/visited.
Not covered by any tester: real Mapbox map and times, hike and weather lines (fake mode), Start from my location UI, mobile print, two browser tabs.
