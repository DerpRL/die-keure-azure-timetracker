//! Pure helpers used by the Windows implementation, compiled and tested on every OS.
//!
//! Everything that decides something lives here so it can be unit-tested on macOS: registry key
//! names, FILETIME values, executable names, package families, tick arithmetic, lock flags,
//! notification mapping, the microphone merge rule, credential blob splitting and the Figma URL
//! search. `src/windows/` only performs the Win32/COM calls and feeds the results in.

use std::collections::{BTreeSet, VecDeque};

use jiff::Timestamp;

use crate::{InputOwner, SystemEvent};

// ---------------------------------------------------------------------------------------------
// Paths and executable names

/// Lower-case file name of a Windows path: `C:\Program Files\Zoom\bin\Zoom.exe` → `zoom.exe`.
/// Accepts `\` and `/` separators; `None` for an empty name.
pub fn exe_name(path: &str) -> Option<String> {
    let name = path.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next()?.trim();
    (!name.is_empty()).then(|| name.to_lowercase())
}

/// File name without its last extension, case preserved: `C:\Apps\Zoom.exe` → `Zoom`.
pub fn file_stem(path: &str) -> Option<String> {
    let name = path.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next()?.trim();
    let stem = match name.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem,
        _ => name,
    };
    (!stem.is_empty()).then(|| stem.to_string())
}

/// Whether a path names an `.exe` file (case-insensitive).
pub fn is_exe_path(path: &str) -> bool {
    exe_name(path).is_some_and(|name| name.len() > 4 && name.ends_with(".exe"))
}

/// The executable an `App Paths` default value names: trimmed, without surrounding quotes, and
/// only when it is an `.exe` path.
pub fn app_paths_value(raw: &str) -> Option<String> {
    let text = raw.trim_matches(|c: char| c == '\0' || c.is_whitespace());
    let text = text.strip_prefix('"').and_then(|rest| rest.strip_suffix('"')).unwrap_or(text);
    is_exe_path(text).then(|| text.to_string())
}

/// Trims a version-resource string and drops empty ones.
pub fn clean_description(raw: &str) -> Option<String> {
    let text = raw.trim_matches(|c: char| c == '\0' || c.is_whitespace());
    (!text.is_empty()).then(|| text.to_string())
}

/// UTF-16 up to the first NUL (or the whole slice), lossy.
pub fn utf16_until_nul(units: &[u16]) -> String {
    let end = units.iter().position(|&unit| unit == 0).unwrap_or(units.len());
    String::from_utf16_lossy(&units[..end])
}

// ---------------------------------------------------------------------------------------------
// Version resources (FileDescription)

/// `VerQueryValueW` sub-block for a string value, e.g. `\StringFileInfo\040904b0\FileDescription`.
pub fn version_string_query(language: u16, codepage: u16, name: &str) -> String {
    format!("\\StringFileInfo\\{language:04x}{codepage:04x}\\{name}")
}

/// Language/codepage pairs from `\VarFileInfo\Translation` (pairs of `u16`), followed by the
/// usual fallbacks for files without a translation table: US English Unicode, US English
/// Windows-1252 and language-neutral Unicode.
pub fn version_translations(raw: &[u16]) -> Vec<(u16, u16)> {
    let mut pairs: Vec<(u16, u16)> =
        raw.as_chunks::<2>().0.iter().map(|&[language, codepage]| (language, codepage)).collect();
    for fallback in [(0x0409, 0x04B0), (0x0409, 0x04E4), (0x0000, 0x04B0)] {
        if !pairs.contains(&fallback) {
            pairs.push(fallback);
        }
    }
    pairs
}

// ---------------------------------------------------------------------------------------------
// Errors

/// Short label for an error code in user-facing messages: Win32 errors wrapped in an HRESULT
/// (`0x8007xxxx`) show their Win32 number, other HRESULTs show hex.
pub fn error_code_label(hresult: i32) -> String {
    let code = hresult as u32;
    if code & 0xFFFF_0000 == 0x8007_0000 {
        format!("error {}", code & 0xFFFF)
    } else {
        format!("0x{code:08X}")
    }
}

// ---------------------------------------------------------------------------------------------
// OS version

/// First build with the microphone usage times in the consent store (Windows 10 1903).
pub const MICROPHONE_MIN_BUILD: u32 = 18362;

/// Whether this Windows version records per-app microphone use (`LastUsedTimeStart/Stop`).
pub fn microphone_supported(major: u32, build: u32) -> bool {
    major > 10 || (major == 10 && build >= MICROPHONE_MIN_BUILD)
}

// ---------------------------------------------------------------------------------------------
// FILETIME

/// FILETIME of 1970-01-01T00:00:00Z: 100 ns intervals since 1601-01-01.
pub const FILETIME_UNIX_EPOCH: u64 = 116_444_736_000_000_000;

/// FILETIME (100 ns intervals since 1601-01-01 UTC) as a timestamp. `0` means "never" and maps
/// to `None`, as do values outside the timestamp range.
pub fn filetime_to_timestamp(filetime: u64) -> Option<Timestamp> {
    if filetime == 0 {
        return None;
    }
    const TICKS_PER_SECOND: i128 = 10_000_000;
    let ticks = i128::from(filetime) - i128::from(FILETIME_UNIX_EPOCH);
    let seconds = i64::try_from(ticks.div_euclid(TICKS_PER_SECOND)).ok()?;
    let nanoseconds = i32::try_from(ticks.rem_euclid(TICKS_PER_SECOND) * 100).ok()?;
    // `Timestamp::new` range-checks; `from_nanosecond` only checks the i64 range (jiff 0.2.37).
    Timestamp::new(seconds, nanoseconds).ok()
}

// ---------------------------------------------------------------------------------------------
// Idle time

/// Milliseconds since the last input. `GetLastInputInfo` reports a 32-bit tick that wraps every
/// 49.7 days, so the difference is taken in 32-bit arithmetic against the low half of
/// `GetTickCount64`. A "negative" difference (input that landed between the two calls) reads as
/// more than 2^31 ms and is reported as 0.
pub fn idle_millis(now_ticks: u64, last_input_ticks: u32) -> u64 {
    let elapsed = (now_ticks as u32).wrapping_sub(last_input_ticks);
    if elapsed > i32::MAX as u32 { 0 } else { u64::from(elapsed) }
}

// ---------------------------------------------------------------------------------------------
// Session lock flags (`WTSINFOEX_LEVEL1_W::SessionFlags`)

pub const WTS_SESSIONSTATE_LOCK: i32 = 0;
pub const WTS_SESSIONSTATE_UNLOCK: i32 = 1;

/// Windows 7 and Server 2008 R2 (6.1) report `SessionFlags` inverted (documented defect).
/// Newer builds, including every supported one, report them as documented.
pub fn lock_flags_inverted(major: u32, minor: u32) -> bool {
    major == 6 && minor == 1
}

/// `Some(true)` when the session is locked, `None` when Windows does not know
/// (`WTS_SESSIONSTATE_UNKNOWN` or any other value).
pub fn session_locked(flags: i32, inverted: bool) -> Option<bool> {
    let locked = match flags {
        WTS_SESSIONSTATE_LOCK => true,
        WTS_SESSIONSTATE_UNLOCK => false,
        _ => return None,
    };
    Some(locked != inverted)
}

