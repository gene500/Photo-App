# Native apps (macOS, Windows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Photo Op Planner as an installed dock (macOS) and taskbar (Windows) app that opens the live site in its own window.

**Architecture:** One Tauri 2 project in `apps/native/` with its own `package.json`. It has no bundled UI: a Rust setup hook opens a single window on the hosted site, keeps navigation inside the site's origin, and sends every other link to the default browser. No native commands are exposed to the page. Windows installers are built by a manual GitHub Actions workflow.

**Tech Stack:** Tauri 2 (Rust, `@tauri-apps/cli`), `tauri-plugin-opener`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-23-native-apps-design.md`

## Global Constraints

- Live site: `https://photo-app-pi2o.vercel.app`; the window starts at `/trips`.
- macOS: universal build (Apple silicon + Intel). Windows: x64 NSIS installer built on GitHub Actions.
- Shell navigates only within the app's own origin; all other links open in the default browser; no native commands exposed to the page (no `capabilities` granting remote IPC).
- Build workflow runs on `workflow_dispatch` or tag `native-v*` only, so required CI (`check`, `e2e`) is untouched.
- Do not change website behavior; do not add dependencies to the root `package.json`.
- Never print or commit the Mapbox `pk.` token or `TURSO_*` secrets. Not distributed to others: no signing or notarization.
- Do not commit or push unless the owner says so (global rule); leave work in the working tree and report.
- Any app, build or helper process you start must be stopped before finishing; confirm with `pgrep`.

## Review Focus

- Lookalike URLs (`https://photo-app-pi2o.vercel.app.evil.com/`, `http://` version, the host inside a query string) must not count as in-app: pinned by Task 2 tests.
- Login must survive quitting and relaunching the app: checked in Task 3.
- If the service worker cannot register in the webview, the site must still load normally: checked in Task 3.
- Launching with no network must show something understandable, not a blank white window: checked in Task 3; if blank, report it to the owner rather than fixing silently.
- If the login page offers Google sign-in, it may be blocked inside the webview (`disallowed_useragent`): checked in Task 3; report to the owner.
- `target="_blank"` links must open in the default browser, not a new app window: checked in Task 3.

---

### Task 1: Confirm the existing installable web app works (A3)

**Files:** none changed.

- [ ] **Step 1:** Run `npx vitest run src/app/manifest.test.ts`. Expected: PASS.
- [ ] **Step 2:** In Chrome, open `https://photo-app-pi2o.vercel.app/trips`; confirm the address bar offers "Install". Report whether it does. This is the owner's free fallback; do not change any site code.

### Task 2: Tauri shell with navigation allowlist (A4, part 1)

