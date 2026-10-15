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
- [ ] Set `CRON_SECRET` in Vercel (any long random string) so the daily photo-cleanup cron works; without it the route does nothing.
- [ ] Turn on Sign in with Google: create an OAuth client in Google Cloud Console (redirect URI `https://photo-app-pi2o.vercel.app/api/auth/callback/google`), then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel. The button stays hidden until both are set. Not testable end to end locally (unit tests only).
- [ ] Use a separate unrestricted server Mapbox token (`MAPBOX_TOKEN`); URL-restrict the public `NEXT_PUBLIC_MAPBOX_TOKEN`; set a Mapbox spend cap.
- [ ] Rotate Vercel Blob credentials and restrict them to Production.
- [ ] Delete the duplicate empty Vercel project `photo-app`.
- [ ] Replace the GitHub-issues contact link (`CONTACT_URL` in `src/components/legal/LegalPage.tsx`).
- [ ] Get legal review of the privacy and terms pages.

## Known gaps
- [ ] Suggestion quality: the local places table has no OSM tags, so memorial/bench/wikidata tags cannot be used yet. Add `wikidata`, `memorial` and `access` to the extract script (`scripts/extract-places.py`), rebuild and re-import, then filter and boost on them. Until then dedication-style names are filtered by name only.
- [ ] Optional: a free Flickr API key (`FLICKR_API_KEY`) still gives the strongest photo counts; without it Wikipedia notability plus Commons counts are used.
- [ ] Google accounts are never auto-linked: an existing password account with the same email must keep using its password.
- [ ] Must-have priority is a heavy weight, not a hard block.
- [ ] Optimize with light preferences can pick its own start time.
- [ ] No email verification; signup email enumeration (409).
- [ ] CSP still allows `'unsafe-inline'`.
- [ ] Share page `no-referrer` vs a URL-restricted Mapbox token.
- [ ] Offline copies persist until sign-out.
- [ ] Rate limits other than login/signup/password/delete are per instance (see README); no monitoring or alerting yet.
- [ ] `updateTrip` find-then-update is not atomic.
- [ ] Playwright timezone is not pinned for specs other than the hydration one.
- [ ] Skills in `.agents/skills` reference plugin commands that are not installed (prompt-audit findings).