// ---------------------------------------------------------------------------------------------
// Session and power notifications

/// `wParam` values of `WM_WTSSESSION_CHANGE`.
pub mod wts {
    pub const CONSOLE_CONNECT: u32 = 1;
    pub const CONSOLE_DISCONNECT: u32 = 2;
    pub const REMOTE_CONNECT: u32 = 3;
    pub const REMOTE_DISCONNECT: u32 = 4;
    pub const SESSION_LOCK: u32 = 7;
    pub const SESSION_UNLOCK: u32 = 8;
}

/// `wParam` values of `WM_POWERBROADCAST`.
pub mod pbt {
    pub const APM_SUSPEND: u32 = 4;
    pub const APM_RESUME_SUSPEND: u32 = 7;
    pub const APM_RESUME_AUTOMATIC: u32 = 18;
    pub const POWER_SETTING_CHANGE: u32 = 0x8013;
}

/// Maps `WM_WTSSESSION_CHANGE`. Console and remote (RDP) connects and disconnects both count, so
/// a session the user reconnects to over Remote Desktop is active again.
pub fn session_change_event(wparam: u32) -> Option<SystemEvent> {
    match wparam {
        wts::SESSION_LOCK => Some(SystemEvent::ScreenLocked),
        wts::SESSION_UNLOCK => Some(SystemEvent::ScreenUnlocked),
        wts::CONSOLE_DISCONNECT | wts::REMOTE_DISCONNECT => Some(SystemEvent::SessionResigned),
        wts::CONSOLE_CONNECT | wts::REMOTE_CONNECT => Some(SystemEvent::SessionActivated),
        _ => None,
    }
}

/// De-duplicates power notifications. Windows always sends `PBT_APMRESUMEAUTOMATIC` on resume
/// and additionally `PBT_APMRESUMESUSPEND` when a user woke the machine, so one resume yields one
/// `DidWake`. A resume without a preceding suspend notification still yields `DidWake`.
#[derive(Debug, Default, Clone)]
pub struct PowerTracker {
    asleep: Option<bool>,
    display_on: Option<bool>,
}

impl PowerTracker {
    /// `wParam` of `WM_POWERBROADCAST` (other than `PBT_POWERSETTINGCHANGE`).
    pub fn power(&mut self, wparam: u32) -> Option<SystemEvent> {
        match wparam {
            pbt::APM_SUSPEND => {
                (self.asleep.replace(true) != Some(true)).then_some(SystemEvent::WillSleep)
            }
            pbt::APM_RESUME_AUTOMATIC | pbt::APM_RESUME_SUSPEND => {
                (self.asleep.replace(false) != Some(false)).then_some(SystemEvent::DidWake)
            }
            _ => None,
        }
    }

    /// `GUID_CONSOLE_DISPLAY_STATE` value: 0 off, 1 on, 2 dimmed (still on). Windows sends the
    /// current state right after registration; that first report only emits when the display is
    /// already off.
    pub fn display(&mut self, state: u32) -> Option<SystemEvent> {
        let on = state != 0;
        match (self.display_on.replace(on), on) {
            (Some(true) | None, false) => Some(SystemEvent::DisplaysSlept),
            (Some(false), true) => Some(SystemEvent::DisplaysWoke),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Microphone: consent store

/// `HKCU\` + this path holds per-app microphone use (Windows 10 1903+).
pub const MICROPHONE_CONSENT_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

/// Subkey of [`MICROPHONE_CONSENT_KEY`] that holds desktop (unpackaged) apps.
pub const NON_PACKAGED_KEY: &str = "NonPackaged";

/// Decodes a `NonPackaged` subkey name: the executable path with `#` instead of `\`.
/// `C:#Program Files#Zoom#bin#Zoom.exe` → `C:\Program Files\Zoom\bin\Zoom.exe`. The encoding is
/// lossy (a `#` in the real path decodes as `\`), so matching uses [`path_to_non_packaged_key`].
pub fn non_packaged_key_to_path(key: &str) -> String {
    key.replace('#', "\\")
}

/// Encodes a real path the way the consent store names its `NonPackaged` subkeys.
pub fn path_to_non_packaged_key(path: &str) -> String {
    path.replace(['\\', '/'], "#")
}

/// An app is using the microphone when `LastUsedTimeStart` is set and `LastUsedTimeStop` is 0.
/// A missing `LastUsedTimeStop` value counts as 0.
pub fn consent_in_use(start: u64, stop: Option<u64>) -> bool {
    start != 0 && stop.unwrap_or(0) == 0
}

/// One consent-store app.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum ConsentApp {
    /// Packaged (MSIX/Store) app: the subkey name is its package family name.
    Packaged { family: String },
    /// Desktop app: the subkey name under `NonPackaged` (path with `#` for `\`).
    NonPackaged { key: String },
}

/// A consent-store row that says "in use".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsentUse {
    pub app: ConsentApp,
    /// `LastUsedTimeStart` (FILETIME).
    pub started: u64,
}

/// A process that owns an active WASAPI capture session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureSession {
    pub pid: u32,
    /// Full image path when the process could be opened.
    pub path: Option<String>,
    /// Package family name when the process has package identity.
    pub family: Option<String>,
}

/// What WASAPI said about active capture sessions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionView {
    /// Every active capture endpoint was enumerated: the list is authoritative.
    Complete(Vec<CaptureSession>),
    /// Some endpoint or session could not be read: the list may miss processes.
    Partial(Vec<CaptureSession>),
    /// WASAPI could not be queried at all.
    Unavailable,
}

/// A consent-store app that survived the merge, with the session that confirms it (if any).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicrophoneUse {
    pub app: ConsentApp,
    pub started: u64,
    pub session: Option<CaptureSession>,
}

/// The merge rule between the consent store and WASAPI:
///
/// 1. The consent store decides *which apps* use the microphone: a row is a candidate when
///    `LastUsedTimeStart != 0` and `LastUsedTimeStop == 0`. WASAPI sessions without a candidate
///    row are never reported.
/// 2. A candidate is confirmed by an active capture session whose process belongs to it: same
///    package family (packaged apps; for known families also the mapped executable name when
///    the family cannot be read), or the same executable path (desktop apps, compared in the
///    consent store's `#` encoding, case-insensitive), or the same executable file name for an
///    unpackaged process. Among several matching sessions the one running the expected
///    executable wins, then the lowest PID. The confirmed session supplies `pid` and `path`.
/// 3. When the WASAPI view is complete, an unconfirmed candidate is dropped as stale: the
///    consent store keeps `LastUsedTimeStop == 0` after a crash until the app next uses the
///    microphone. When the view is partial or unavailable, unconfirmed candidates are kept
///    without a PID, because "unknown" must not read as "silent".
pub fn merge_microphone_use(candidates: Vec<ConsentUse>, view: &SessionView) -> Vec<MicrophoneUse> {
    let (sessions, authoritative) = match view {
        SessionView::Complete(sessions) => (sessions.as_slice(), true),
        SessionView::Partial(sessions) => (sessions.as_slice(), false),
        SessionView::Unavailable => (&[][..], false),
    };
    candidates
        .into_iter()
        .filter_map(|candidate| {
            let session = best_session(&candidate.app, sessions).cloned();
            if session.is_none() && authoritative {
                return None;
            }
            Some(MicrophoneUse { app: candidate.app, started: candidate.started, session })
        })
        .collect()
}