**Files:**
- Create: `apps/native/package.json`, `apps/native/dist/index.html` (placeholder, required by Tauri's `frontendDist`), `apps/native/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,src/main.rs,src/lib.rs}`, icons generated into `apps/native/src-tauri/icons/`
- Modify: `tsconfig.json` (add `"apps/native"` to `exclude`), `eslint.config.mjs` (add `"apps/native/**"` to the global ignores), `.gitignore` (add `/apps/native/node_modules`, `/apps/native/src-tauri/target`, `/apps/native/src-tauri/gen`)
- Test: `#[cfg(test)]` module in `apps/native/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `fn is_app_url(url: &tauri::Url) -> bool` in `lib.rs` (true only for scheme `https` and host exactly `photo-app-pi2o.vercel.app`); `pub fn run()` called from `main.rs`; a `npm run build` script in `apps/native/package.json` that runs `tauri build`.

- [ ] **Step 1:** Install Rust via rustup (`rustup default stable`) and check `cargo --version`. Tell the owner this was installed.
- [ ] **Step 2:** Create `apps/native/package.json` (private, devDependency `@tauri-apps/cli` at the latest 2.x, scripts `tauri` and `build`). Run `npm install` inside `apps/native`.
- [ ] **Step 3:** Create the Tauri project files. `tauri.conf.json`: `productName` "Photo Op Planner", identifier `com.photoopplanner.desktop`, `build.frontendDist` `../dist`, `app.windows` empty (the window is created in code), bundle targets `app`, `dmg`, `nsis`. Add `tauri-plugin-opener` to `Cargo.toml`. Run `npx tauri icon ../../public/icons/icon-512.png` from `apps/native`.
- [ ] **Step 4: Write the failing test** in `lib.rs`, in a `tests` module, with `is_app_url` stubbed to return `false`:
  - `https://photo-app-pi2o.vercel.app/trips` -> true
  - `https://photo-app-pi2o.vercel.app/` -> true
  - `http://photo-app-pi2o.vercel.app/trips` -> false
  - `https://photo-app-pi2o.vercel.app.evil.com/` -> false
  - `https://evil.com/?u=https://photo-app-pi2o.vercel.app` -> false
  - `https://user@evil.com/` and `mailto:a@b.c` -> false
- [ ] **Step 5:** Run `cargo test` in `apps/native/src-tauri`. Expected: the two `true` cases FAIL.
- [ ] **Step 6:** Implement `is_app_url`, comparing parsed `scheme()` and `host_str()` exactly (no substring matching). Expected: `cargo test` PASS.
- [ ] **Step 7:** In `run()`, build one window in `setup` with `WebviewWindowBuilder` on `WebviewUrl::External("https://photo-app-pi2o.vercel.app/trips")`, title "Photo Op Planner", 1280x860. Its `on_navigation` returns true for `is_app_url`; otherwise it opens the URL with `tauri_plugin_opener` and returns false. Also route new-window (`target="_blank"`) requests the same way using `on_new_window` if the installed Tauri version has it; if not, note that in the report.
- [ ] **Step 8:** Update the three root ignore files listed above. Run the root `npx tsc --noEmit` and `npm run lint` (check `package.json` scripts for the exact names). Expected: both PASS, with nothing from `apps/native` picked up.
- [ ] **Step 9:** Report the files changed. Do not commit.

### Task 3: Build, install and verify the Mac app (A4, part 2)

**Files:** none changed, except `docs/HANDOFF.md` for results.

- [ ] **Step 1:** From `apps/native` run `npx tauri build --target universal-apple-darwin` (add the Rust targets first with `rustup target add aarch64-apple-darwin x86_64-apple-darwin`). Expected: a `.app` and `.dmg` under `src-tauri/target/universal-apple-darwin/release/bundle/`.
- [ ] **Step 2:** Copy the `.app` to `/Applications`, open it, and keep it in the Dock (right-click, Options, Keep in Dock). Tell the owner to do the Dock step if it cannot be scripted.
- [ ] **Step 3: Verify each of these** and record pass/fail in the report: the window opens on `/trips`; sign-in works; quit and relaunch and still signed in; the map renders; a link to an outside site opens in the default browser; a `target="_blank"` link opens the browser, not a new window; the login page shows no Google button (or note that it does and whether it works); Wi-Fi off then launch shows something understandable (note exactly what appears); the site works normally if the service worker does not register.
- [ ] **Step 4:** Quit the app and stop any process you started; run `pgrep -fl "Photo Op Planner|tauri"` and confirm nothing of yours is left.

### Task 4: Windows installer workflow (A5)

**Files:**
- Create: `.github/workflows/native-windows.yml`

**Interfaces:**
- Consumes: the `npm run build` script and project from Task 2.
- Produces: an uploaded artifact named `photo-op-planner-windows` containing the NSIS `.exe`.

- [ ] **Step 1:** Create the workflow: triggers `workflow_dispatch` and `push` of tags `native-v*`; one job on `windows-latest` that checks out, sets up Node and stable Rust (pinned action versions, not floating), runs `npm ci` in `apps/native`, runs `npx tauri build --bundles nsis`, and uploads the installer with `actions/upload-artifact`. Needs `permissions: contents: read` and no secrets.
- [ ] **Step 2:** Validate the YAML locally (for example `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/native-windows.yml`). Expected: no error. The workflow can only be run on GitHub after the owner says "push"; say so, and do not claim it works until a run succeeds.
- [ ] **Step 3:** Tell the owner: after a successful run, download the artifact on the Windows PC, run the installer (SmartScreen will warn because it is unsigned; "More info", then "Run anyway"), and pin it to the taskbar.

### Task 5: Docs and handoff

**Files:**
- Modify: `README.md` (short "Desktop app" section: build, install, Windows workflow, limitations), `docs/HANDOFF.md` (task board, archive A6 as removed, current work, owner follow-ups)

- [ ] **Step 1:** Add the README section: how to build the Mac app, where the Windows installer comes from, that the app needs a connection, and that it is unsigned.
- [ ] **Step 2:** Update `docs/HANDOFF.md` per the global rules: board rows, A6 moved to the Archive as removed, results of Task 3 checks, owner follow-ups (Windows install and SmartScreen, Rust installed on this Mac).
- [ ] **Step 3:** Run `npx vitest run src/app/manifest.test.ts` and the root typecheck again. Expected: PASS.
