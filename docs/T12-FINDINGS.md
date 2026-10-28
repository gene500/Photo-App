# T12 findings (10 Sonnet testers, 2026-10-27, HEAD f9e5986)

Testers change no code. Tick an item when F9 fixes it (or mark it "owner: leave").

## a1: auth and accounts (done; no High or Medium)
- [ ] **Low** Login accepts a password longer than 72 bytes when the first 72 bytes match (bcrypt truncation; signup caps at 72). `src/server/auth.ts`, `verifyCredentials` in `src/server/users.ts`. Nothing exploitable.
- [ ] **Low** Signup trims a trailing newline from an email ("a@b.co\n" is stored as "a@b.co"). Probably fine.
- [ ] **Polish** Stock NextAuth pages `GET /api/auth/signout` and `/api/auth/verify-request` are reachable and unstyled.
- Covered and fine: signup/login validation, callbackUrl, signed-out access to all pages and 41 API routes, change password, delete account (everything removed), two contexts, rate limits, legal pages at 320 px. Not covered: Google sign-in, HTTPS cookie flags, reauth-window delete.

## a2: trips page and settings (done; no High or Medium)
- [ ] **Low** Trip names unreadable on /trips at 320 px with Large or Extra large text ("WW…", "🏔️ A…"): `truncate` beside a fixed 48 px date stub in `TripList.tsx`; no tooltip on touch.
- [ ] **Low (design call)** A 120-character trip name fills the whole bottom sheet on phones, pushing Edit/Export/Share and stops below the fold (`TripHeader.tsx` deliberately never cuts the name).
- [ ] **Polish** Trips backdrop (`TripMapBackdrop.tsx`, `preserveAspectRatio="slice"`) scales with page height: 100 trips shows blobs only; phones show 5 to 7 of 12 pins; fully visible only near 16:10. (Matches the open question about showing more route on phones.)
- [ ] **Polish** One-off hydration-mismatch console error, not reproduced in 4 retries.
- [ ] **Polish** Double-clicking a trip's Delete opens then closes the dialog.
- Covered and fine: trip name/date validation, time zones, DST, rename/delete incl. stale and offline, settings live across tabs, corrupt storage, no overflow at 320/375/568/1280 with XL text and dark. Not verified: PDF contents under each setting, map style.

## a4: reorder, visited, optimize (done; no bugs reproduced)
- [ ] **Polish** On a phone at the half-height sheet (list scroller about 152 px), dragging a row upward past the scroller's top edge autoscrolls to the top and drops the row far away (60 px drags are fine). `StopList.tsx` DndContext.
- [ ] **Polish (by design?)** With "priority" focus and arrival after dusk, Optimize can choose a longer drive to reduce dark minutes (A31 weighting); "time" focus gives the shortest.
- [ ] **Polish (dev only)** Next dev overlay badge intercepts pointer events at the bottom-left on a phone.
- Covered and fine: drag/keyboard reorder incl. cancel, visited cascade with delayed responses, Optimize + Undo, "Already the fastest", offline, two tabs, route-flow data attribute (about 2.9 s), hike line with reorder/delete. Zoom-to-fit not visible on the fake map.

## a3: adding and editing stops (done; one Low)
- [ ] **Low** A lone UTF-16 surrogate in the search box crashes the editor ("This page couldn't load"): `encodeURIComponent` throws `URIError` synchronously in `api.geocode` (`src/lib/api-client.ts` about line 127), called from the `useEffect` in `SearchBar.tsx`, so the `.then` handlers never catch it. `retrievePlace`, `locate` and `placePhoto` use `encodeURIComponent` the same way. Needs a lone surrogate to get in (rare). Stop names are not affected.
- [ ] **Polish** A valid PNG named `.jpg` is refused ("File contents don't match an allowed image type").
- [ ] **Polish** Swapping in an alternative keeps notes but drops the reference photo.
- [ ] **Polish** Enter in the drawer Name field does not save.
- [ ] **Polish** Place card stays open after the 400 at the 25-stop cap (matches an unticked F2 item).
- Editing Time after Optimize clears the route line ("Your stops changed"): judged intended.
- Covered and fine: search edge cases, map-click add, double adds, 25-stop cap with two tabs, drawer fields and photo uploads with odd files, delete in all positions, two tabs, thumbnails, 320 px RTL layout, photo access by other users.

