# Windows platform implementation (`att-platform`)

Scope: the Windows implementation of the `att-platform` traits and the shared "unsupported"
fallbacks. Targets Windows 10 1903+ and Windows 11, x64 and ARM64.

| File | Content |
|---|---|
| `crates/att-platform/src/windows/mod.rs` | `platform()` bundle |
| `crates/att-platform/src/windows/credentials.rs` | `WindowsCredentials` (Credential Manager) |
| `crates/att-platform/src/windows/microphone.rs` | `WindowsMicrophone` (consent store + WASAPI) |
| `crates/att-platform/src/windows/presence.rs` | `WindowsPresence` (idle, lock, foreground, app identity) |
| `crates/att-platform/src/windows/events.rs` | `subscribe`: message-only window thread |
| `crates/att-platform/src/windows/figma.rs` | `WindowsFigma` (UI Automation) |
| `crates/att-platform/src/windows/{apps,com,registry,system}.rs` | process, COM, registry and version helpers |
| `crates/att-platform/src/windows_parse.rs` | every pure decision, compiled and tested on all OSes |
| `crates/att-platform/src/unsupported.rs` | `Unsupported*` implementations and `unsupported::platform()` |
| `crates/att-platform/examples/probe_windows.rs` | manual probe (Windows only; prints a notice elsewhere) |

The Swift app had no tests for these services (only the core engines are tested), so there is
nothing to port test by test. Behaviour follows `LocalServices.swift › SecretStore`,
`MicrophoneService.swift`, `WorkPresenceService.swift` and `FigmaService.swift`.

## Decisions

### Dependencies

- Only the `windows` crate 0.62 (features listed in the Windows section of
  `crates/att-platform/Cargo.toml`). It has no build scripts and links through `raw-dylib`, so the
  crate cross-checks from macOS without a Windows SDK. `Cargo.lock` gains `windows` 0.62.2 and its
  `windows-*` support crates.
- The plan (§3, §5) names the `keyring` crate for credentials. This implementation calls
  `CredWriteW`/`CredReadW`/`CredDeleteW` directly as specified, because `keyring` stores
  UTF-16 blobs under `<user>.<service>` target names, which would not match the agreed format.

### Credentials (`WindowsCredentials`)

- One `CRED_TYPE_GENERIC` credential per account: TargetName `be.yarne.azure-timetracker:<account>`,
  UserName `<account>`, blob = UTF-8 bytes of the secret, `CRED_PERSIST_LOCAL_MACHINE`.
- Missing → `Ok(None)`; deleting a missing item → `Ok(())`. Errors read like the Swift Keychain
  messages: "Credential Manager could not read the saved credential (error 1312)."
- **Long secrets.** A generic credential holds at most 2,560 bytes (`CRED_MAX_CREDENTIAL_BLOB_SIZE`).
  The 7pace OAuth JSON (`7pace-oauth:<host>`, two tokens) can come close, so longer secrets
  continue in `…:<account>#part2`, `#part3`, … (at most 8 parts, 20 KiB). A reader follows parts
  while a blob is exactly full; writers write parts first and the main credential last, then delete
  stale parts. Ordinary secrets are a single credential in exactly the agreed format.
- Blobs typed into Credential Manager or `cmdkey` are UTF-16LE; those are read too.
- Operations are serialised per `WindowsCredentials` value. The constructor takes the service
  name; tests use throwaway names.

### Calendar

`unsupported::UnsupportedCalendar`: `access()` and `request_access()` return
`CalendarAccess::Unsupported` and never prompt; the other methods return
`PlatformError::Unsupported("Calendar")` ("Calendar is not available on this system.").

### Microphone (`WindowsMicrophone`)

- Source of truth for *which apps*: `HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone`
  (the store behind the taskbar microphone indicator). Packaged apps are subkeys named by
  package family; desktop apps are subkeys of `NonPackaged` named by executable path with `#`
  for `\`. A row is a candidate when `LastUsedTimeStart != 0` and `LastUsedTimeStop == 0`
  (a missing stop value counts as 0).
- **Merge rule** (`windows_parse::merge_microphone_use`):
  1. WASAPI sessions without a candidate row are never reported.
  2. A candidate is confirmed by an active capture session (every `DEVICE_STATE_ACTIVE`
     capture endpoint → `IAudioSessionManager2` → sessions with state `AudioSessionStateActive`,
     system-sounds session skipped) whose process belongs to it: same package family (for known
     families also the mapped executable name if the family cannot be read), same executable
     path in the `#` encoding (case-insensitive), or the same executable file name for an
     unpackaged process. Several matches: the expected executable wins, then the lowest PID.
     The confirmed session supplies `pid` and `path`.
  3. If every endpoint and session was read (complete view), unconfirmed candidates are dropped
     as stale (the store keeps `LastUsedTimeStop == 0` after a crash). If the view is partial or
     WASAPI is unavailable, unconfirmed candidates are kept with `pid: None` ("unknown" must not
     read as "silent").
