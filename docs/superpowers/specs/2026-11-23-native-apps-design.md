# Native apps (macOS, Windows) design

Date: 2026-11-23. Status: draft, awaiting owner approval. Owner dropped iPhone on 2026-11-23: scope is macOS and Windows only.

## Intent and why

The owner wants Photo Op Planner as an installed app with its own dock icon and window (like VS Code), on macOS and Windows (dock / taskbar), instead of going to a website in a browser tab. It is for the owner's own use only, not for other people.

## Goals

- A dock/taskbar icon that opens Photo Op Planner in its own window, with no browser chrome.
- The login stays saved between launches.
- One codebase for both platforms, reusing the existing web UI.
- Deploying the website updates every app. No reinstall for normal changes.

## Non-goals

- An iPhone app (owner decision, 2026-11-23). The existing home-screen install from Safari remains available.
- Distribution to other people: no App Store, no notarized public downloads, no auto-update channel for strangers.
- Rebuilding the server side to run on-device (fully offline native app).
- Native-only features (push notifications, background location, widgets).

## Anti-goals

- A second copy of the UI or server logic that has to be kept in sync with the website.
- Anything that changes how the website itself behaves for browser users.
- Secrets (Mapbox `pk.` token, `TURSO_*`) printed or committed.

## Constraints

- The app is a Next.js 16 server app (Prisma on Turso, NextAuth, hosted on Vercel at `https://photo-app-pi2o.vercel.app`). Pages, login and data need the server.
- It already ships a web app manifest (`src/app/manifest.ts`), a service worker (`public/sw.js`), an `/offline` page and an offline-copies feature. The shell must not break these.
- Dev machine is a Mac (Apple silicon). Rust/cargo is not installed and is needed for Tauri. Full Xcode is not needed now that iPhone is out.
- Windows cannot be built on the Mac; use GitHub Actions on a Windows runner.
- NextAuth login must work inside the shell's webview (cookies persisted, OAuth redirects, if any, stay in the window).

## Approaches considered

- **A. Native shell around the live site (picked).** One Tauri 2 project loads the hosted site in a real window on Mac and Windows. Cheap, one toolchain, always current. Needs a connection beyond what the existing offline mode covers.
- **B. Installable web app (PWA) only.** Mostly already done (manifest and service worker exist), so it is a hours-long first step: install from Chrome/Edge to the dock or taskbar. Free, but it is not a real app bundle.
- **C. Fully offline native apps.** Move data and logic on-device. Weeks of work and a server rebuild; only worth it if no-signal use is the priority. Rejected for now.

Owner direction: just for them, wants a concrete dock-style app. Approach A chosen by the assistant (stated as the assistant's call, not an agreement), with B as a free quick win first if wanted.

## Decisions made

- Target: owner's own devices only.
- Shell loads the hosted site; no bundled server.
- Free Apple account for now; signing and the App Store are deferred.

## Facts checked and builder calls (added after review)

Checked in the project and on the Mac:
- The Mac is Apple silicon (arm64). Rust/cargo is not installed (needed for Tauri).
- Google sign-in is optional and commented out in `.env.example`. Google blocks OAuth inside embedded webviews, so if it is enabled in production the shell needs a workaround; credentials-only login works as is.

Builder calls (assistant's, not agreed with the owner):
- Step 0 is a free check of the existing installable-web-app support (manifest, service worker) in Chrome/Edge/Safari.
- macOS: universal build. Windows: x64 NSIS installer built by GitHub Actions.
- The shell only navigates within the app's own origin (plus Mapbox, which the page itself loads); other links open in the default browser; no native commands are exposed to the page.
- The Windows/Mac build workflow runs on manual trigger or tag only, so it does not touch the required `check` and `e2e` CI.
- Offline in the shell for v1: the existing offline page if the service worker works in the webview; the offline-copies feature is not promised in the native apps.

## Left to the builder

- Where the shell project lives (suggested: `apps/native/` in this repo, outside the Next.js build and its lint/test globs).
- App name, icon source (reuse `public/icons`), window size and menu.
- How external links open (default browser) and how the offline page behaves in the shell.
- CI workflow for the Windows build, and a Mac build script.
- Verifying login persistence, the Mapbox map and the existing offline mode inside each webview.
