# P4 findings: PWA, performance, accessibility

Tested on a production build (`next build` + `next start`, port 3302) with a fresh SQLite DB and fake externals. Real Mapbox, Overpass and weather were not available; the editor used FakeMapPanel. Lighthouse 12.8.2 mobile profile, simulated throttling, one run each (noisy, shared machine).

## Lighthouse

| Page | Perf | A11y | BP | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| /login | 67 (re-run 90) | 100 | 100 | 100 | 3.1 s (2.8) | 700 ms (280) | 0 |
| /trips | 75 | 100 | 100 | 100 | 2.9 s | 880 ms | 0 |
| /trips/:id (fake map) | 86 | 100 | 100 | 100 | 3.9 s | 150 ms | 0 |

axe-core (wcag2a/aa/21a/21aa/22aa/best-practice): 0 violations in 28 runs (7 pages, light and dark, 375x667 and 1280x800). Own contrast check: 0 failures.

## Observed OK

- Manifest: name, short_name, start_url /trips, scope /, standalone, icons 192, 512, 512 maskable. CDP reports no installability errors.
- Service worker registers and activates; /offline precache works; only static assets and /offline are cached (no /api, no authed pages, no cross-login leak). Offline pages show the saved-trips page. Sign-out clears local offline copies. sw.js is served no-cache. A redeploy delivered new assets (navigations always hit the network).
- Keyboard: sensible tab order, visible focus, skip link, popovers close on Escape and return focus, delete confirmation traps focus. Icon-only controls have accessible names. Reduced motion collapses CSS animation.
- Editor idle/typing causes no DOM mutations in the stop rows (fake map only).

## Bugs

| ID | Sev | Area | Repro | Expected vs actual | Suspected root cause |
|---|---|---|---|---|---|
| P4-001 | Low | PWA / iOS | read `<head>` of /login | theme-color, apple-touch-icon, apple web-app meta expected; none present | src/app/layout.tsx has no viewport.themeColor, metadata.icons.apple or appleWebApp; no apple icon in public/icons |
| P4-002 | Low | Manifest | fetch /manifest.webmanifest | `id` and `lang` expected; absent (informational) | src/app/manifest.ts:4-19 |
| P4-003 | Low | Performance | Lighthouse on /login, /trips, editor | bfcache eligible expected; blocked by cache-control no-store | dynamic pages emit no-store (root layout reads x-nonce) |
| P4-004 | Low-Med | Performance | Lighthouse on editor | LCP 3.9 s; LCP element is a lazy-loaded stop thumbnail; ~26-30 KiB unused JS in shared chunk | first-viewport thumbnail rendered lazy in StopList/TripPlanList |
| P4-005 | Low | A11y touch targets | 375x667 touch, /trips/:id and /settings | 44x44 expected (WCAG AA min 24 met); stop-row buttons 155x36, zoom-to-fit 32x32, settings checkboxes 24x24, footer links 40x24 | Tailwind sizing, SettingsView.tsx:107 |

## Unconfirmed (not reproduced)

1. In-app "Reduce motion" setting may not be read by JS map animations (MapPanel.tsx:242, :419; FakeMapPanel.tsx:65 only check the OS media query).
2. At 375 px the selected-stop card Close button sat over marker 5 and blocked a click (may be fake-map geometry).
3. Silent SW install failure when /offline is not a plain 200 (public/sw.js:60-67): not reproduced.
4. Real Mapbox chunk (~520 KB gz) probably dominates real-device editor LCP and TBT: not measured.

## Not tested

Real Mapbox behaviour, /s/[token] and /settings Lighthouse, real device install (iOS, Android), a sw.js byte-change update, screen readers, browser zoom, large text settings, Edit-trip form, Suggestions tab, optimize flow, bottom-sheet drag.