- WASAPI is only queried when the store has at least one candidate, so the usual silent sample
  costs a few registry reads. No audio stream is ever opened.
- Identity (`windows_parse::input_owner`): desktop apps → `id` = lower-case executable name,
  `name` = FileDescription (cached per path) or the file stem. Known package families:

  | Package name | `id` | `name` |
  |---|---|---|
  | `MSTeams` (new Teams, work/school and free) | `ms-teams.exe` | Microsoft Teams |
  | `MicrosoftTeams` (Windows 11's preinstalled Teams free) | `ms-teams.exe` | Microsoft Teams |
  | `91750D7E.Slack` (Slack from the Store) | `slack.exe` | Slack |

  Zoom has no packaged build (its Store listing installs the desktop app, reported as `zoom.exe`).
  Other packaged apps keep the package family name as `id`, named by the process FileDescription
  or the package name. Rows with the same `id` collapse; the list is sorted by name.
- `supported()` is true from build 18362 (1903), read with `RtlGetVersion` so unmanifested
  binaries see the real version. Unsupported → `PlatformError::Unsupported("Microphone app detection")`.
  A registry failure → `Failed("Windows microphone status is temporarily unavailable (error N). Retrying automatically.")`.
- `WindowsMicrophone::diagnose()` returns candidates, sessions and owners for support and the probe.

### Presence (`WindowsPresence`)

- Idle: `GetLastInputInfo` (32-bit tick) against the low half of `GetTickCount64`, in wrapping
  32-bit arithmetic; a "negative" result (input between the two calls) is 0.
- Lock: `WTSQuerySessionInformationW(WTSSessionInfoEx)` → `SessionFlags`: `WTS_SESSIONSTATE_LOCK`
  → locked, `UNLOCK` → unlocked, anything else → `None`. Windows 7 / Server 2008 R2 (6.1) report
  the flags inverted (documented defect); that is handled, though those versions cannot run the
  app (no WebView2).
- Foreground: `GetForegroundWindow` → `GetWindowThreadProcessId` →
  `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` → `QueryFullProcessImageNameW`. For UWP apps
  framed by `ApplicationFrameHost.exe`, the process of the hosted child window is reported.
- `subscribe`: a dedicated thread (`att-system-events`) per call creates a hidden message-only
  window and pumps it. Message-only windows get no broadcasts, so power events use directed
  registration (`RegisterSuspendResumeNotification`, `RegisterPowerSettingNotification`).

  | Notification | Event |
  |---|---|
  | `WTS_SESSION_LOCK` / `WTS_SESSION_UNLOCK` | `ScreenLocked` / `ScreenUnlocked` |
  | `WTS_CONSOLE_DISCONNECT`, `WTS_REMOTE_DISCONNECT` | `SessionResigned` |
  | `WTS_CONSOLE_CONNECT`, `WTS_REMOTE_CONNECT` | `SessionActivated` |
  | `PBT_APMSUSPEND` | `WillSleep` (once) |
  | `PBT_APMRESUMEAUTOMATIC` / `PBT_APMRESUMESUSPEND` | `DidWake` (once per resume) |
  | `GUID_CONSOLE_DISPLAY_STATE` off / on (dimmed = on) | `DisplaysSlept` / `DisplaysWoke` |

  Remote connect/disconnect is included so a session the user reaches over Remote Desktop counts
  as active. Display events mirror the Swift `screensDidSleep` handling. If
  `WTSRegisterSessionNotification` fails (early in logon the Remote Desktop Services may not be
  ready), it is retried every 5 s for 5 minutes; lock state is also polled by `sample()`.
  A panicking sink is caught and logged.
- `app_identity(path)`: `.exe` only (`Failed("Choose a program file (.exe).")`), must exist;
  `id` = lower-case file name, `name` = FileDescription or file stem.

### Figma (`WindowsFigma`, experimental)

- Only when the foreground window belongs to `figma.exe`; otherwise `NotForeground`.
- UI Automation (`CUIAutomation8`, MTA): the window element's Name is the title; then a
  breadth-first search over raw-view children (`FindAllBuildCache` with Name, ValuePattern value
  and IsOffscreen cached) for a `https://www.figma.com/…` or `https://figma.com/…` URL in a value
  or name. Limits: 200 elements, 120 ms transaction timeout per call (500 ms connection timeout
  for the first contact with Chromium's provider), 1.8 s overall. An on-screen document URL
  (`/design|file|board|slides/<key>`) ends the search; otherwise off-screen documents beat other
  Figma URLs.
- Title: a trailing " – Figma" (also "-", "—") is removed; an empty title or "Figma" is `None`.
  If UI Automation fails, the window text alone is returned (title first); only when there is
  nothing at all the result is `Waiting`.
- A result is discarded if the foreground window changed during the read (`Waiting` if another
  Figma window is in front, else `NotForeground`). `MissingAccess` is never returned.
- `has_access` / `request_access` are `true` (no permission on Windows).
- `figma_installed`: `%LOCALAPPDATA%\Figma\Figma.exe`, or the `figma` URL protocol under
  `HKCU\Software\Classes\figma` or `HKCR\figma`.

### COM threading

The engine calls probes from a thread pool. Each call that needs COM (microphone, Figma) enters
the MTA on the calling thread and leaves it when done (`ComScope`); a process-wide
`CoIncrementMTAUsage` keeps the MTA alive between calls. A thread already in an STA keeps it.
All COM objects are created and released inside the scope.

### Unsupported fallbacks (`unsupported.rs`)

Used for Windows calendar and for other OSes through `unsupported::platform()`: credentials
`get`/`set` → `Unsupported("Secure credential storage")`, `delete` → `Ok`; microphone
`supported()` false and `sample()` → `Unsupported`; presence: idle 0, lock `None`, no
foreground, `subscribe` → `Ok` (delivers nothing), `app_identity` → `Unsupported`; Figma:
no access, `NotForeground`, not installed. None of them touch the OS or prompt.

## Requests for other scopes

- **Contract doc (`lib.rs`)**: `InputOwner.id` on Windows is the lower-case executable name, *or
  the package family name* for packaged apps without a mapping; `FigmaObserver::has_access` is
  always true on Windows; `Credentials` on Windows stores at most 20 KiB per secret.
- **Contract (optional)**: `PresenceProbe::subscribe` cannot be undone; each call starts a thread
  that lives until the process exits. A returned subscription handle would allow stopping it.
- **Core (`att-core::microphone`)**: the Windows classifier needs executable ids: Teams
  `ms-teams.exe`, `teams.exe` (classic); Slack `slack.exe`; Zoom `zoom.exe`; browsers
  `chrome.exe`, `msedge.exe`, `firefox.exe`, `brave.exe`, `opera.exe`, `vivaldi.exe`; Webex
  `ciscocollabhost.exe` (and `atmgr.exe` for Webex Meetings, to confirm); Discord `discord.exe`.
  Packaged apps without a mapping arrive as family names (`Name_PublisherId`).

## Verification done here (macOS, no Windows machine)

- `cargo check -p att-platform --target x86_64-pc-windows-msvc` and `--target aarch64-pc-windows-msvc`
- `cargo clippy -p att-platform --target x86_64-pc-windows-msvc --all-targets -- -D warnings`
  (also ARM64 and macOS): type-checks the Windows code, its tests and the example.
- `cargo test -p att-platform`: the 35 `windows_parse` tests and 4 `unsupported` tests run on macOS.
- Not possible here: running any Win32 or COM call. The Windows-only tests
  (`windows::credentials`, `windows::microphone`, `windows::presence`, `windows::figma`) compile
  but only run on Windows.

## Manual verification on Windows

Use Windows 11 (and, if available, Windows 10 22H2 and an ARM64 PC). Install Rust (MSVC
toolchain), check out the branch, then from the repository root:

1. **Unit tests.** `cargo test -p att-platform`. Expect every test to pass, including the
   Windows-only ones (credentials round trip, long secrets, UTF-16 credential, presence sample,
   `subscribe`, notepad identity, consent store read, WASAPI from several threads, Figma timing).
2. **Read-only overview.** `cargo run -p att-platform --example probe_windows -- all`. Expect
   `calendar access: Unsupported` (no prompt), `microphone supported: true`, a presence sample
   with the terminal as foreground app, a microphone block, and a Figma line in under 2,000 ms.
3. **Credentials.** `cargo run -p att-platform --example probe_windows -- credentials`. Every line
   must be `PASS`. Then, in the app (when available), save an Azure PAT and open Control Panel →
   Credential Manager → Windows Credentials: expect a generic credential
   `be.yarne.azure-timetracker:azure:<org>` with user name `azure:<org>` and persistence
   "Local computer". Sign out and in: the app still finds it. `cmdkey /list:be.yarne*` lists it.
4. **Presence.** `… -- presence 60` and, while it runs:
   - stay still: `idle` grows by about 1 s per line; move the mouse: it drops to 0;
   - focus Notepad → `notepad.exe "Notepad"`; Calculator → `calculatorapp.exe` (Windows 11) or
     `calculator.exe` (Windows 10), never `applicationframehost.exe`; Task Manager (elevated) →
     `taskmgr.exe`;
   - press Win+L for 10 s: lines while locked show `locked Some(true)`, after unlocking `Some(false)`.
5. **Events.** `… -- events 600` and:
   - Win+L, then unlock → `ScreenLocked`, `ScreenUnlocked`;
   - Start → Power → Sleep, then wake → `WillSleep` and exactly one `DidWake`
     (on Modern Standby PCs record what arrives);
   - let the display turn off (Settings → System → Power → Screen off after 1 minute) → 
     `DisplaysSlept`, then `DisplaysWoke` on input;
   - switch user and back → `SessionResigned`, `SessionActivated` (plus lock/unlock);
   - optional: connect to this session over Remote Desktop → `SessionResigned` then
     `SessionActivated`.
   Start the probe right after logon once (e.g. from the Startup folder) to check that session
   notifications still register (the retry path).
6. **Microphone.** `… -- mic 300`. For each app below, start using the microphone, wait 4 s,
   stop, and copy the printed blocks into the results table:
   - Sound Recorder (packaged): expect a `registry packaged Microsoft.WindowsSoundRecorder_…` row,
     a matching `session`, and an owner named after the app; nothing after stopping.
   - New Teams call or meet-now: owner `ms-teams.exe "Microsoft Teams"` with a PID. Also record
     what happens while muted, and which process owns the session (`ms-teams.exe`,
     `msedgewebview2.exe`, …).
   - Zoom (`zoom.exe`), Chrome/Edge with Google Meet (`chrome.exe "Google Chrome"`,
     `msedge.exe "Microsoft Edge"`), Slack huddle (`slack.exe`), Webex and Discord if available.
   - Store Slack if installed: confirm the family with `Get-AppxPackage *Slack* | Select PackageFamilyName`
     (expected `91750D7E.Slack_8she8kybcnzg4`) and that the owner is `slack.exe`.
   - Stale row: start recording in a desktop app (e.g. Audacity), kill it in Task Manager, and
     check with `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged" /s /v LastUsedTimeStop`.
     If the row keeps `LastUsedTimeStop` 0, the probe must still print `owner none` with
     `wasapi complete`.
   - Report any `session` without a matching `registry` row: it would mean the consent store is
     not authoritative on that build.
   - Each block prints its duration; expect well under 100 ms.
7. **Figma.** Install Figma Desktop. `… -- figma 120`:
   - another app in front → `NotForeground`;
   - Figma home/recents → `Window { title: …, url: … }` (record exactly);
   - a design file → expect `title: Some("<file name>")`; record whether `url` is
     `Some("https://www.figma.com/design/<key>/…")` and the duration (must stay under 2,000 ms).
     This is the phase 0 URL spike: if the URL is missing, inspect the window with Accessibility
     Insights for Windows (or `inspect.exe`) and note which element, if any, carries the address;
   - switch file tabs → title/url follow the active tab; Alt+Tab away during a read →
     `NotForeground` or `Waiting`, never stale data;
   - the first line prints `figma installed: true`; after uninstalling Figma, `false`.
8. **App identity.** `… -- identity C:\Windows\System32\notepad.exe` → `notepad.exe`, name
   "Notepad"; an Office or Teams classic executable → its product description;
   `… -- identity C:\Windows\win.ini` → "Choose a program file (.exe)."
9. Repeat 2, 4 and 6 on ARM64 if possible (`aarch64-pc-windows-msvc`).

Record results as: step · Windows edition/build · result · notes.

## Known gaps and risks

- Nothing here has run on Windows yet; only compilation, lints and the pure helpers are verified.
- Directed `WM_POWERBROADCAST` delivery to a message-only window relies on
  `RegisterSuspendResumeNotification`; step 5 confirms it. The engine also infers sleep from
  sample gaps.
- The consent store is undocumented and may change between Windows builds.
- Capture invisible to shared-mode session enumeration (exclusive mode) is dropped when the WASAPI
  view is complete. Meeting apps use shared mode.
- If an app captures in a helper process without its package identity (WebView2), the owner is
  that helper (e.g. `msedgewebview2.exe`); step 6 records which process new Teams uses.
- The Slack Store family name and the `MicrosoftTeams` mapping come from documentation and
  community sources, not from a test machine.
- Figma URL reading depends on Chromium exposing the document address through UI Automation; the
  first read after Figma starts may only return the title while Chromium builds its tree.
