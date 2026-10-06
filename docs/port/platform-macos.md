# att-platform: macOS implementation

Scope: `crates/att-platform/src/macos/**`, the macOS dependency section of
`crates/att-platform/Cargo.toml`, `crates/att-platform/examples/probe_macos.rs`.
Baseline: Swift 1.14.2. Target: macOS 14+ (the microphone probe needs 14.2+).

| Trait | Type | Swift source | System API |
|---|---|---|---|
| `Credentials` | `KeychainCredentials` | `SecretStore` (`LocalServices.swift`) | `SecItemCopyMatching/Update/Add/Delete` via `objc2-security` |
| `CalendarSource` | `EventKitCalendar` | `CalendarService` (`LocalServices.swift`), "Open Calendar" (`Pages.swift`) | EventKit via `objc2-event-kit` |
| `MicrophoneProbe` | `CoreAudioMicrophone` | `MicrophoneReader` (`MicrophoneService.swift`) | Core Audio HAL process objects via `objc2-core-audio`, `proc_pidpath`, `NSRunningApplication`, `NSBundle` |
| `PresenceProbe` | `MacPresence` | `WorkPresenceService.swift`, "Add work application" (`WorkAwarenessViews.swift`) | `CGEventSource`, `CGSession`, `NSWorkspace`, `NSDistributedNotificationCenter` |
| `FigmaObserver` | `AxFigmaObserver` | `FigmaReader`/`FigmaService` (`FigmaService.swift`) | Accessibility (`AXUIElement*`, `AXIsProcessTrusted*`) via `objc2-application-services` |

`macos::platform()` bundles them with the production Keychain service.

## Decisions

### Credentials

- **Crate: `objc2-security` (raw `SecItem*`).** The query dictionaries are built key for key like
  Swift: `{kSecClass: genericPassword, kSecAttrService, kSecAttrAccount}`; reads add
  `kSecReturnData: true, kSecMatchLimit: one`; saves call `SecItemUpdate({kSecValueData})` first
  and only on `errSecItemNotFound` call `SecItemAdd` with
  `kSecAttrAccessible: AfterFirstUnlockThisDeviceOnly`. No label, access group, synchronizable flag
  or `kSecUseDataProtectionKeychain`, so items live in the file-based login keychain exactly as in
  1.14.x. The `keyring` crate's Apple store and `security-framework`'s password helpers add first
  and update on duplicates, do not let us choose `kSecAttrAccessible`, and bring a second
  CoreFoundation binding family next to `objc2`.
- Verified: an item written by our code has the same attribute set as one written by the 1.14.x
  code (`acct, cdat, class=genp, labl=<service>, mdat, svce`; checked with a Swift replica of
  `SecretStore` on a throwaway service). The file-based keychain does not store
  `kSecAttrAccessible`.
- `KeychainCredentials::new(service)` takes any service; `Default` uses `CREDENTIAL_SERVICE`.
- Errors keep the Swift text: "Keychain could not read the saved credential (status).", "… save
  the credential (status).", "… remove this credential (status).". Bytes that are not UTF-8 read
  as `None`, as `String(data:encoding:)` did.
- Keychain calls can block while macOS shows an unlock or access prompt, as in 1.14.x. Call them
  from a blocking task without a short deadline.

### Calendar

- One `EKEventStore`, created on a dedicated `att-calendar` thread (`macos::serial::Serial`) by
  the first query made with full access; every EventKit call runs there and returns plain Rust
  values. Callers wait at most 2 s (`calendar::TIMEOUT`), then get "Calendar is not responding.
  Retrying automatically."; with 4 queries already queued new calls fail at once; a panicking job
  yields "Calendar could not be read." and the thread keeps running.
- `access()`: `fullAccess` → `Authorized`; `notDetermined`, `restricted` map 1:1; `denied`,
  `writeOnly` and unknown values → `Denied` (1.14.x only accepted `.fullAccess`).
- `request_access()` calls `requestFullAccessToEventsWithCompletion:` every time, like Swift
  (EventKit only prompts while undetermined). An `NSError` becomes `Failed(localizedDescription)`.
  The future resolves when the user answers; do not wrap it in a short timeout.
