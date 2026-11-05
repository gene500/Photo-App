# F7 checklist (findings from T10, 2026-10-27)

T10 = 4 Sonnet fiddlers on A44-A47 (testers change no code). Tick an item when F7 fixes it and it is verified.

## g1: A44 reorder ignores visited stops (reported; no High or Medium)

Checked and passed: reorder API (visited stay first, duplicates 400, missing/extra/foreign ids 409, 401/404, 25-stop max), keyboard (no-op moves send no PUT, Escape cancels, announcer text, disabled handles labelled), mouse (drop on visited row lands at first unvisited slot), stale tab, in-flight cascade, optimize/undo, add/delete, swap/undo, share page, GPX and offline copy agree. No console errors.

- [x] **Low** Undo optimize announces "Optimize undone. Your previous order is back." even when the visited cascade means the previous order was not fully restored.
  Steps: 6 stops, A and B visited; move F to position 4; Optimize (A B C D E F); tick D and E visited (C, D, E become visited); Undo. Stops stay A B C D E F (correct) but the announcement is wrong.
  Suspected cause: `undoOptimize` announcement in `src/components/editor/TripEditor.tsx` (about line 760) does not check whether `pinVisitedFirst` changed the requested order.
- [x] **Owner decided 2026-10-27: cancel.** A mouse drag released outside the list must cancel the reorder (it used to take the nearest row).

## g2: A45 fanned markers (reported; no High or Medium)

Checked and passed: stacks of 2, 3, 5, 8, 12 and 25 identical stops (every marker topmost at its centre, at least 33.9 px apart); click and Enter select exactly one marker; Tab order; reorder/add/delete/visited; mixed groups; dark mode; phone landscape; resize; share page; GPX, route line and sun line use true coordinates. Real map checked by reading code only (drag, `zoomend`), not in a browser.

- [x] **Low** PDF fallback map: stacked or 1 m apart stops draw circles 1, 2, 3 on the same point, so only the last number is legible (`drawFallbackMap` in `src/lib/itinerary-pdf.ts`). Probably the same on a static map image (untested).
- [ ] **Low (e2e only)** `FakeMapPanel.tsx` assumes a 1000x600 viewport for `fanOffsets` (`left*10, top*6`), so real sizes can miss or create overlaps (phone portrait: 12 px apart not fanned; desktop 1280: two markers 12.4 px apart in a 10-stop chain). The real map uses true pixels.
- [x] **Low** Optimize reorders identical-coordinate stops for no gain (S0 S1 S2 S3 became S0 S3 S2 S1; same length) and shows no "Already the fastest" message. Undo exists.
- [ ] **Polish** Groups are built transitively, so a chain of near-adjacent stops collapses into one ring (up to about 90 px off its true spot).
- [ ] **Polish** Stacks near a viewport edge fan partly off the map (8 stops at a corner: 7 off-map, 5 off-screen; a 25-stack has radius about 135 px).
- Fanned slots follow list order, so markers swap places after a reorder or delete. By design.
- Unverified, not reproduced with 150 ms key pauses: rapid Space + ArrowDown x2 on a reorder handle, then ticking Visited, moved the stop one step and the Visited checkbox refused to change. Treated as a keyboard-timing race outside this feature.
## g3: A46 phone landscape (reported; one High, one Medium)

Playwright on the local copy, fake externals. Viewports 568x320 up to 1024x500 (plus 1000x501, 1023x499, 500x500, 422x195 = 200% zoom), three text sizes, light and dark, all tabs, empty trip, 25 stops, long names, live rotation with drawer/card/popover/drag/slow add, share page, `/offline`, safe-area insets, keyboard-up (approximated), tab order.

Passed: breakpoint (1023x500 side panel, 1024x500 desktop card, 1000x501 bottom sheet); no horizontal scroll anywhere; panel and map widths follow the clamp at every text size; rotation keeps drawer, card and in-flight add with no page errors, and a collapsed sheet stays collapsed; drawer Save and the Edit form are reachable by scrolling; `/offline` fine. Heights 481-500 px are fine for the popover.

- [x] **High** Export and Share popovers are covered by the search bar at heights of 480 px or less (568x320, 667x375, 844x390). The search input is hit instead of "Download GPX", "Open in Apple Maps" and "Create link" (fails elementFromPoint).
  Cause: `SHORT_SCREEN_POPOVER` in `src/components/editor/use-popover.ts` (`fixed right-3 top-3` under `max-height:30rem`) was written for the bottom sheet; now the popover sits inside the aside's z-10 stacking context, below the search overlay's z-15 in `TripEditor.tsx` (about line 1144).
