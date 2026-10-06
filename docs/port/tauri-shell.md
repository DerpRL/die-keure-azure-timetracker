# Tauri shell (`apps/desktop/src-tauri`)

The shell is everything the operating system sees of Azure timetracker 2.0: the tray icon, the
three windows, the quick-switch shortcut, the macOS activation policy, the bundle identity and
the plugin wiring. It holds no tracking state. The engine (`att-engine`, not wired in yet) decides
what the tray shows and when the panel opens, through the commands below; its own commands are
registered next to them.

Replaces from 1.14.2: `AzureTimetrackerApp.swift` (accessory policy, overview window, command
menus), `MenuBarController.swift` (status item, clock, popover), `QuickSwitchShortcut.swift`,
`Resources/Info.plist`, `Resources/App.entitlements`.

Stack: Tauri 2.12 (`tauri = "2"`, never the 3.0 alphas), tray-icon 0.25, tao 0.37, objc2 0.6 /
objc2-app-kit 0.3, windows 0.62. The crate (`att-desktop`, lib `att_desktop_lib`) is standalone
with its own `Cargo.lock` and `target/` until it joins the root workspace (an empty `[workspace]`
table is required, otherwise Cargo walks up to a parent workspace).

## Files

| Path | Purpose |
|---|---|
| `tauri.conf.json` | Identity, windows, CSP, bundle, updater |
| `Info.plist`, `App.entitlements` | macOS plist fragment and calendar entitlement (copied from `Resources/`) |
| `capabilities/default.json` | What the three web views may call |
| `build.rs` | `tauri-build` with an app ACL manifest listing every command |
| `src/lib.rs` | Builder: plugins, state, handlers, macOS menu, run-event handling |
| `src/shell.rs` | `#[tauri::command]`s, event names and payloads, `ShellError`, main-thread helper |
| `src/surfaces.rs` | `main` / `panel` / `mini` behaviour and the tray anchoring maths |
| `src/tray.rs` | Tray icon, tray menu, macOS app menu, state icons, tooltip limits |
| `src/shortcut.rs` | Global quick-switch shortcut |
| `src/native.rs` | The AppKit / Win32 calls Tauri does not expose |
| `src/debug.rs` | Debug-build switches (`ATT_DEBUG_*`), compiled out of release builds |
| `icons/`, `icons/tray/` | Generated icons (committed) |
| `scripts/generate-icons.sh`, `scripts/draw-tray-icons.swift` | Regenerate all icons |

## Building and running

```sh
cargo fmt     --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy  --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test    --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo build   --manifest-path apps/desktop/src-tauri/Cargo.toml    # loads devUrl (Vite on :1420)
```

- With the dev server: `npm run tauri dev` from `apps/desktop` once the UI side adds
  `@tauri-apps/cli` and a `tauri` script (`beforeDevCommand` runs `npm run dev`).
- Without a dev server: build the frontend into `apps/desktop/dist`, then
  `cargo build --features custom-protocol` (alias for `tauri/custom-protocol`) and run
  `target/debug/att-desktop`. The assets are embedded at compile time, so `dist` must exist.
- Bundle: `npx @tauri-apps/cli@2 build` (targets `app` + `dmg` on macOS, `nsis` on Windows). The
  binary is renamed to `AzureTimetracker` by `mainBinaryName`.

Debug-build switches (`src/debug.rs`): `ATT_DEBUG_SHOW_PANEL=1|nofocus`, `ATT_DEBUG_SHOW_MAIN=1`,
`ATT_DEBUG_MINI=1`, `ATT_DEBUG_REPORT=1` (monitors, tray rectangle, window frames and every panel
show/hide/focus change on stderr) and, on macOS, `ATT_DEBUG_SNAPSHOT=<dir>` (in-process PNGs of
the status item and of every visible web view; no Screen Recording permission needed).

## Windows ("surfaces")

One React bundle renders all three, chosen by window label.

