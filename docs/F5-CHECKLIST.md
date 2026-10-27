# F5 checklist (T8 findings)

## f2 (search and add stops) - no High/Medium; F4 fixes re-verified
- [x] L: offline error banner stays after a later add succeeds (TripEditor error state not cleared on success)
- [x] L: Escape does not close the place card when focus is on the page body/map (PlaceCard.tsx onKeyDown only on the card)
- [x] Polish: search box has no maxLength/counter (201+ chars gives a 400)
- [x] Polish: ArrowDown does not reopen the list after the first Escape
- [x] Polish: Add stop is not disabled in the place card when the trip already has 25 stops

## f3 (Optimize, Undo, start time) - F4 fixes re-verified except the first item
- [x] M: the F4 long-name fix does not work: optimize notice still 1045px wide at 1280 / 944px at 390 and is clipped (TripPlan.tsx ~62 optimize-status p; break-words does not shrink a basis-full flex-wrap item). Needs min-w-0 max-w-full [overflow-wrap:anywhere]; the class-only test passes though layout is broken - add a real check (browser)
- [x] L: keyboard-move announcement names the wrong stop (A,B,C,D move C up -> "Moved B to position 3 of 4"; should be "Moved C to position 2"); announceMove in TripEditor.tsx
- [x] Polish: error banners never clear after later successes (same as f2 offline banner item)
- [ ] Polish: Undo offline shows two identical banners side by side (still open: only a route-vs-stops duplicate is hidden; the exact cause was not reproduced)
- [x] Polish: Optimize with every stop visited gives no feedback
- [ ] Polish: optimize note stays after a visited tick/untick (known stale-note class) (still open: not touched)

## f4 (stop drawer) - no High/Medium; F4 fixes re-verified
- [x] L: Notes (and Shot notes) holding only a zero-width space are saved as invisible notes (StopDrawer.tsx save(), notes.trim() keeps U+200B; use hasContent)
- [x] L: Undo swap does not restore later stops' visited flags (VVV- -> swap -> V--- -> Undo gives VV--; swapNote.previous in TripEditor.tsx ~995-1010 holds only the swapped stop). Fix or tell the user the cascade is not undone
- [x] Polish: Undo swap after another tab deleted the stop shows raw "Stop not found" (undoSwap catch ~1009); use the friendly "deleted elsewhere" message
- Note: ticking Visited after a swap retires swap Undo - looks deliberate

## f1 (trips lifecycle) - nothing reproduced above Low; F4 fixes re-verified
- [ ] Polish: drawer save after the whole trip was deleted elsewhere says "This stop was deleted elsewhere" (trip is gone, not just the stop) (still open: not touched)
- [x] Polish: localStorage key autoFirstStop:<tripId> left behind after the trip is deleted
- [ ] Polish: offline banner persists after reconnect (same as f2/f3 banner item) (still open: the banner now clears after the next successful action, not on reconnect)

## f7 (settings and offline) - no real bugs; F4 fixes (skip link, multi-tab sign-in offline saving) re-verified
- [x] Polish: /offline always says "You're offline - showing your saved copy" even when online (check if intended)

## f6 (share and export) - verified in a real browser
- [x] M-L: Export menu still runs off the bottom on short phones (use-popover.ts fit() uses Math.max(room,160): 360x640 overflows 16px, 320x568 overflows 56px, 375x667 fits). Let the floor yield to real room or flip above the button. Share popover at 320x568 is fixed.
- [x] Polish: print of share page still shows Download PDF button and Apple/Google Maps links; dark theme print keeps the dark background (should print as plain ink on white)
- Verified OK: share page print shows all 25 stops, map hidden, no horizontal overflow; odd names escaped in share page and GPX; token handling and revoke fine.

## f5 (map) - no High/Medium; F4 fixes re-verified (aria-pressed, pending pin role=img, dark focus ring, sky lines)
- [ ] L: stops at identical coordinates overlap exactly; pointer click always selects the last one (FakeMapPanel.tsx; owner decision pending on clustering/offset)
- [x] L: Escape does not close the place card/stop card unless focus is inside the card (same as f2 item; also with a stop marker focused)
- [ ] L (known, owner decision): card covers the sheet header/Shrink at half on landscape and at full on phones; also covers the selected marker at 375x667 portrait (card y116-244, marker y221-253)
- Fake-map only / polish: stop markers cover suggestion dots (z-[1]); desktop stops near the left edge hidden under the 360px sheet; 320x480 card sits ~20px above sheet

## f8 (auth and accounts) - no bugs; F4 fixes (login 500 message, search session-expiry message, Settings softDisabled) re-verified in a browser
- [ ] Polish (unconfirmed): login 429 with a JSON {error} body shows "Couldn't reach the server" (injected response; check what the real limiter sends, in login-guard / credentials-login.ts) (still open: not touched)
- [x] Polish: Change password gives no inline reason when the new password is under 8 characters
- Not tested: real rate-limit/lockout (limiter off in dev), Google-only account paths

## f9 (keyboard and responsive) - F4 fixes re-verified; contrast, reduced motion, focus indicators, no sideways scroll all fine
- [x] M (a11y): keyboard reorder announces raw database ids from dnd-kit ("Draggable item cmvq... was moved over droppable area ..."). Give DndContext in StopList.tsx custom accessibility.announcements (stop names) or silence them in favour of the app's own "Moved X to position N of M"
- [x] L-M (a11y): focus lost to BODY after Add stop by keyboard (search, ArrowDown, Enter, Tab to Add stop, Enter): place card unmounts in TripEditor.tsx with no focus move; return focus to the search box or the new stop
- [x] L-M: Export menu runs off screen at Extra large text on 320x568 (panel max-height 160px but only 86px free; last item unreachable, ends y=637 of 568). Same root cause as the f6 item: use-popover.ts:43 Math.max(room,160). Also 360x640 at Extra large overshoots by 7px
- [ ] Polish: search results count not announced when typing; Enter on disabled Optimize announces nothing; /privacy, /terms, /offline have no skip link (still open: results count / disabled Optimize announcements not done; skip links on /privacy, /terms, /offline are done)

## f10 (cross-feature chaos) - nothing new
- 43 seeded API sequences, 2x1000 concurrent cascade requests (no 5xx, one visited run, sessions agree), 10 seeded UI runs (offline copy == server after each reload check).
- Only failure was seed 8 = known open item: keyboard reorder moved a visited stop (server visited 1,0,0,1). OWNER DECISION still pending (reorder vs visited rule).
- Not covered: PDF export, photos, drawer UI in the chaos mix; 429 behaviour in the UI.