- `calendars()`: `calendars(for: .event)` sorted by title with Swift `String <` semantics (NFC
  scalar order); colour is `EKCalendar.CGColor` converted to sRGB, rounded to `#rrggbb`; `source`
  is `calendar.source.title`.
- `events(from, to, ids)`: the same selection rule as Swift (empty `ids` = all calendars; ids that
  match nothing = no events), `predicateForEvents(withStart:end:calendars:)` with the selected
  calendars. EventKit order is kept; cancelled, declined and free events are included with their
  flags, so the engine applies the agenda filter (`status != .canceled`) and sorts as Swift did.
- **`occurrence_id` is the 1.14.x `MeetingEvent.id`, byte for byte**:
  `SHA256("\(calendar.calendarIdentifier)|\(calendarItemIdentifier)|\(startDate.timeIntervalSince1970)")`,
  lower-case hex. The start is computed like Swift (`timeIntervalSinceReferenceDate + 978307200`)
  and printed like Swift's `Double.description` (`1759737600.0`, `1e+16`, `1e-05`), so migrated
  `meetingReminders` keys keep matching. Unit-tested against values printed by Swift 6.4.
- Field mapping: `declined` = an attendee with `isCurrentUser` and status `.declined`; `free` =
  availability `.free`; `status` from `EKEventStatus`; `url` = `URL.absoluteString`;
  `calendar_color` as above.
- A nil title becomes `""` (see requested changes): the engine shows "Untitled event" (agenda) or
  "Untitled meeting" (meeting prompts) for an empty title and passes `""` to ticket extraction.
  Events whose start or end date is nil are skipped (Swift would have crashed).
- Without full access `calendars()` and `events()` return empty lists, as the Swift refresh did.
- `open_calendar_app()` opens `/System/Applications/Calendar.app` with `NSWorkspace.openURL`.

### Microphone

- `supported()` is `macOS >= 14.2` (cached). `sample()` before 14.2 fails with the Swift text
  "Microphone app detection requires macOS 14.2 or later."; any HAL error fails the whole sample
  with "macOS microphone status is temporarily unavailable (status). Retrying automatically.",
  exactly like Swift (an error means "unknown").
- One `InputOwner` per process with input running, in HAL order. De-duplication by `id` and the
  name sort stay in the engine (`MicrophoneService.checkNow`).
- Owner resolution is Swift's, as a pure function (`resolve_owner`): path from `proc_pidpath`
  (4 × MAXPATHLEN, lossy UTF-8), else `NSRunningApplication.bundleURL.path`; the **outermost**
  path component ending in `.app` (case-sensitive, `.`/`..` kept as Foundation keeps them); that
  bundle's `CFBundleIdentifier` with `CFBundleDisplayName` → `CFBundleName` → file stem (read
  through `NSBundle`, so InfoPlist.strings localisations apply). Otherwise
  `running.bundleIdentifier ?? HAL bundle ID`; a `com.apple.webkit.` prefix (case-insensitive)
  gets the name **"WebKit (browser or web view)"** and keeps its bundle ID; no identifier gives
  `process:<pid>` / "Unidentified audio app"; otherwise the running app's localized name, else
  the id.
- `InputOwner.path` is the resolved bundle path (Foundation-standardized `bundlePath`), else the
  process path, else `None`.

### Presence

- `idle_seconds`: `CGEventSourceSecondsSinceLastEventType(combinedSessionState, ~0)`.
- `locked`: `CGSessionCopyCurrentDictionary()["CGSSessionScreenIsLocked"]` as Swift `as? Bool`
  (CFBoolean, or CFNumber 0/1). macOS only includes the key while locked and Swift only changed
  state when the key was present, so a missing key or dictionary is `None`, not `Some(false)`.
  Unlock is reported by the `ScreenUnlocked` notification, as in 1.14.x.
- `foreground`: `NSWorkspace.frontmostApplication` → bundle ID, localized name (empty when
  missing; the engine falls back to "your work app"), bundle path. An app without a bundle ID is
  `None`: 1.14.x never matched it (`watches(nil) == false`). Off the main thread the value is as
  fresh as the last main-run-loop turn (AppKit policy), which the Tauri event loop provides.