| Label | Created | Size (logical) | Behaviour |
|---|---|---|---|
| `main` | at launch, hidden | 1200×820, min 1040×720 | Close hides it (tray-only operation, as in 1.x). Shown and focused by the tray menu, `shell_show_main`, a second launch (single-instance plugin) and macOS reopen (Finder/Spotlight). Size and position restored by the window-state plugin (main only; visibility is not restored, so launches never open it). |
| `panel` | at launch, hidden | 420×640 | No decorations, not resizable, always on top, no taskbar entry, shadow, `acceptFirstMouse`. Re-anchored to the tray icon on every show. Hides on focus loss. On macOS it joins every Space, including full-screen Spaces (`FullScreenAuxiliary`). |
| `mini` | `shell_set_mini_timer(true)` | 260×72 | Always on top, no decorations, not focusable (clicks never take focus from the work app), bottom-right of the primary work area with a 16 px margin. Destroyed when turned off. Position not remembered. |

Panel details:

- Anchoring: the positioner plugin tracks the tray rectangle (fed by every tray event and refreshed
  from `TrayIcon::rect()` before each show, so the shortcut works before the pointer ever touched
  the icon) and moves the panel to `TrayBottomCenter` (macOS) / `TrayCenter` (Windows), which puts
  it on the tray's monitor. A second pass (`surfaces::anchored_origin`, unit-tested) then centres
  it on the icon with the fresh size, 6 px under the menu bar (macOS) or 12 px above the taskbar
  (Windows), flips to the other side when there is no room (top or side taskbars), and clamps to
  the monitor's work area. Positioner alone aligns with the top of the menu bar and clamps to the
  full monitor, under the taskbar or Dock.
- `focus: true` shows and activates (1.x called `NSApp.activate(ignoringOtherApps:)`).
  `focus: false` shows without activating: `orderFrontRegardless` on macOS; on Windows the window
  is made `WS_EX_NOACTIVATE` around `SW_SHOW` and the previous foreground window gets the focus
  back if the shell still activated it.
- Hide on blur, with two guards: a blur within 300 ms of a show keeps the panel open unfocused
  (macOS refuses activation when no user input asked for it, and the panel would otherwise flash);
  a tray click within 400 ms after a blur-hide is the click that caused the blur and does not
  reopen the panel (Windows moves focus to the taskbar on mouse down).
- A panel shown with `focus: false` only hides when the user has focused it and left, clicks the
  tray icon, or the engine hides it.

## Tray

- Left click (button up) toggles the panel (shown with focus). Right click opens the menu:
  **Open overview** (main window, current page), **Settings…** / **Settings** (main window +
  `shell://navigate` `"settings"`), separator, **Quit Azure timetracker** / **Quit**.
- Windows: double-click opens the main window (the trailing click of the double click is ignored).
- macOS: a monochrome template image, the 16-pt clock from `MenuBarController.menuClock()`
  centred on an 18-pt canvas (tray-icon always sizes the image to 18 pt), plus the title. The
  status-item button gets 1.x's 12-pt medium monospaced-digit font, so the item keeps its width as
  seconds change, and 1.x's accessibility label (the tooltip text) and value (the clock). The
  icon does not change with the state, as in 1.x.
- Windows: coloured state icons, 16 px at 100 % scaling and 32 px above (primary monitor scale):
  running green, paused amber (pause bars), stopped neutral (app-icon backdrop), disconnected
  orange ("!"), connecting slate (open ring), attention violet ("?"). Each state has its own
  glyph so it never depends on colour alone. Tooltips are cut to 127 UTF-16 units with "…".
- `shell_set_tray` caches what it applied, so the engine may send the full state every second;
  only changes reach the OS.

## Quick-switch shortcut

- Default `Control+Alt+T` (⌃⌥T) on macOS, `Control+Alt+Shift+T` on Windows (Ctrl+Alt is AltGr on
  Belgian AZERTY), registered at launch. The engine applies the user's setting with
  `shell_set_shortcut`; `None` turns it off.