## a5: map features (done; one Low)
- [ ] **Low** On phone and short-landscape widths (375x667, 667x375) the selected-stop card covers the Zoom to fit button (fake map: `.zoom-fit-fake` at about y=122; desktop is fine). Related to, but different from, the known card-over-fanned-marker item. Check the real map's `.zoom-fit-ctrl` position against the card too.
- [ ] **Polish** Dev-only hydration mismatch on the search input (`caret-color: transparent` only on the client).
- [ ] **Polish** In dark mode the fake map stays beige (fake only).
- [ ] **Polish (maybe offline area)** Offline reload of a trip page with a stale local copy showed "Skip to content | Saved trips | Try again".
- Marker drag is not supported by the fake map, so it was not tested.
- Covered and fine: fanned stacks of 5, select by click/Enter/Space, zoom-to-fit counts, route line and sun lines, hike toggle with optimize/reorder/delete, units, delete, viewports 320 to 1920.

## a6: suggestions (done; one Medium-Low, one Low)
- [ ] **Medium-Low** A failed or offline "Find photo spots" wipes the existing list and its saved copy. Steps: 4 stops, Find (3 cards), go offline, Find again: 0 cards and the sessionStorage entry is gone (Retry brings the 3 back online). Suspect `TripEditor.tsx` `findSuggestions` (about lines 995-1008) sets `items: []` for "loading" then "error"; the save effect (about 359-362) calls `removeSuggestions` for any status other than "done". Expected: keep the old list with the error and Retry.
- [ ] **Low** A reload during popularity ranking freezes a half-ranked list (saved list had 10 of 12 popularity values; `restored` skips `popularityKey` at about line 380, so ranking never resumes). `saveSuggestions` runs on every `done` update, including partial ones.
- [ ] **Polish** Delete every stop with a list showing: old cards stay with "Suggestions need a route first." above them, and Accept still works (contradictory).
- [ ] **Polish (untested)** "Clear saved offline copies" and sign-out clear only the current tab's sessionStorage.
- Covered and fine: Find states, batch reveal, Accept/Dismiss, repeated Find, 0/1/25 stops, offline Accept, two trips in two tabs, stale and corrupt saved lists, weather on cards, hover popup. No filters or sorting exist in the UI.

## a7: My trip tab (done; one Low-Medium)
- [ ] **Low-Medium** With exactly 2 stops, Optimize ignores light. Steps: 2-stop trip, stop 1 Best light "sunrise", stop 2 "sunset", default start (now, e.g. 19:46), Optimize. Expected: like 3+ stops (start moves to a good-light time, note "Can't fit N stops in their light"). Actual: start stays 19:46, rows show "Misses sunrise by 11 h 47 min" / "Misses sunset by 2 h 30 min", no note. Cause: `TripEditor.tsx` about line 704, `if (tail.length < 3)` only records the optimized state; the start-time search is skipped too. The same trip with a third stop moves the start to 08:08.
- [ ] **Polish** A trip opened in another time zone shows "Midday · 4:42 AM" (Tokyo): label is the stop's solar time but the clock is the viewer's; the Start time field is also in the viewer's zone. Looks deliberate, but label and clock disagree.
- [ ] **Polish** `hikeShownIds` in `TripEditor.tsx` keeps ids of deleted stops (no visible effect).
- Covered and fine: weather (near, typical, 400 days out, past, 500, aborted), hike line and units, totals, start time (Enter/blur, empty, reset, change date then Optimize), Priority control. Not covered: switching units while rows are open, the "nps" attribution (fake returns OSM only), offline reconnect on this tab, phone widths.