- [x] **Medium** The stop list is squeezed almost to nothing in the side panel. Header, summary and tabs do not scroll, so only the list scrolls: with 25 stops it is 108 px tall at 568x320 (82 px at large text, 55 px at xlarge) and 163 px at 667x375. It shrinks to its 28 px `min-h` with a long name, with the keyboard up (viewport 175 px or less) and at 422x195. Large text with a long name pushes the header off the top (Edit, Export, Share at y=-164, unreachable). The share page has the same problem (72 px of list at 568x320).
  Suspected: `StopsPanel.tsx` around line 107, the tabpanel's `min-h-0 flex-1 overflow-y-auto`, and the `SharedTripView` aside. The whole panel should scroll in side mode.
- [x] **Low-Medium** Dragging a row to reorder runs away at 667x375 and 568x320: dragging the first handle about 110 px down and holding makes dnd-kit autoscroll run unbounded (scrollTop reached 2254 on an 8-stop list) and the row lands at the end. The short list leaves only a few pixels between a row and the autoscroll edge. Not reproduced in portrait or at 1280x800. Rotating mid-drag and releasing was harmless.
- [x] **Low** Search results taller than the screen are unreachable at 568x320, 667x375, 844x390 and 932x430 (5 or more results with subtitles; `/api/geocode` mocked with 6): the last 2-3 fall below the viewport and cannot scroll. `ul#place-search-results` in `SearchBar.tsx` has no `max-height` or overflow. Arrow keys still reach hidden results.
- [ ] **Polish** Pending place card and selected card cover fanned markers (known).
- [ ] **Polish** Tab order is map markers, search, then panel, although the panel is visually leftmost.
- [ ] **Polish** `env(safe-area-inset-*)` paddings are no-ops without `viewport-fit=cover` (harmless; iOS letterboxes).
- [ ] **Polish** At 568x320 the stop name wraps 4 lines beside the thumbnail.
- [x] **Polish** The Edit form is capped at about 128 px in the side panel though there is more room.
## g4: A47 CJK PDF (reported; one Low-Medium)

Ran in dev mode (strict production CSP not tested). Passed: CJK names, notes, shot notes and trip name draw correct glyphs (checked with mutool text extraction and rendered PNGs); CJK punctuation, full-width digits, mixed Latin; rare kanji, emoji, Arabic, Hebrew, Thai, Hindi become "?" without breaking; long unspaced CJK wraps; 25-stop CJK trip makes a 7-page 390 KB PDF in under 1 s; Latin trips fetch 2 fonts, CJK trips 3, normal pages none; fallbacks work for 404, HTML instead of a font, 5 KB truncated file, wrong-script file, aborted request, hang (30 s timeout), slow 8 s response; share page (logged out) and editor both work.

- [x] **Low-Medium** A truncated or corrupt CJK font that still passes the checks (200 response, at least 10 KB, has the 京 cmap entry; e.g. the first 50% or 90% of the real file) makes the whole PDF fail with "Could not create the PDF. Try again." and a retry fails the same way. Expected: fall back to "?".
  Console: jsPDF `addFont` error `Cannot read properties of undefined (reading '0')`, then `getCharWidthsArray` error reading `'Unicode'`.
  Suspected cause: `applyCjk` in `src/lib/itinerary-pdf.ts`; jsPDF swallows the `addFont` error in its PubSub so the `try/catch` never fires, `family` is already set to the CJK family, and the later `splitTextToSize` throws. The base-font path has the same pattern.
  Possible fix: after `addFont`, check `doc.getFontList()[CJK_FAMILY]` and measure a string with `getTextWidth` inside the try.
- [x] **Owner decided 2026-10-27: cache the fonts in `public/sw.js`.** Offline after a first download loses CJK/Unicode text: `public/sw.js` caches only the offline shell, `/_next/static` and `/icons`, and fonts are served `Cache-Control: public, max-age=0`, so each PDF re-fetches all 3 files (about 4.3 MB for a CJK trip) and offline CJK names print "?".
- [ ] **Polish** Half-width kana with dakuten (ｶﾞ) shows the mark as a separate spaced glyph.
- [ ] **Polish** A combining mark on a CJK character (北 + U+0301) prints "北?京".
- [x] **Polish** Double-clicking "Download PDF" lands the second click outside the dialog (the PDF still builds once; the dialog is gone, maybe the backdrop closing it).
- By design: bold headings are regular weight with the CJK font; notes and shot notes have an empty line between them.