- On press: the panel is shown and focused, then `shortcut://quick-switch` is emitted.
- Accelerators use the global-hotkey syntax (`Control`, `Alt`/`Option`, `Shift`,
  `Super`/`Command`, `CmdOrCtrl`, key names such as `T`, `KeyT`, `Digit1`, `F8`). Rejected: invalid
  strings, and keys without Control/Alt/Super (they would capture typing), except F1–F24.
- Conflicts keep the previous shortcut registered and return 1.x's message, for example
  "⌃⌥T is unavailable or already used by another app. Use Switch ticket in the menu bar." (macOS)
  or "Ctrl+Alt+Shift+T is unavailable or already used by another app. Use Switch ticket from the
  tray icon." (Windows). Like 1.x on macOS (Carbon `RegisterEventHotKey` without the exclusive
  flag), only registrations the OS refuses are reported.

## IPC contract

Arguments are camelCase in JavaScript. Every command returning `Result` rejects the `invoke`
promise with an English message.

| Command | Rust signature | Notes |
|---|---|---|
| `shell_show_panel` | `fn(focus: bool) -> Result<(), String>` | Anchors and shows; focuses an already visible panel when `focus`. |
| `shell_hide_panel` | `fn() -> Result<(), String>` | |
| `shell_toggle_panel` | `fn() -> Result<(), String>` | Visible → hide, else show with focus. |
| `shell_show_main` | `fn(page: Option<String>) -> Result<(), String>` | Hides the panel, shows and focuses main; with `page`, emits `shell://navigate` to main. Page ids belong to the UI: 1–64 of `A–Z a–z 0–9 - _ /`. |
| `shell_set_tray` | `fn(title: Option<String>, tooltip: String, state: TrayState) -> Result<(), String>` | `state` is a string: `running`, `paused`, `stopped`, `disconnected`, `connecting`, `attention`. `title` (e.g. `" 01:23:45"`, max 32 chars) is shown on macOS only. |
| `shell_set_mini_timer` | `async fn(enabled: bool) -> Result<(), String>` | Async because creating a web view from a sync command deadlocks on Windows. |
| `shell_set_shortcut` | `fn(accelerator: Option<String>) -> Result<(), String>` | See above. |
| `shell_get_shortcut` | `fn() -> ShortcutStatus` | Added: `{ accelerator, label, defaultAccelerator, defaultLabel, issue }`, so Settings can show a registration problem from launch. |
| `shell_quit` | `fn()` | Quits; the 7pace timer is not touched (as in 1.x). |

| Event | Target | Payload |
|---|---|---|
| `shell://navigate` | `main` | page id (string) |
| `shortcut://quick-switch` | all | `null` |
| `shell://panel-shown` | all | `{ "focused": boolean }` |
| `shell://panel-hidden` | all | `{ "reason": "blur" \| "request" }` (1.x cancelled menu tracking when the popover closed) |
| `shell://mini-closed` | all | `null` (the user closed the mini timer with Alt+F4 or ⌘W) |

For the UI: listen with `listen()` from `@tauri-apps/api/event`; render by
`getCurrentWebviewWindow().label`; frameless `panel`/`mini` need `data-tauri-drag-region` to be
draggable; Escape in the panel should call `shell_hide_panel`; design the mini timer for 260×72.
On macOS ⌘, is handled by the native app menu (it opens Settings); the Tracking shortcuts of 1.x
(⌘N choose ticket, ⌘R refresh, ⌘⇧D review today) are in-page shortcuts for the UI on both OSes.

## Capabilities (`capabilities/default.json`)

Scoped to the windows `main`, `panel`, `mini`. Because `build.rs` gives the app an ACL manifest,
an app command is rejected unless a capability grants its `allow-<command>` permission. **When the
engine adds commands, list them in `build.rs` `COMMANDS` and grant them here.**