## a8: export and share (done, partial pass; no High or Medium)
- [ ] **Polish** A shared trip with a long name and 25 stops at 320x700: the header (5 map links, 5-line title) squeezes the stop list to about 60 px (`SharedTripView.tsx` header and aside; header not collapsible).
- [ ] **Polish (feature idea)** GPX and map links always include visited stops; no "remaining stops only" option.
- [ ] **Polish (untested in two tabs)** Share state in the editor is local: a link revoked in another tab still shows active until reload (`ShareControl.tsx`).
- Covered and fine: GPX validity and escaping, Apple/Google links incl. 25-stop split, PDF for 8 and 25 stops, double-click Download, share create/copy/revoke/recreate, malformed tokens, nothing private on the public page (no notes, email, ids), response headers, 0/1/25 stops at 320 and 1280 in both themes, PDF dialog Escape and focus. Emoji/Arabic print "?" (known).
- Not covered: offline PDF after a first PDF, units/time-format in the PDF, CJK or mixed PDF, weather in the PDF, hike on the share page, 640 to 1000 px widths.

## a10: offline/PWA and cross-user security (done; no High or Medium, nothing leaks)
- [ ] **Low** In the trip editor, going offline shows no offline indicator; a banner appears only after an action fails ("You're offline or the server can't be reached. Try again.").
- [ ] **Low** That error banner stays after reconnecting; only the x clears it (likely TripEditor's error state).
- [ ] **Polish** `autoFirstStop:<tripId>` (localStorage) and `rtpp.panel.v1:/trips/<id>` (sessionStorage) survive sign-out and a second user's login (ids and a flag only).
- Verified: IDOR on every trip/stop/share/photo/reorder route (404/409), uploads 404/401/traversal, bad input (400/413/405, cross-site POST 403), /api/hike validation and 429, CSP with per-request nonce, cookies httpOnly + SameSite=Lax, service worker v3 cache contents and v2 cleanup, offline copy fallback and XSS-safe rendering, corrupt/tampered offline storage, sign-out and second-user isolation, Clear saved offline copies.
- Not covered: browser checks of photo upload/cleanup, stale-copy conflicts beyond reconnect, offline PDF export, a manual drive of Optimize/weather.

## a9: layout, responsive, accessibility (done; no real bugs)
- [ ] **Polish** The share page's aside has no accessible name (the editor's is "Trip panel").
- [ ] **Polish** At 320 wide with Extra large text the Suggestions tab wraps below the fold of the half sheet and the header title wraps to two lines.
- [ ] **Polish** At 568x320 with Extra large text the search placeholder is clipped ("Search for a plac").
- Small tap targets (32 to 37 px) are known. The share page Download PDF looked greyed at first load (not checked whether disabled or loading).
- Covered and fine: no horizontal overflow on 7 pages at 6 viewports (both themes, XL text), share page, reduced motion, bottom sheet states and rotation, popover and dialog focus handling, reorder announcements, contrast in both themes, tab order.
- Not covered: 375x667, 667x375, 1024x768, 1920x1080 sweep, 200 percent zoom directly, /offline with a saved copy, selected card vs controls per viewport, add/optimize announcements.

---
## Triage for F9 (2026-10-27): 10 of 10 testers reported; no High, no Medium. Fix now:
1. a6 Medium-Low: failed/offline Find must keep the existing list (and its saved copy) and show error + Retry.
2. a7 Low-Medium: Optimize with exactly 2 stops must also search the start time for light.
3. a3 Low: lone surrogate in the search box must not crash the editor (guard all `encodeURIComponent` calls in `api-client.ts`).
4. a6 Low: do not save a partly ranked list; after restore, resume/finish popularity ranking or save only complete lists.
5. a10 Low: the offline error banner clears on reconnect (or on the next successful action).
6. a5 Low: the selected-stop card must not cover the Zoom to fit button on phone / short-landscape (fake map and real control).
7. a2 Low: trip names readable on /trips at 320 px with Large/Extra large text (wrap to two lines instead of one-line truncation).
8. a1 Low: login rejects passwords over 72 bytes (signup already does).
9. a9 polish: accessible name for the share page aside.
## Left for the owner (not fixed in F9)
Editor offline indicator (new feature), 120-character names filling the phone sheet (design choice), trips backdrop showing more route on phones, GPX/links "remaining stops only", NextAuth stock pages, hikes/time-zone label wording, other polish above.