- `subscribe(sink)`: observers for `NSWorkspace` `willSleep` → `WillSleep`, `didWake` →
  `DidWake`, `screensDidSleep` → `DisplaysSlept`, `screensDidWake` → `DisplaysWoke`,
  `sessionDidResignActive` → `SessionResigned`, `sessionDidBecomeActive` → `SessionActivated`, and
  distributed `com.apple.screenIsLocked` → `ScreenLocked`, `com.apple.screenIsUnlocked` →
  `ScreenUnlocked`. The engine keeps 1.14.x's `unavailable` map (`sleep`/`display`/`session`/`lock`
  keys and the "Screen locked" / "Mac asleep or session inactive" reasons) from these events.
  **Threading:** callable from any thread. On the main thread it registers immediately; elsewhere
  it queues the registration on the main dispatch queue and returns without waiting. Delivery
  happens on the main thread and needs the main run loop (Tauri runs it; a CLI receives nothing).
  Registration happens once per `MacPresence`; later calls only add sinks. Sinks are called
  outside the lock and panics are caught. Dropping the probe removes the observers.
- `app_identity(path)`: `NSBundle` at the path → `CFBundleIdentifier` (missing → "An application
  has no bundle identifier.", the Swift text), name `CFBundleDisplayName` → `CFBundleName` → file
  stem, path = `bundlePath`.

### Figma

- `observe()` replicates one poll of `FigmaService` + `FigmaReader.read(pid:)`:
  `AXIsProcessTrusted` false → `MissingAccess`; frontmost app is not `com.figma.Desktop` →
  `NotForeground`; app element with `AXUIElementSetMessagingTimeout(0.12)`;
  `AXManualAccessibility = true` once per pid (failures log only the AX error code, at info level,
  target `att_platform::figma`); no focused window → `Waiting`; focused window title; depth-first
  walk of at most 200 nodes and 1.8 s (deadline starts after the title read, as in Swift), 0.12 s
  timeout per element, `AXURL` then `AXDocument` per node (`URL.absoluteString` or string),
  children pushed in reverse so document order is kept; the first address accepted by
  `FigmaDocument.parse` → `Window { title, url: Some(address) }`; none → `Window { title,
  url: None }`; if the frontmost pid changed during the read → `NotForeground`. Reads are
  serialized like the Swift actor.
- Mapping back to Swift `FigmaObservation` for the engine: `MissingAccess` → `.missingAccess`;
  `NotForeground` → `.waiting`; `Waiting` → `.noAddress`; `Window { url: None }` → `.noAddress`;
  `Window { url: Some(u), title }` → `FigmaDocument::parse(u, title ?? "")` → `.file`.
- **Duplicate rule:** to stop the walk where Swift stopped, `figma_address_accepted` re-implements
  only the acceptance part of `FigmaDocument.parse` (macOS 14+ `URLComponents` semantics: trim,
  bare `figma.com/` prefix, `https`, host `figma.com|www.figma.com` after percent-decoding, no
  user info, port nil or 443 (overflowing digits count as nil, as Foundation does), path segments
  `design|file|board|slides` / alphanumeric key / slug). It is checked against 99 addresses whose
  results Swift 6.4 printed. Replace it with `att_core::figma::FigmaDocument::parse(..).is_some()`
  once that port lands.
- `has_access` = `AXIsProcessTrusted()`; `request_access` = `AXIsProcessTrustedWithOptions`
  with `kAXTrustedCheckOptionPrompt: true` (the system shows its prompt asynchronously and the
  call returns the current state); `figma_installed` =
  `NSWorkspace.URLForApplicationWithBundleIdentifier("com.figma.Desktop") != nil`.

### Threading summary

Every method may be called from any thread; Objective-C work runs inside its own autorelease
pool (the engine's blocking-pool threads have none). Nothing waits for the main thread, so there
is no deadlock when the caller is the main thread. Bounded calls: calendar ≤ 2 s; Figma ≈ 1.8 s
plus at most a few 0.12 s AX timeouts. HAL, `NSWorkspace`, `CGSession` and `NSBundle` reads are
synchronous and normally take milliseconds. Keychain calls may block on a system prompt.

## Permissions and code identity (TCC)

- **Signed app (production).** The Tauri bundle must keep bundle ID `be.yarne.azure-timetracker`
  and be signed with the "Azure timetracker Local Signing" certificate and identifier (hardened
  runtime, as `scripts/sign-app.sh` does), so its designated requirement equals 1.14.x's. Then the
  Calendar and Accessibility grants and the Keychain item ACLs carry over without prompts.
- **Info.plist** (copy from `Resources/Info.plist`): `NSCalendarsFullAccessUsageDescription` and
  `NSCalendarsUsageDescription` (without them `requestFullAccessToEvents` fails or the process is
  terminated by TCC), `LSUIElement`. **Entitlement:** `com.apple.security.personal-information.calendars`
  (`Resources/App.entitlements`), required under the hardened runtime.
- **No other permission is needed:** the microphone probe reads HAL metadata only (no input
  stream, so no microphone prompt and no usage string); idle time via `CGEventSource` needs no
  Input Monitoring; `NSWorkspace` and `CGSession` need nothing. Accessibility must be granted by
  the user in System Settings → Privacy & Security → Accessibility.
- **Unbundled binaries (`cargo test`, `cargo run --example`).** They have no Info.plist and an
  ad-hoc linker signature that changes on every build. TCC attributes them to the responsible
  process (Terminal, iTerm, VS Code, …), so `calendar.access()` and `figma.has_access()` report
  that host app's grants, and a `request_access()` from them would prompt on behalf of the host
  app. Tests and the example therefore only read status. Keychain items are ACL'd to the code
  signature that created them: tests use `be.yarne.azure-timetracker.tests.<random>` and delete
  their items in the same process, and nothing in development reads the real service (a dev build
  reading 1.14.x items would show the "wants to use your confidential information" prompt). An
  ad-hoc-signed dev `.app` also loses its Accessibility and Calendar grants after each rebuild.

## Manual verification

1. `cargo run -p att-platform --example probe_macos` — prints `microphone.supported()` and one
   `sample()`, one presence sample, `calendar.access()`, `figma.has_access()` and
   `figma.figma_installed()`. No prompt may appear.
2. Microphone: start a Teams/Zoom/Slack call → the probe lists the app's bundle ID and display
   name (helpers resolve to the outer `.app`); a Safari or WebKit web meeting → "WebKit (browser
   or web view)"; nothing using input → empty list.
3. Presence: stop typing for 10 s → `idle_seconds` ≈ 10; the foreground app is the terminal.
   In the signed app with `subscribe`: lock (⌃⌘Q) / unlock → `ScreenLocked` / `ScreenUnlocked`
   and `locked == Some(true)` while locked; `pmset displaysleepnow` → `DisplaysSlept` /
   `DisplaysWoke`; sleep → `WillSleep` / `DidWake`; fast user switching → `SessionResigned` /
   `SessionActivated`.
4. Calendar (signed app): first `request_access` shows the full-access prompt; after granting,
   `calendars()` lists calendars with colours and account names; `events()` for today flags
   declined, free and cancelled events; today's `occurrence_id`s equal the `meetingReminders` keys
   in the 1.14.x `state.json`.
5. Figma (signed app with Accessibility): open a file in Figma Desktop → `Window { title, url:
   Some("https://www.figma.com/design/<key>/…") }`; switch to another app → `NotForeground`;
   revoke Accessibility → `MissingAccess`.
6. Keychain (signed app, 1.14.x installed): `get("7pace:<host>")` returns the token without a
   prompt; after `set`, 1.14.x still signs in.

## Traceability

| Swift | Rust | Status |
|---|---|---|
| `LocalServices.swift › SecretStore.read/save/delete` | `macos::keychain::KeychainCredentials::{get,set,delete}` | ported |
| `SecretStore.account(kind:scope:)` | — | caller's concern (account names in the trait docs) |
| `CalendarService.authorized` / `requestAccess()` | `EventKitCalendar::{access,request_access}` | ported |
| `CalendarService.refresh` (calendars, events, meeting ids) | `calendars`, `events`, `convert_event`, `occurrence_id` | ported; filtering, sorting and agenda/meeting shaping stay in the engine |
| `Pages.swift` "Open Calendar" | `open_calendar_app` | ported |
| `MicrophoneReader.read()` | `microphone::read_processes` | ported |
| `MicrophoneReader.owner(_:)` | `microphone::{facts,resolve_owner}`, `bundle::{enclosing_app,read_bundle}` | ported |
| `MicrophoneService.checkNow` (dedupe, sort, status text) | engine | not in scope |
| `WorkPresenceService.idleSeconds` / `foregroundApp` / lock poll | `MacPresence::sample` | ported (`None` for a missing lock key) |
| `WorkPresenceService.start()` observers | `MacPresence::subscribe` | ported (events; the `unavailable` map moves to the engine) |
| `WorkAwarenessSettings` "Add work application…" | `MacPresence::app_identity` | ported (+ display name) |
| `FigmaReader.read(pid:)`, `FigmaService` loop, `requestAccess`, `refreshPermission` | `AxFigmaObserver::{observe,request_access,has_access}` | ported |
| `FigmaService.open` (`urlForApplication`) | `figma_installed` | ported (opening uses the opener plugin) |
| `FigmaDocument.parse` (acceptance only) | `figma::figma_address_accepted` | adapted (temporary duplicate) |

Tests (38, all in-module under `crate::macos`, run by `cargo test -p att-platform`):

| Module | Tests |
|---|---|
| `swift` | `double_description_matches_swift`, `string_cmp_uses_canonical_equivalence`, `sha256_hex_is_lowercase_hex` |
| `calendar` | `occurrence_id_matches_swift_cryptokit`, `swift_reference_date_arithmetic_matches_since_1970`, `colour_components_round_to_the_nearest_byte`, `authorization_status_mapping`, `event_status_mapping`, `oneshot_delivers_value_or_reports_a_dropped_sender`, `access_reads_status_without_prompting`, `without_full_access_nothing_is_read`, `events_and_calendars_convert_like_1_14` (EventKit stand-in classes answering the same selectors) |
| `serial` | `jobs_run_in_order_on_the_owning_thread`, `slow_jobs_time_out_and_a_full_queue_fails_fast`, `a_panicking_job_does_not_stop_the_thread` |
| `bundle` | `enclosing_app_matches_foundation_path_components`, `relative_paths_resolve_against_the_working_directory`, `file_stem_drops_only_the_last_extension`, `reads_identifier_and_name_fallbacks_from_info_plist` |
| `microphone` | `helper_processes_resolve_to_the_enclosing_app`, `webkit_helpers_get_the_webkit_label`, `falls_back_to_running_app_then_hal_then_pid`, `bundles_without_identifier_fall_through`, `resolves_a_real_bundle_on_disk`, `hal_sample_reads_metadata_only` |
| `presence` | `lock_value_mirrors_swift_bool_bridging`, `app_identity_reads_the_bundle`, `sample_reads_without_prompting`, `subscribe_registers_once_from_any_thread`, `workspace_notifications_map_to_system_events` |
| `figma` | `address_acceptance_matches_swift_figma_document_parse`, `walk_is_depth_first_in_document_order_and_stops_at_the_first_address`, `walk_visits_at_most_200_nodes`, `walk_respects_the_deadline`, `has_access_reads_without_prompting` |
| `keychain` (integration, real login keychain, throwaway service) | `keychain_round_trip_with_throwaway_service`, `items_carry_exactly_the_attributes_1_14_writes`, `production_service_is_the_1_14_service` |

The Keychain integration test lives in `src/macos/keychain.rs` because `crates/att-platform/tests/`
is outside this scope. Swift reference values (Double descriptions, SHA-256 occurrence ids,
`URL.pathComponents`, `FigmaDocument.parse` results, `SecretStore` item attributes) were printed by
small Swift 6.4 programs and are embedded in the tests.

## Requested contract changes (`src/lib.rs`)

1. `CalendarEvent.title: Option<String>` — Swift distinguished nil ("Untitled event" /
   "Untitled meeting") from an empty title. Until then nil is `""`.
2. Add `CalendarEvent.calendar_title` — `MeetingEvent.calendar` and `AgendaEvent.calendar` used
   `event.calendar.title`; today the engine must join with `calendars()`.
3. `PresenceProbe::subscribe` docs: "callable from any thread; registers on the main thread;
   delivery needs the main run loop" instead of "Must be called on the main thread".
4. `PresenceSample.locked` docs: `None` also means "not reported" (macOS omits the key while
   unlocked).
5. Share the Figma address acceptance rule: move it into `att-core` (`FigmaDocument::parse`) for
   both OS observers, or let `FigmaObserver::observe` take an address predicate.