Granted: `core:app:allow-version`, `core:app:allow-name`, `core:event:default`,
`core:window:default` (read-only getters), `core:window:allow-start-dragging`, all
`allow-shell-*`, `dialog:allow-open` / `allow-save` (repository folder and app pickers, CSV and
Markdown export), `opener:allow-open-url` for `https://*` and `figma://*` (work items, Figma),
`clipboard-manager:allow-write-text` (weekly report), `notification:allow-is-permission-granted`
/ `allow-request-permission`, `autostart:allow-enable` / `allow-disable` / `allow-is-enabled`
(Settings toggle until the engine owns launch at login).

Not exposed to the web views (driven from Rust): global-shortcut (through `shell_set_shortcut`),
positioner, window-state, updater (the engine checks the feed on its cadence), process
(`shell_quit`; the engine restarts after updates), single-instance, sending notifications. Verified
at runtime: an ungranted `plugin:global-shortcut|unregister_all` is rejected.

## Configuration decisions

- Identity: `be.yarne.azure-timetracker`, product "Azure timetracker", binary `AzureTimetracker`,
  version 2.0.0. `bundle.macOS.bundleVersion` is **25** (1.14.2 was build 24): the legacy update
  validator needs `CFBundleVersion` to parse as a positive integer, and Tauri would otherwise
  write "2.0.0". Bump it with every release that goes through the legacy feed.
- `publisher` "Yarne Savaete" (defaults to "yarne" from the identifier otherwise). NSIS uses it in
  registry paths, so it should not change after the first Windows release.
- macOS: `LSUIElement` plus `ActivationPolicy::Accessory` (no Dock icon, no ⌘-Tab);
  `activate_ignoring_other_apps(false)` so launching at login or after an update does not take
  focus from the frontmost app (tao activates by default); minimum macOS 14.0; hardened runtime;
  no signing identity (the release tool signs with the local certificate and applies
  `App.entitlements`, as `scripts/sign-app.sh` does). A `tauri build` produces a bundle carrying
  only the linker's ad-hoc signature.
- Windows: NSIS `installMode: currentUser`, English only.
- CSP: `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'` (React style
  props use the CSSOM, but UI libraries may inject `<style>`); `img-src 'self' data: blob:`;
  `font-src 'self' data:`; `connect-src 'self' ipc: http://ipc.localhost` (Tauri IPC on macOS and
  Windows; the engine does all networking); `object-src`, `base-uri`, `form-action`, `frame-src`,
  `frame-ancestors` `'none'`. Keep `index.html` free of inline `<style>`: Tauri would add a nonce,
  which disables `'unsafe-inline'`. No CSP applies to the Vite dev server.
- `backgroundThrottling: "throttle"` for `main` and `panel` (macOS 14+ suspends hidden WKWebViews
  by default; throttling keeps the mirrored store live so the panel opens with current state).
- Updater: endpoint `https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main/updates/v2/latest.json`,
  Windows `installMode: passive`, `requireSignedVersion: true` (new feed: every signature made by
  the Tauri CLI carries its version, which blocks downgrade pairing). **The `pubkey` is a marked
  placeholder** that is only read when verifying a download; the release engineer replaces it.
  `createUpdaterArtifacts` stays off so builds without the private key work; the release tool
  turns it on (`--config`) with `TAURI_SIGNING_PRIVATE_KEY`.
- Autostart: `--autostart` argument; macOS uses the plugin's LaunchAgent plist.

## Icons

`scripts/generate-icons.sh` regenerates everything: `scripts/draw-icon.swift` (repository root,
1.x drawing) renders the 1024 px source, `npx @tauri-apps/cli@2 icon` writes `icons/` (the
Android/iOS folders are deleted), and `scripts/draw-tray-icons.swift` writes `icons/tray/`. A
re-run reproduces every file byte for byte except the `icon.icns` container.

## Verification (6 October 2026, macOS 27.0.1, three displays)

