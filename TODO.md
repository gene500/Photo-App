# TODO

## Waiting on a decision
- [ ] Commit and push the current batch (start-time default, Apple Maps stops, stop priority, hover-card fix). The push runs a new migration (`20261014120000_stop_priority`) on the live Turso database.
- [ ] Share link opens the app's generic page and not the shared trip (reported 2026-10-14). Not reproduced locally or in e2e; need the exact link behavior to continue.

## To verify by hand
- [ ] Apple Maps link with every stop, on a real iPhone (the multi-`daddr` format is unconfirmed).
- [ ] Google Maps link with every stop (up to 11 stops per link; longer trips split into parts).
- [ ] Hover photo card stays fully on screen in the Suggestions tab.
- [ ] Stop priority slider (Stops tab) and optimize behavior with a Must-have stop.
- [ ] Live site: sign-in, map, suggestions, photo upload, privacy/terms, account deletion, Imperial/Metric setting, Escape key, prewarm speed.

## Your accounts and settings
- [ ] Use a separate unrestricted server Mapbox token (`MAPBOX_TOKEN`); URL-restrict the public `NEXT_PUBLIC_MAPBOX_TOKEN`; set a Mapbox spend cap.
- [ ] Rotate Vercel Blob credentials and restrict them to Production.
- [ ] Delete the duplicate empty Vercel project `photo-app`.
- [ ] Replace the GitHub-issues contact link (`CONTACT_URL` in `src/components/legal/LegalPage.tsx`).
- [ ] Get legal review of the privacy and terms pages.

## Known gaps
- [ ] Must-have priority is a heavy weight, not a hard block.
- [ ] Optimize with light preferences can pick its own start time.
- [ ] Sign in with Google (later): needs a Google OAuth client in Vercel env, a nullable password hash migration, account linking by email, and a non-password confirmation for delete-account and change-password.
- [ ] No email verification; signup email enumeration (409).
- [ ] CSP still allows `'unsafe-inline'`.
- [ ] Share page `no-referrer` vs a URL-restricted Mapbox token.
- [ ] Offline copies persist until sign-out; orphaned Blob files if deletion fails.
- [ ] `updateTrip` find-then-update is not atomic.
- [ ] Playwright timezone is not pinned for specs other than the hydration one.
- [ ] Skills in `.agents/skills` reference plugin commands that are not installed (prompt-audit findings).
