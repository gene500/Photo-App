# P3 findings: browser testing

Run against the dev e2e server (fake externals, fresh SQLite) plus one production build for CSP and service-worker checks. Chromium got the full matrix; WebKit and Firefox got the viewport checks, interactions and offline. Real Mapbox, Overpass, weather, Wikimedia, Flickr, NPS and Google sign-in were NOT available, so the fake map (not Mapbox GL) was used.

## Bugs (reproduced)

| ID | Sev | Area | Repro | Expected vs actual | Suspected root cause | Screenshot |
|---|---|---|---|---|---|---|
| P3-001 | medium | Editor layout, phone portrait with keyboard | 390x844, tap search, shrink viewport height to 340, type "yos" (3 of 3 in Chromium) | Portrait bottom sheet stays, search full width. Actual: width 390 > height 340 makes `orientation: landscape` true, layout flips to the side panel, search shrinks to 86 px and results wrap one word per line | `src/app/globals.css:4` short-landscape variant `(orientation: landscape) and (max-height: 500px) and (max-width: 1023px)`; mirrored in `src/lib/short-landscape.ts` | p3-001-390x340.png |
| P3-002 | low | Tap targets | 3 stops at 375x667, 390x844, 768x1024, touch emulation (3 viewports, 3 browsers) | 44 px expected. Markers and zoom-to-fit 32x32; stop-name buttons 36 high; visited checkbox 20x20 in a 28x28 label; settings radios 24x24; footer links 24 high | fixed sizes without a touch variant | p3-002-375x667.png, p3-004-390x844.png |
| P3-003 | low | Editor header, long names / big text | 120-char name at 375x667, or text size Extra large (2 of 2) | Name clamps to 3 lines; header takes about half the sheet; no overflow | intended line clamp plus sheet header that does not shrink | p3-003-375x667.png, p3-003-dark-xl-375x667.png |
| P3-004 | low | A11y, stop edit drawer | Add a note, save, reopen, inspect `textarea.labels` (2 of 2) | Label exposed as "Noteshi": label text includes the textarea's own text | label wraps the textarea, probably `src/components/editor/StopDrawer.tsx` | none |

## By design (verified)

25-stop cap per trip (API 400, UI disables Add stop), 20 shots per stop, "Midday" on My trip is the best-light time.

## Observed OK (summary)

Auth validation, errors, open-redirect attempts, session expiry, sign-out-all; trips CRUD with hostile names (script, quotes, emoji, RTL); no horizontal overflow at 375, 390, 768, 1440 on every page; editor search, map add, rename, delete, reorder validation, polar and antimeridian coordinates, photo upload rules (JPEG/PNG/WebP only, 5 MB cap, fake files rejected, uploads need a session), visited ticks, optimize incl. polar note; share link logged out (X-Frame-Options DENY, no-store, noindex, owner notes hidden), revoke, GPX (escaped), Apple/Google links, PDF; mocked 401/404/429/500/HTML 500/bad JSON/empty JSON/abort/hang on 12 routes all gave readable messages with no blank screen or stuck spinner; denied geolocation degraded cleanly; production CSP pages had zero console errors; offline page works in production.

## Unconfirmed suspicions

1. `POST /api/trips` accepted `Content-Type: text/plain` (reached field validation). SameSite=Lax probably prevents cross-site use; not tested cross-site.
2. Portrait bottom sheet has no `env(safe-area-inset-bottom)` padding and there is no viewport-fit export; may sit under the iPhone home indicator when installed. Needs a real device.
3. Real Mapbox marker fan-out with 25 stops, antimeridian route line, polar points: untested.
4. In-memory and login/signup rate limits untested (e2e server disables them).
5. Add stop with a hung request shows no pending state for up to 20 s; a double tap may send two POSTs.
6. DELETE stop with a server 404 shows no message.

## Not tested

Real map services, Google sign-in, lockout, change-password and delete-account UI, real touch gestures and iOS keyboard, real PWA install, hike/alternatives/parking flows beyond failure injection (weather and access mocks never fired), dark-mode visual correctness, the full failure matrix on WebKit and Firefox.