- fmt, clippy `-D warnings` (debug and release), 15 unit tests (anchoring, page ids, tray state
  parsing, title/tooltip limits, accelerator parsing and labels) and the build pass.
- `screencapture` fails on this Mac ("could not create image from display";
  `CGPreflightScreenCaptureAccess()` is false: no Screen Recording permission for the session),
  and macOS 27 composites menu-bar extras in the Window Server, so the window list shows no
  per-app status items. Evidence came instead from the window server's on-screen list, the
  `ATT_DEBUG_REPORT` output and in-process snapshots (`ATT_DEBUG_SNAPSHOT`) against a placeholder
  `dist/`:
  - status item rendered as the template clock plus " 01:23:45" (set by the panel page through
    `shell_set_tray`), font `.SFNS-Medium`, 98×22 pt;
  - panel on screen at 420×640, centred under the tray item and 7 px below the menu bar, on the
    display whose menu bar held the item (primary or left display across runs), not focused when
    shown with `focus: false`; while the main window was key it kept focus;
  - the panel page reported `shell_set_tray: ok`, shortcut ⌃⌥T registered without issue, ACL
    blocking the ungranted plugin command;
  - main window 1200×820 rendering the `main` surface; mini timer 260×72 at the primary work
    area's bottom-right corner, not focused; a second launch exited with code 0 and the running
    instance showed and focused the main window.
- `tauri build --bundles app`: `Azure timetracker.app` (9.4 MiB) with `CFBundleExecutable`
  `AzureTimetracker`, `CFBundleVersion` 25, `LSMinimumSystemVersion` 14.0, `LSUIElement`, the
  calendar usage strings verbatim and category productivity.
- Windows (`cargo check --target x86_64-pc-windows-msvc` on macOS): fails in two build scripts that
  need Windows tooling: `ring` (via updater → reqwest → rustls) cannot find the MSVC CRT headers
  (`assert.h`), and `tauri-build`'s resource step (`tauri-winres` → `embed-resource`) panics with
  `NotAttempted("llvm-rc")`. With both bypassed locally (updater temporarily on `native-tls`, and
  `RC_x86_64_pc_windows_msvc` pointing at a stub resource compiler; neither committed) the crate
  passes `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings`. That check
  found and fixed a macOS-only call (`autostart::Builder::macos_launcher`). Runtime behaviour on
  Windows is untested.

## Known gaps and follow-ups

- **Launch at login (macOS):** 1.x uses `SMAppService.mainApp` (System Settings → Login Items);
  the plugin writes a LaunchAgent plist instead. An app that 1.x registered keeps launching through
  SMAppService while the plugin reports "disabled". SMAppService via
  `objc2-service-management` is a follow-up, as the plan's capability map says.
- **Actionable notifications:** only the plain notification plugin is registered; buttons need the
  native layer from the plan (UNUserNotificationCenter / WinRT toasts).
- **Onboarding gate:** 1.x opened the main window instead of the popover while appearance
  onboarding was pending. The engine needs a hook for this (for example a flag the tray click
  checks); not built yet.
- **Non-activating panel:** a real `NSPanel` (non-activating) would let the panel take keyboard
  focus without activating the app; the current window activates the app when focused.
- **Windows runtime:** non-activating show, DPI icon choice, double-click handling, anchoring with
  vertical/top taskbars and the overflow area are implemented from the APIs but not run on Windows.
- **Bridge release:** the bundle has no `Contents/Helpers/AzureTimetrackerUpdater` stub and no
  signature; both belong to the release tool.
- `with_inner_tray_icon` ties `native.rs` to tray-icon's objc2-app-kit version; a Tauri minor
  update that bumps it breaks the build (not the runtime). The lockfile pins it.
- No tracing subscriber yet: shell warnings go nowhere until the engine installs one.
- Typed bindings (`tauri-specta`) for these commands and events are not generated yet.
- The mini timer's position is not remembered and it stays on the virtual desktop it was created
  on (Windows).