fn same_text(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b) || a.to_lowercase() == b.to_lowercase()
}

fn session_matches(app: &ConsentApp, session: &CaptureSession) -> bool {
    let session_exe = session.path.as_deref().and_then(exe_name);
    match app {
        ConsentApp::Packaged { family } => match &session.family {
            Some(session_family) => same_text(session_family, family),
            None => {
                known_package(family).is_some_and(|known| session_exe.as_deref() == Some(known.id))
            }
        },
        ConsentApp::NonPackaged { key } => {
            let Some(path) = session.path.as_deref() else { return false };
            if same_text(&path_to_non_packaged_key(path), key) {
                return true;
            }
            session.family.is_none()
                && session_exe.is_some()
                && session_exe == exe_name(&non_packaged_key_to_path(key))
        }
    }
}

fn expected_exe(app: &ConsentApp) -> Option<String> {
    match app {
        ConsentApp::Packaged { family } => known_package(family).map(|known| known.id.to_string()),
        ConsentApp::NonPackaged { key } => exe_name(&non_packaged_key_to_path(key)),
    }
}

fn best_session<'a>(
    app: &ConsentApp,
    sessions: &'a [CaptureSession],
) -> Option<&'a CaptureSession> {
    let expected = expected_exe(app);
    sessions.iter().filter(|session| session_matches(app, session)).min_by_key(|session| {
        let runs_expected = expected.is_some()
            && session.path.as_deref().and_then(exe_name).as_deref() == expected.as_deref();
        (!runs_expected, session.pid)
    })
}

/// Turns merged rows into [`InputOwner`]s. `describe` returns the FileDescription of an
/// executable path. Rows that map to the same `id` collapse into one (confirmed rows first, then
/// the most recent start); the result is sorted by name, then id.
pub fn input_owners(
    mut uses: Vec<MicrophoneUse>,
    describe: impl Fn(&str) -> Option<String>,
) -> Vec<InputOwner> {
    uses.sort_by(|a, b| {
        b.session.is_some().cmp(&a.session.is_some()).then(b.started.cmp(&a.started))
    });
    let mut seen = BTreeSet::new();
    let mut owners: Vec<InputOwner> = uses
        .iter()
        .map(|row| input_owner(row, &describe))
        .filter(|owner| seen.insert(owner.id.clone()))
        .collect();
    owners.sort_by(|a, b| {
        a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.id.cmp(&b.id))
    });
    owners
}

/// Identity of one merged row.
///
/// - Known package families use their mapped id and name (see [`known_package`]).
/// - Other packaged apps keep the package family name as `id`; the name is the FileDescription
///   of the confirmed process, else the package name.
/// - Desktop apps use the lower-case executable file name as `id` and the FileDescription (else
///   the file stem) as `name`.
pub fn input_owner(row: &MicrophoneUse, describe: &impl Fn(&str) -> Option<String>) -> InputOwner {
    let pid = row.session.as_ref().map(|session| session.pid);
    let session_path = row.session.as_ref().and_then(|session| session.path.clone());
    match &row.app {
        ConsentApp::Packaged { family } => match known_package(family) {
            Some(known) => InputOwner {
                id: known.id.to_string(),
                name: known.name.to_string(),
                pid,
                path: session_path,
            },
            None => InputOwner {
                id: family.clone(),
                name: session_path
                    .as_deref()
                    .and_then(describe)
                    .unwrap_or_else(|| package_name(family).to_string()),
                pid,
                path: session_path,
            },
        },
        ConsentApp::NonPackaged { key } => {
            let path = session_path.unwrap_or_else(|| non_packaged_key_to_path(key));
            let id = exe_name(&path).unwrap_or_else(|| key.to_lowercase());
            let name = describe(&path).or_else(|| file_stem(&path)).unwrap_or_else(|| id.clone());
            InputOwner { id, name, pid, path: Some(path) }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Package families

/// A packaged app with a fixed identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KnownPackage {
    /// The `InputOwner.id` to report, shared with the desktop build of the same app.
    pub id: &'static str,
    pub name: &'static str,
}

/// Package name (before the publisher ID) → identity. Package names cannot contain `_`.
///
/// - `MSTeams`: new Teams (work or school, and Teams free since 2024), executable `ms-teams.exe`.
/// - `MicrosoftTeams`: the Teams (free) app that Windows 11 preinstalled before that merge.
///   Reported as `ms-teams.exe` so one per-OS app entry covers every Teams build.
/// - `91750D7E.Slack`: Slack from the Microsoft Store (desktop Slack reports `slack.exe` too).
///
/// Zoom has no packaged build: its Store listing installs the desktop app, which appears under
/// `NonPackaged` as `zoom.exe`.
const KNOWN_PACKAGES: &[(&str, KnownPackage)] = &[
    ("MSTeams", KnownPackage { id: "ms-teams.exe", name: "Microsoft Teams" }),
    ("MicrosoftTeams", KnownPackage { id: "ms-teams.exe", name: "Microsoft Teams" }),
    ("91750D7E.Slack", KnownPackage { id: "slack.exe", name: "Slack" }),
];

/// The package name of a family name: `MSTeams_8wekyb3d8bbwe` → `MSTeams`.
pub fn package_name(family: &str) -> &str {
    family.rsplit_once('_').map_or(family, |(name, _)| name)
}

/// Identity for a known package family (case-insensitive), e.g. `MSTeams_8wekyb3d8bbwe`.
pub fn known_package(family: &str) -> Option<KnownPackage> {
    let name = package_name(family);
    KNOWN_PACKAGES.iter().find(|(known, _)| known.eq_ignore_ascii_case(name)).map(|(_, id)| *id)
}

// ---------------------------------------------------------------------------------------------
// Credential Manager blobs

/// `CRED_MAX_CREDENTIAL_BLOB_SIZE`: the largest blob one generic credential holds.
pub const CREDENTIAL_BLOB_LIMIT: usize = 2560;

/// Longest secret this crate stores (in parts of [`CREDENTIAL_BLOB_LIMIT`] bytes).
pub const CREDENTIAL_MAX_PARTS: usize = 8;

/// TargetName of a credential: `be.yarne.azure-timetracker:7pace:example.timehub.7pace.com`.
pub fn credential_target(service: &str, account: &str) -> String {
    format!("{service}:{account}")
}

/// TargetName of continuation part `part` (2, 3, …) of a secret longer than one blob. Part 1 is
/// the credential itself ([`credential_target`]).
pub fn credential_part_target(service: &str, account: &str, part: usize) -> String {
    format!("{service}:{account}#part{part}")
}

/// Splits a secret into blobs: at least one (possibly empty), each at most
/// [`CREDENTIAL_BLOB_LIMIT`] bytes. `None` when it needs more than [`CREDENTIAL_MAX_PARTS`].
/// Readers keep reading parts while a blob is exactly full, so a writer must delete any parts
/// after the last one it writes.
pub fn credential_parts(secret: &[u8]) -> Option<Vec<&[u8]>> {
    let parts: Vec<&[u8]> = if secret.is_empty() {
        vec![secret]
    } else {
        secret.chunks(CREDENTIAL_BLOB_LIMIT).collect()
    };
    (parts.len() <= CREDENTIAL_MAX_PARTS).then_some(parts)
}

/// Decodes a credential blob. This crate writes UTF-8; credentials typed into Credential Manager
/// or `cmdkey` are UTF-16LE, so those are read too. Trailing NULs are ignored. `None` when the
/// blob is neither.
pub fn decode_secret(blob: &[u8]) -> Option<String> {
    let trimmed = &blob[..blob.iter().rposition(|&byte| byte != 0).map_or(0, |last| last + 1)];
    if !trimmed.contains(&0)
        && let Ok(text) = std::str::from_utf8(trimmed)
    {
        return Some(text.to_string());
    }
    if blob.len().is_multiple_of(2) {
        let units: Vec<u16> =
            blob.as_chunks::<2>().0.iter().map(|&pair| u16::from_le_bytes(pair)).collect();
        let end = units.iter().rposition(|&unit| unit != 0).map_or(0, |last| last + 1);
        if let Ok(text) = String::from_utf16(&units[..end]) {
            return Some(text);
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------
// Figma

/// Executable of Figma Desktop (lower case, as [`exe_name`] returns it).
pub const FIGMA_EXE: &str = "figma.exe";

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &text[prefix.len()..])
}

/// The trimmed text when it is a `https://www.figma.com/…` or `https://figma.com/…` URL.
/// Text with spaces or control characters, and very long text, is rejected.
pub fn figma_url(text: &str) -> Option<&str> {
    let url = text.trim();
    if url.len() > 4096 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let rest = strip_prefix_ignore_case(url, "https://www.figma.com/")
        .or_else(|| strip_prefix_ignore_case(url, "https://figma.com/"))?;
    (!rest.is_empty()).then_some(url)
}

/// Whether a Figma URL points at a document (`/design/<key>`, `/file/<key>`, `/board/<key>`,
/// `/slides/<key>`, the kinds the core parser accepts), not at the file browser.
pub fn is_figma_file_url(url: &str) -> bool {
    let Some(url) = figma_url(url) else { return false };
    let rest = strip_prefix_ignore_case(url, "https://www.figma.com/")
        .or_else(|| strip_prefix_ignore_case(url, "https://figma.com/"))
        .unwrap_or_default();
    let path = rest.split(['?', '#']).next().unwrap_or_default();
    let mut segments = path.split('/');
    let kind = segments.next().unwrap_or_default().to_ascii_lowercase();
    let key = segments.next().unwrap_or_default();
    ["design", "file", "board", "slides"].contains(&kind.as_str())
        && !key.is_empty()
        && key.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// The file name in a Figma window title: trims, drops a trailing " – Figma" (also "-" or "—"),
/// and returns `None` for an empty title or the bare app name (home screen).
pub fn figma_window_title(raw: &str) -> Option<String> {
    let mut title = raw.trim();
    for suffix in [" – Figma", " - Figma", " — Figma"] {
        if let Some(stripped) = title.strip_suffix(suffix) {
            title = stripped.trim_end();
            break;
        }
    }
    (!title.is_empty() && !title.eq_ignore_ascii_case("figma")).then(|| title.to_string())
}

/// One UI Automation element as the Figma search sees it (cached properties).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UiElement<H> {
    pub handle: H,
    pub name: Option<String>,
    /// ValuePattern value (`UIA_ValueValuePropertyId`).
    pub value: Option<String>,
    pub offscreen: bool,
}

/// Keeps the best Figma URL seen so far: an on-screen document URL ends the search; otherwise
/// off-screen documents (background tabs) beat other Figma URLs, and earlier beats later.
#[derive(Debug, Default, Clone)]
pub struct FigmaUrlSearch {
    best: Option<(u8, String)>,
}

impl FigmaUrlSearch {
    /// Offers an element's value and name. Returns true when the search can stop.
    pub fn offer(&mut self, value: Option<&str>, name: Option<&str>, offscreen: bool) -> bool {
        for text in [value, name].into_iter().flatten() {
            let Some(url) = figma_url(text) else { continue };
            let rank = u8::from(is_figma_file_url(url)) * 2 + u8::from(!offscreen);
            if self.best.as_ref().is_none_or(|(best, _)| rank > *best) {
                self.best = Some((rank, url.to_string()));
            }
        }
        self.done()
    }

    pub fn done(&self) -> bool {
        self.best.as_ref().is_some_and(|(rank, _)| *rank == 3)
    }

    pub fn into_url(self) -> Option<String> {
        self.best.map(|(_, url)| url)
    }
}

/// Breadth-first search below `root` for a Figma URL in element values and names. At most
/// `max_elements` elements are examined (the root included); `children` is called once per
/// examined element while the budget lasts, and `expired` is checked before each call so the
/// caller can enforce an overall deadline. Breadth-first because Figma's web documents sit a
/// few levels below the window, while their own subtrees are large.
pub fn find_figma_url<H>(
    root: UiElement<H>,
    max_elements: usize,
    mut children: impl FnMut(&H) -> Vec<UiElement<H>>,
    mut expired: impl FnMut() -> bool,
) -> Option<String> {
    let mut search = FigmaUrlSearch::default();
    if max_elements == 0 {
        return None;
    }
    let mut budget = max_elements - 1;
    let mut queue = VecDeque::from([root]);
    while let Some(element) = queue.pop_front() {
        if search.offer(element.value.as_deref(), element.name.as_deref(), element.offscreen) {
            break;
        }
        if budget == 0 {
            continue;
        }
        if expired() {
            break;
        }
        for child in children(&element.handle).into_iter().take(budget) {
            budget -= 1;
            queue.push_back(child);
        }
    }
    search.into_url()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_paths_values_name_an_executable() {
        assert_eq!(
            app_paths_value("\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\"\0"),
            Some(r"C:\Program Files\PowerShell\7\pwsh.exe".to_string())
        );
        assert_eq!(app_paths_value(r"C:\Tools\code.exe"), Some(r"C:\Tools\code.exe".to_string()));
        assert_eq!(app_paths_value(r"C:\Tools\readme.txt"), None);
        assert_eq!(app_paths_value("  "), None);
    }

    #[test]
    fn exe_names_are_lower_case_file_names() {
        let cases = [
            (r"C:\Program Files\Zoom\bin\Zoom.exe", Some("zoom.exe")),
            (r"C:\Users\me\AppData\Local\Microsoft\Teams\current\Teams.exe", Some("teams.exe")),
            ("C:/Tools/Slack.EXE", Some("slack.exe")),
            (r"\\?\C:\Program Files\Google\Chrome\Application\chrome.exe", Some("chrome.exe")),
            (r"\Device\HarddiskVolume3\Windows\System32\notepad.exe", Some("notepad.exe")),
            ("ms-teams.exe", Some("ms-teams.exe")),
            (r"C:\Folder\", Some("folder")),
            ("", None),
            (r"\", None),
        ];
        for (path, expected) in cases {
            assert_eq!(exe_name(path).as_deref(), expected, "{path}");
        }
    }

    #[test]
    fn file_stems_keep_case() {
        assert_eq!(file_stem(r"C:\Apps\Zoom.exe").as_deref(), Some("Zoom"));
        assert_eq!(file_stem(r"C:\Apps\my.tool.exe").as_deref(), Some("my.tool"));
        assert_eq!(file_stem(r"C:\Apps\README").as_deref(), Some("README"));
        assert_eq!(file_stem(r"C:\Apps\.hidden").as_deref(), Some(".hidden"));
        assert_eq!(file_stem(""), None);
    }

    #[test]
    fn exe_paths_are_detected_case_insensitively() {
        assert!(is_exe_path(r"C:\Program Files\App\App.EXE"));
        assert!(is_exe_path("tool.exe"));
        assert!(!is_exe_path(r"C:\Program Files\App\App.lnk"));
        assert!(!is_exe_path(".exe"));
        assert!(!is_exe_path(r"C:\Apps\"));
    }

    #[test]
    fn descriptions_are_trimmed() {
        assert_eq!(clean_description("  Zoom Meetings\0").as_deref(), Some("Zoom Meetings"));
        assert_eq!(clean_description(" \0 "), None);
    }

    #[test]
    fn utf16_stops_at_nul() {
        let units: Vec<u16> = "Slack\0junk".encode_utf16().collect();
        assert_eq!(utf16_until_nul(&units), "Slack");
        let units: Vec<u16> = "Teams".encode_utf16().collect();
        assert_eq!(utf16_until_nul(&units), "Teams");
    }

    #[test]
    fn version_queries_use_lower_case_hex() {
        assert_eq!(
            version_string_query(0x0409, 0x04B0, "FileDescription"),
            r"\StringFileInfo\040904b0\FileDescription"
        );
        assert_eq!(version_string_query(0, 0x04E4, "X"), r"\StringFileInfo\000004e4\X");
    }

    #[test]
    fn translations_keep_order_and_add_fallbacks() {
        assert_eq!(
            version_translations(&[0x0413, 0x04B0, 0x0409, 0x04B0]),
            vec![(0x0413, 0x04B0), (0x0409, 0x04B0), (0x0409, 0x04E4), (0x0000, 0x04B0)]
        );
        assert_eq!(
            version_translations(&[0x0409]),
            vec![(0x0409, 0x04B0), (0x0409, 0x04E4), (0x0000, 0x04B0)]
        );
    }

    #[test]
    fn error_labels_show_win32_numbers() {
        assert_eq!(error_code_label(0x8007_0490_u32 as i32), "error 1168");
        assert_eq!(error_code_label(0x8007_0005_u32 as i32), "error 5");
        assert_eq!(error_code_label(0x8889_0010_u32 as i32), "0x88890010");
        assert_eq!(error_code_label(0), "0x00000000");
    }

    #[test]
    fn microphone_support_starts_with_1903() {
        assert!(!microphone_supported(10, 18363 - 2));
        assert!(microphone_supported(10, 18362));
        assert!(microphone_supported(10, 26100));
        assert!(!microphone_supported(6, 9600));
        assert!(microphone_supported(11, 0));
    }

    #[test]
    fn filetimes_convert_to_timestamps() {
        assert_eq!(filetime_to_timestamp(0), None);
        assert_eq!(filetime_to_timestamp(FILETIME_UNIX_EPOCH), Some(Timestamp::UNIX_EPOCH));
        // 2024-05-06T07:08:09.1234567Z
        let filetime = 133_594_528_891_234_567;
        assert_eq!(
            filetime_to_timestamp(filetime).map(|ts| ts.to_string()),
            Some("2024-05-06T07:08:09.1234567Z".to_string())
        );
        // 1601-01-01 plus one tick is before the Unix epoch but still valid.
        assert_eq!(
            filetime_to_timestamp(1).map(|ts| ts.to_string()),
            Some("1601-01-01T00:00:00.0000001Z".to_string())
        );
        // Beyond jiff's range (year 9999).
        assert_eq!(filetime_to_timestamp(u64::MAX), None);
    }

    #[test]
    fn idle_time_handles_the_32_bit_wrap() {
        assert_eq!(idle_millis(10_000, 4_000), 6_000);
        // GetTickCount64 past 2^32: the low half wrapped, last input before the wrap.
        let now = (1_u64 << 32) + 1_000;
        assert_eq!(idle_millis(now, u32::MAX - 999), 2_000);
        // Last input after the wrap.
        assert_eq!(idle_millis(now, 500), 500);
        // Input between the two calls reads as "in the future": zero, not 49 days.
        assert_eq!(idle_millis(1_000, 1_005), 0);
        assert_eq!(idle_millis(5, 5), 0);
        // About 24 days still counts.
        assert_eq!(idle_millis(u64::from(i32::MAX as u32), 0), u64::from(i32::MAX as u32));
    }

    #[test]
    fn lock_flags_follow_the_documentation_except_on_windows_7() {
        assert_eq!(session_locked(WTS_SESSIONSTATE_LOCK, false), Some(true));
        assert_eq!(session_locked(WTS_SESSIONSTATE_UNLOCK, false), Some(false));
        assert_eq!(session_locked(-1, false), None);
        assert_eq!(session_locked(7, false), None);
        assert_eq!(session_locked(WTS_SESSIONSTATE_LOCK, true), Some(false));
        assert_eq!(session_locked(WTS_SESSIONSTATE_UNLOCK, true), Some(true));
        assert!(lock_flags_inverted(6, 1));
        assert!(!lock_flags_inverted(6, 2));
        assert!(!lock_flags_inverted(10, 0));
    }

    #[test]
    fn session_changes_map_to_events() {
        use SystemEvent::*;
        let cases = [
            (wts::SESSION_LOCK, Some(ScreenLocked)),
            (wts::SESSION_UNLOCK, Some(ScreenUnlocked)),
            (wts::CONSOLE_DISCONNECT, Some(SessionResigned)),
            (wts::REMOTE_DISCONNECT, Some(SessionResigned)),
            (wts::CONSOLE_CONNECT, Some(SessionActivated)),
            (wts::REMOTE_CONNECT, Some(SessionActivated)),
            (5, None),  // logon
            (6, None),  // logoff
            (9, None),  // remote control
            (10, None), // create
            (11, None), // terminate
        ];
        for (wparam, expected) in cases {
            assert_eq!(session_change_event(wparam), expected, "wParam {wparam}");
        }
    }

    #[test]
    fn resume_notifications_are_deduplicated() {
        use SystemEvent::*;
        let mut power = PowerTracker::default();
        assert_eq!(power.power(pbt::APM_SUSPEND), Some(WillSleep));
        assert_eq!(power.power(pbt::APM_SUSPEND), None);
        assert_eq!(power.power(pbt::APM_RESUME_AUTOMATIC), Some(DidWake));
        assert_eq!(power.power(pbt::APM_RESUME_SUSPEND), None);
        assert_eq!(power.power(pbt::APM_SUSPEND), Some(WillSleep));
        assert_eq!(power.power(pbt::APM_RESUME_SUSPEND), Some(DidWake));
        assert_eq!(power.power(pbt::APM_RESUME_AUTOMATIC), None);
        assert_eq!(power.power(10), None); // PBT_APMPOWERSTATUSCHANGE
        // A resume without a suspend notification still reports the wake once.
        let mut fresh = PowerTracker::default();
        assert_eq!(fresh.power(pbt::APM_RESUME_AUTOMATIC), Some(DidWake));
        assert_eq!(fresh.power(pbt::APM_RESUME_SUSPEND), None);
    }

    #[test]
    fn display_state_reports_transitions_only() {
        use SystemEvent::*;
        let mut power = PowerTracker::default();
        assert_eq!(power.display(1), None, "initial report while on");
        assert_eq!(power.display(2), None, "dimmed is still on");
        assert_eq!(power.display(0), Some(DisplaysSlept));
        assert_eq!(power.display(0), None);
        assert_eq!(power.display(2), Some(DisplaysWoke));
        assert_eq!(power.display(1), None);
        let mut off = PowerTracker::default();
        assert_eq!(off.display(0), Some(DisplaysSlept), "initial report while off");
    }

    #[test]
    fn non_packaged_key_names_round_trip() {
        let key = "C:#Program Files#Zoom#bin#Zoom.exe";
        assert_eq!(non_packaged_key_to_path(key), r"C:\Program Files\Zoom\bin\Zoom.exe");
        assert_eq!(path_to_non_packaged_key(r"C:\Program Files\Zoom\bin\Zoom.exe"), key);
        assert_eq!(path_to_non_packaged_key("C:/Tools/a.exe"), "C:#Tools#a.exe");
        assert_eq!(non_packaged_key_to_path("##server#share#Tool.exe"), r"\\server\share\Tool.exe");
        // A `#` in the real path is lost when decoding but still matches when encoding.
        assert_eq!(path_to_non_packaged_key(r"C:\C#\app.exe"), "C:#C##app.exe");
        assert_eq!(non_packaged_key_to_path("C:#C##app.exe"), r"C:\C\\app.exe");
    }

    #[test]
    fn consent_rows_are_in_use_while_stop_is_zero() {
        assert!(consent_in_use(133_000_000_000_000_000, Some(0)));
        assert!(consent_in_use(133_000_000_000_000_000, None));
        assert!(!consent_in_use(133_000_000_000_000_000, Some(133_000_000_100_000_000)));
        assert!(!consent_in_use(0, Some(0)));
        assert!(!consent_in_use(0, None));
    }

    #[test]
    fn package_families_map_to_known_apps() {
        assert_eq!(package_name("MSTeams_8wekyb3d8bbwe"), "MSTeams");
        assert_eq!(
            package_name("Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe"),
            "Microsoft.WindowsSoundRecorder"
        );
        assert_eq!(package_name("NoPublisher"), "NoPublisher");
        let teams = KnownPackage { id: "ms-teams.exe", name: "Microsoft Teams" };
        assert_eq!(known_package("MSTeams_8wekyb3d8bbwe"), Some(teams));
        assert_eq!(known_package("msteams_8wekyb3d8bbwe"), Some(teams));
        assert_eq!(known_package("MicrosoftTeams_8wekyb3d8bbwe"), Some(teams));
        assert_eq!(
            known_package("91750D7E.Slack_8she8kybcnzg4"),
            Some(KnownPackage { id: "slack.exe", name: "Slack" })
        );
        assert_eq!(known_package("Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe"), None);
        assert_eq!(known_package("MSTeamsPreview_8wekyb3d8bbwe"), None);
    }

    fn packaged(family: &str, started: u64) -> ConsentUse {
        ConsentUse { app: ConsentApp::Packaged { family: family.into() }, started }
    }

    fn desktop(key: &str, started: u64) -> ConsentUse {
        ConsentUse { app: ConsentApp::NonPackaged { key: key.into() }, started }
    }

    fn session(pid: u32, path: &str, family: Option<&str>) -> CaptureSession {
        CaptureSession { pid, path: Some(path.into()), family: family.map(Into::into) }
    }

    const TEAMS_EXE: &str = r"C:\Program Files\WindowsApps\MSTeams_25153.1010.3727.5483_x64__8wekyb3d8bbwe\ms-teams.exe";
    const TEAMS_WEBVIEW: &str = r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\140.0.3485.54\msedgewebview2.exe";
    const ZOOM_KEY: &str = "C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe";
    const ZOOM_EXE: &str = r"C:\Users\me\AppData\Roaming\Zoom\bin\Zoom.exe";

    #[test]
    fn merge_confirms_candidates_with_sessions() {
        let candidates = vec![packaged("MSTeams_8wekyb3d8bbwe", 20), desktop(ZOOM_KEY, 10)];
        let view = SessionView::Complete(vec![
            session(900, TEAMS_WEBVIEW, Some("MSTeams_8wekyb3d8bbwe")),
            session(800, TEAMS_EXE, Some("MSTeams_8wekyb3d8bbwe")),
            session(1200, &ZOOM_EXE.to_uppercase(), None),
            session(77, r"C:\Windows\System32\svchost.exe", None),
        ]);
        let merged = merge_microphone_use(candidates, &view);
        assert_eq!(merged.len(), 2);
        // The process running the mapped executable wins over a helper with a lower PID.
        assert_eq!(merged[0].session.as_ref().map(|s| s.pid), Some(800));
        // Paths compare case-insensitively in the `#` encoding.
        assert_eq!(merged[1].session.as_ref().map(|s| s.pid), Some(1200));
    }

    #[test]
    fn merge_drops_stale_candidates_only_when_wasapi_is_complete() {
        let candidates = vec![desktop(ZOOM_KEY, 10), packaged("MSTeams_8wekyb3d8bbwe", 20)];
        let only_zoom = vec![session(1200, ZOOM_EXE, None)];

        let complete =
            merge_microphone_use(candidates.clone(), &SessionView::Complete(only_zoom.clone()));
        assert_eq!(complete.len(), 1, "Teams has no capture session: stale");
        assert!(matches!(&complete[0].app, ConsentApp::NonPackaged { .. }));

        let partial = merge_microphone_use(candidates.clone(), &SessionView::Partial(only_zoom));
        assert_eq!(partial.len(), 2, "a partial view cannot prove silence");
        assert_eq!(partial[1].session, None);

        let unavailable = merge_microphone_use(candidates.clone(), &SessionView::Unavailable);
        assert_eq!(unavailable.len(), 2);
        assert!(unavailable.iter().all(|row| row.session.is_none()));

        assert!(merge_microphone_use(candidates, &SessionView::Complete(vec![])).is_empty());
    }

    #[test]
    fn merge_never_reports_sessions_without_a_candidate() {
        let view = SessionView::Complete(vec![session(1200, ZOOM_EXE, None)]);
        assert!(merge_microphone_use(vec![], &view).is_empty());
    }

    #[test]
    fn merge_matching_rules() {
        let slack_key = "C:#Users#me#AppData#Local#slack#app-4.45.64#slack.exe";
        let newer_slack = r"C:\Users\me\AppData\Local\slack\app-4.46.99\slack.exe";
        // Same executable name, different install folder (unpackaged process).
        let merged = merge_microphone_use(
            vec![desktop(slack_key, 1)],
            &SessionView::Complete(vec![session(5, newer_slack, None)]),
        );
        assert_eq!(merged.len(), 1);
        // A packaged process does not confirm a desktop row through its file name only.
        let store_slack = r"C:\Program Files\WindowsApps\91750D7E.Slack_4.46.99.0_x64__8she8kybcnzg4\app\Slack.exe";
        let merged = merge_microphone_use(
            vec![desktop(slack_key, 1)],
            &SessionView::Complete(vec![session(
                6,
                store_slack,
                Some("91750D7E.Slack_8she8kybcnzg4"),
            )]),
        );
        assert!(merged.is_empty());
        // A known family is confirmed by its executable when the family could not be read.
        let merged = merge_microphone_use(
            vec![packaged("MSTeams_8wekyb3d8bbwe", 1)],
            &SessionView::Complete(vec![session(7, TEAMS_EXE, None)]),
        );
        assert_eq!(merged.len(), 1);
        // An unknown family needs the family itself.
        let recorder = "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe";
        let merged = merge_microphone_use(
            vec![packaged(recorder, 1)],
            &SessionView::Complete(vec![CaptureSession { pid: 8, path: None, family: None }]),
        );
        assert!(merged.is_empty());
        // A session whose process could not be opened confirms nothing.
        let merged = merge_microphone_use(
            vec![desktop(ZOOM_KEY, 1)],
            &SessionView::Complete(vec![CaptureSession { pid: 9, path: None, family: None }]),
        );
        assert!(merged.is_empty());
    }

    #[test]
    fn owners_use_executable_names_and_descriptions() {
        let rows = vec![
            MicrophoneUse {
                app: ConsentApp::NonPackaged { key: ZOOM_KEY.into() },
                started: 10,
                session: Some(session(1200, ZOOM_EXE, None)),
            },
            MicrophoneUse {
                app: ConsentApp::Packaged { family: "MSTeams_8wekyb3d8bbwe".into() },
                started: 20,
                session: Some(session(800, TEAMS_EXE, Some("MSTeams_8wekyb3d8bbwe"))),
            },
            MicrophoneUse {
                app: ConsentApp::Packaged {
                    family: "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe".into(),
                },
                started: 30,
                session: None,
            },
            MicrophoneUse {
                app: ConsentApp::NonPackaged { key: "C:#Program Files#Tools#Recorder.exe".into() },
                started: 40,
                session: None,
            },
        ];
        let describe =
            |path: &str| path.ends_with("Zoom.exe").then(|| "Zoom Workplace".to_string());
        let owners = input_owners(rows, describe);
        assert_eq!(
            owners,
            vec![
                InputOwner {
                    id: "ms-teams.exe".into(),
                    name: "Microsoft Teams".into(),
                    pid: Some(800),
                    path: Some(TEAMS_EXE.into()),
                },
                InputOwner {
                    id: "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe".into(),
                    name: "Microsoft.WindowsSoundRecorder".into(),
                    pid: None,
                    path: None,
                },
                InputOwner {
                    id: "recorder.exe".into(),
                    name: "Recorder".into(),
                    pid: None,
                    path: Some(r"C:\Program Files\Tools\Recorder.exe".into()),
                },
                InputOwner {
                    id: "zoom.exe".into(),
                    name: "Zoom Workplace".into(),
                    pid: Some(1200),
                    path: Some(ZOOM_EXE.into()),
                },
            ]
        );
    }

    #[test]
    fn owners_collapse_rows_with_the_same_id() {
        let old = "C:#Users#me#AppData#Local#slack#app-4.45.64#slack.exe";
        let new = "C:#Users#me#AppData#Local#slack#app-4.46.99#slack.exe";
        let rows = vec![
            MicrophoneUse {
                app: ConsentApp::NonPackaged { key: old.into() },
                started: 50,
                session: None,
            },
            MicrophoneUse {
                app: ConsentApp::NonPackaged { key: new.into() },
                started: 40,
                session: Some(session(31, &non_packaged_key_to_path(new), None)),
            },
            MicrophoneUse {
                app: ConsentApp::Packaged { family: "91750D7E.Slack_8she8kybcnzg4".into() },
                started: 60,
                session: None,
            },
        ];
        let owners = input_owners(rows, |_| Some("Slack".to_string()));
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].id, "slack.exe");
        assert_eq!(owners[0].pid, Some(31), "the confirmed row wins");
    }

    #[test]
    fn unknown_packages_use_the_process_description() {
        let row = MicrophoneUse {
            app: ConsentApp::Packaged { family: "Contoso.Meet_abcdefghjkmnp".into() },
            started: 1,
            session: Some(session(
                4,
                r"C:\Program Files\WindowsApps\Contoso\Meet.exe",
                Some("Contoso.Meet_abcdefghjkmnp"),
            )),
        };
        let owner = input_owner(&row, &|_: &str| Some("Contoso Meet".to_string()));
        assert_eq!(owner.id, "Contoso.Meet_abcdefghjkmnp");
        assert_eq!(owner.name, "Contoso Meet");
        assert_eq!(owner.pid, Some(4));
    }

    #[test]
    fn credential_targets_and_parts() {
        assert_eq!(
            credential_target("be.yarne.azure-timetracker", "azure:contoso"),
            "be.yarne.azure-timetracker:azure:contoso"
        );
        assert_eq!(
            credential_part_target("be.yarne.azure-timetracker", "7pace-oauth:x", 2),
            "be.yarne.azure-timetracker:7pace-oauth:x#part2"
        );
        assert_eq!(credential_parts(b"").map(|p| p.len()), Some(1));
        assert_eq!(credential_parts(b"pat").map(|p| p.len()), Some(1));
        let full = vec![b'a'; CREDENTIAL_BLOB_LIMIT];
        assert_eq!(credential_parts(&full).map(|p| p.len()), Some(1));
        let long = vec![b'a'; CREDENTIAL_BLOB_LIMIT * 2 + 1];
        let parts = credential_parts(&long).unwrap();
        assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), vec![2560, 2560, 1]);
        assert_eq!(parts.concat(), long);
        let limit = vec![b'a'; CREDENTIAL_BLOB_LIMIT * CREDENTIAL_MAX_PARTS];
        assert!(credential_parts(&limit).is_some());
        let too_long = vec![b'a'; CREDENTIAL_BLOB_LIMIT * CREDENTIAL_MAX_PARTS + 1];
        assert!(credential_parts(&too_long).is_none());
    }

    #[test]
    fn secrets_decode_from_utf8_and_utf16() {
        assert_eq!(decode_secret(b"abc123").as_deref(), Some("abc123"));
        assert_eq!(decode_secret("pâté".as_bytes()).as_deref(), Some("pâté"));
        assert_eq!(decode_secret(b"").as_deref(), Some(""));
        assert_eq!(decode_secret(b"abc\0").as_deref(), Some("abc"), "trailing NUL");
        let utf16: Vec<u8> = "abc".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_secret(&utf16).as_deref(), Some("abc"));
        let terminated: Vec<u8> = "ab\0".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_secret(&terminated).as_deref(), Some("ab"));
        assert_eq!(decode_secret(&[0xFF, 0xFE, 0xFD]), None);
        // A lone surrogate is neither UTF-8 nor valid UTF-16.
        assert_eq!(decode_secret(&[0x00, 0xD8]), None);
    }

    #[test]
    fn figma_urls_are_detected() {
        let cases = [
            ("https://www.figma.com/design/AbC123/Homepage?node-id=1-2", true),
            ("  https://figma.com/file/AbC123/Homepage  ", true),
            ("HTTPS://WWW.FIGMA.COM/board/AbC123/Retro", true),
            ("https://www.figma.com/files/recents-and-sharing", true),
            ("https://www.figma.com/", false),
            ("http://www.figma.com/design/AbC123/Homepage", false),
            ("https://www.figma.com.evil.example/design/AbC123", false),
            ("https://evil.example/https://www.figma.com/design/AbC123", false),
            ("figma.com/design/AbC123/Homepage", false),
            ("Open https://www.figma.com/design/AbC123/Homepage", false),
            ("Homepage – Figma", false),
            ("", false),
        ];
        for (text, expected) in cases {
            assert_eq!(figma_url(text).is_some(), expected, "{text:?}");
        }
        assert_eq!(
            figma_url("  https://figma.com/file/AbC123/Homepage\n"),
            Some("https://figma.com/file/AbC123/Homepage")
        );
    }

    #[test]
    fn figma_file_urls_are_told_apart_from_the_file_browser() {
        assert!(is_figma_file_url("https://www.figma.com/design/AbC123/Homepage?node-id=1-2"));
        assert!(is_figma_file_url("https://figma.com/file/AbC123/Homepage"));
        assert!(is_figma_file_url("https://www.figma.com/slides/AbC123"));
        assert!(is_figma_file_url("https://www.figma.com/BOARD/AbC123/Retro"));
        assert!(!is_figma_file_url("https://www.figma.com/files/recents-and-sharing"));
        assert!(!is_figma_file_url("https://www.figma.com/design/"));
        assert!(!is_figma_file_url("https://www.figma.com/design/Ab-C/x"));
        assert!(!is_figma_file_url("https://www.figma.com/proto/AbC123/Flow"));
        assert!(!is_figma_file_url("not a url"));
    }

    #[test]
    fn figma_titles_drop_the_app_suffix() {
        assert_eq!(figma_window_title("Homepage – Figma").as_deref(), Some("Homepage"));
        assert_eq!(figma_window_title(" Homepage - Figma ").as_deref(), Some("Homepage"));
        assert_eq!(figma_window_title("Homepage — Figma").as_deref(), Some("Homepage"));
        assert_eq!(figma_window_title("Homepage").as_deref(), Some("Homepage"));
        assert_eq!(figma_window_title("Figma - Figma"), None);
        assert_eq!(figma_window_title("Figma"), None);
        assert_eq!(figma_window_title("  "), None);
        assert_eq!(figma_window_title("Figma tips").as_deref(), Some("Figma tips"));
    }

    #[test]
    fn url_search_prefers_visible_documents() {
        let mut search = FigmaUrlSearch::default();
        assert!(!search.offer(Some("https://www.figma.com/files/recents"), None, false));
        assert!(!search.offer(Some("https://www.figma.com/design/Back123/Hidden"), None, true));
        assert!(!search.offer(None, Some("https://www.figma.com/design/Other456/Later"), true));
        assert_eq!(
            search.clone().into_url().as_deref(),
            Some("https://www.figma.com/design/Back123/Hidden")
        );
        assert!(search.offer(None, Some("https://www.figma.com/design/Front789/Visible"), false));
        assert_eq!(
            search.into_url().as_deref(),
            Some("https://www.figma.com/design/Front789/Visible")
        );
        assert_eq!(FigmaUrlSearch::default().into_url(), None);
    }

    /// A fake accessibility tree: node `i` has the given children.
    struct Tree {
        nodes: Vec<(Option<&'static str>, Vec<usize>)>,
        calls: usize,
    }

    impl Tree {
        fn element(&self, index: usize) -> UiElement<usize> {
            UiElement {
                handle: index,
                name: None,
                value: self.nodes[index].0.map(Into::into),
                offscreen: false,
            }
        }

        fn children(&mut self, index: usize) -> Vec<UiElement<usize>> {
            self.calls += 1;
            self.nodes[index].1.clone().into_iter().map(|child| self.element(child)).collect()
        }
    }

    #[test]
    fn search_is_breadth_first() {
        // 0 → [1, 2]; 1 → [3] (deep file URL); 2 → shallow file URL.
        let mut tree = Tree {
            nodes: vec![
                (None, vec![1, 2]),
                (None, vec![3]),
                (Some("https://www.figma.com/design/Shallow1/A"), vec![]),
                (Some("https://www.figma.com/design/Deep2/B"), vec![]),
            ],
            calls: 0,
        };
        let root = tree.element(0);
        let url = find_figma_url(root, 200, |&index| tree.children(index), || false);
        assert_eq!(url.as_deref(), Some("https://www.figma.com/design/Shallow1/A"));
    }

    #[test]
    fn search_examines_at_most_the_element_budget() {
        // A chain of 500 elements with the URL at the end.
        let mut nodes: Vec<(Option<&'static str>, Vec<usize>)> =
            (0..500).map(|index| (None, vec![index + 1])).collect();
        nodes.push((Some("https://www.figma.com/design/End123/X"), vec![]));
        let mut tree = Tree { nodes, calls: 0 };
        let root = tree.element(0);
        let url = find_figma_url(root, 200, |&index| tree.children(index), || false);
        assert_eq!(url, None);
        assert_eq!(tree.calls, 199, "the root plus 199 children fill the budget");

        // A wide root: only the first 199 children are kept.
        let mut nodes: Vec<(Option<&'static str>, Vec<usize>)> = vec![(None, (1..=300).collect())];
        nodes.extend((1..=300).map(|index| {
            (
                if index == 250 { Some("https://www.figma.com/design/Wide123/X") } else { None },
                vec![],
            )
        }));
        let mut tree = Tree { nodes, calls: 0 };
        let root = tree.element(0);
        assert_eq!(find_figma_url(root, 200, |&index| tree.children(index), || false), None);
    }

    #[test]
    fn search_stops_at_the_deadline() {
        let mut tree = Tree {
            nodes: vec![(None, vec![1]), (Some("https://www.figma.com/design/Late123/X"), vec![])],
            calls: 0,
        };
        let root = tree.element(0);
        let url = find_figma_url(root, 200, |&index| tree.children(index), || true);
        assert_eq!(url, None);
        assert_eq!(tree.calls, 0);
    }

    #[test]
    fn search_reads_the_root_and_names() {
        let root = UiElement {
            handle: 0_usize,
            name: Some("https://figma.com/file/Root123/X".into()),
            value: None,
            offscreen: false,
        };
        let url = find_figma_url(root, 200, |_| unreachable!("found on the root"), || false);
        assert_eq!(url.as_deref(), Some("https://figma.com/file/Root123/X"));
        let empty = UiElement { handle: 0_usize, name: None, value: None, offscreen: false };
        assert_eq!(find_figma_url(empty, 0, |_| vec![], || false), None);
    }
}
