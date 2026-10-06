//! App updates through the Tauri updater (1.14 `AppUpdateModel`).
//!
//! - [`UpdateMachine`] is the pure state machine with the 1.14 phases (idle, checking,
//!   available, downloading, ready, installing, failed) and its messages.
//! - [`start`] registers the managed [`Updates`] state and, unless updates are disabled (debug
//!   builds and `--preview`), runs the automatic checks: only while
//!   `Configuration.automaticUpdateChecks` is on, every `cadences.updateCheckSeconds` (60 s by
//!   default, as in 1.14). Automatic checks never download or install anything.
//! - [`shell_update_status`], [`shell_update_check`] and [`shell_update_install`] are the
//!   commands the UI calls. Every change is emitted to every window as [`UPDATE_EVENT`].
//!
//! Installing is always the user's click: download with progress, then the engine's
//! `app.prepareForRestart` (which refuses while a write is in progress and persists the state),
//! then the plugin installs the verified package and the app restarts. The 7pace timer keeps
//! running on the server, as in 1.x.

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use att_engine::Engine;

use crate::shell::lock;

/// Emitted to every window whenever the status changes. Payload: [`UpdateStatus`].
pub const UPDATE_EVENT: &str = "shell://update";

pub const DISABLED_MESSAGE: &str = "Updates are disabled in preview and development builds.";
pub const CHECKING_MESSAGE: &str = "Checking GitHub for a new version…";
pub const UP_TO_DATE_MESSAGE: &str = "You’re up to date.";
pub const DOWNLOADING_MESSAGE: &str = "Downloading and verifying the update…";
pub const READY_MESSAGE: &str = "Download verified. Install and restart when you’re ready.";
pub const INSTALLING_MESSAGE: &str = "Installing the verified update and restarting…";
pub const NETWORK_MESSAGE: &str = "The update server could not be reached. Check your connection and try Check for updates again.";
pub const NOT_FOUND_MESSAGE: &str =
    "The update server has no release information yet. Try Check for updates again later.";
pub const VERIFY_MESSAGE: &str =
    "The update could not be verified with the app’s release key, so it was not installed.";
pub const PLATFORM_MESSAGE: &str = "This release has no update for this computer yet.";
pub const NOTHING_TO_INSTALL_MESSAGE: &str =
    "There is no update to install. Check for updates first.";
pub const STARTING_MESSAGE: &str = "The app is still starting. Try again in a moment.";

/// Bounds of `cadences.updateCheckSeconds` (`att_core::Cadences::UPDATE_CHECK`).
const MIN_INTERVAL: u32 = 60;
const MAX_INTERVAL: u32 = 86_400;
/// How often the background thread looks at the settings and the schedule.
const TICK: Duration = Duration::from_secs(5);
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

// -- State machine ------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    Installing,
    Failed,
}

/// What the UI shows. Serialized camelCase as the payload of every command and event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub phase: Phase,
    /// The installed version.
    pub current_version: String,
    /// The offered version, while one is known.
    pub version: Option<String>,
    /// Release notes of the offered version.
    pub notes: Option<String>,
    /// Publication date of the offered version (RFC 3339), when the feed has one.
    pub date: Option<String>,
    /// Bytes downloaded so far (downloading and later).
    pub downloaded: u64,
    /// Size of the download, when the server sends it.
    pub total: Option<u64>,
    /// One line for the current phase (1.14 `message`).
    pub message: String,
    /// What went wrong, shown verbatim: a failed check or download, a refused restart.
    pub error: Option<String>,
    /// When the last check finished (RFC 3339).
    pub checked_at: Option<String>,
    /// `Configuration.automaticUpdateChecks`.
    pub automatic: bool,
    /// False in debug builds and in preview mode: nothing is checked or installed.
    pub enabled: bool,
}

/// A release the check found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Returned by [`UpdateMachine::begin_check`]; results of an older attempt are dropped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CheckTicket {
    attempt: u64,
    /// An automatic check while an update is already offered: the UI keeps showing it.
    silent: bool,
}

/// What a click on the update action does next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallStep {
    /// Download the offered update first.
    Download,
    /// The verified download is kept: prepare the engine and install.
    Restart,
}

#[derive(Clone, Debug)]
pub struct UpdateMachine {
    status: UpdateStatus,
    attempt: u64,
    interval: u32,
}

/// Updates run in release builds outside preview mode only.
pub fn updates_enabled(debug_build: bool, preview: bool) -> bool {
    !debug_build && !preview
}

/// `cadences.updateCheckSeconds`, kept within the bounds Settings allows.
pub fn clamp_interval(seconds: u32) -> u32 {
    seconds.clamp(MIN_INTERVAL, MAX_INTERVAL)
}

fn every(seconds: u32) -> String {
    let seconds = clamp_interval(seconds);
    let (amount, unit) = if seconds.is_multiple_of(3600) {
        (seconds / 3600, "hour")
    } else if seconds.is_multiple_of(60) {
        (seconds / 60, "minute")
    } else {
        (seconds, "second")
    };
    if amount == 1 { format!("every {unit}") } else { format!("every {amount} {unit}s") }
}

/// The idle line before the first check (1.14: "…when the app opens and every minute.").
pub fn schedule_message(automatic: bool, interval_seconds: u32) -> String {
    if automatic {
        format!("Checks for updates when the app opens and {}.", every(interval_seconds))
    } else {
        "Automatic checks are off. Use Check for updates to look for a new version.".to_string()
    }
}

pub fn available_message(version: &str) -> String {
    format!("Version {version} is available.")
}

impl UpdateMachine {
    pub fn new(
        current_version: &str,
        enabled: bool,
        automatic: bool,
        interval_seconds: u32,
    ) -> Self {
        let interval = clamp_interval(interval_seconds);
        Self {
            status: UpdateStatus {
                phase: Phase::Idle,
                current_version: current_version.to_string(),
                version: None,
                notes: None,
                date: None,
                downloaded: 0,
                total: None,
                message: if enabled {
                    schedule_message(automatic, interval)
                } else {
                    DISABLED_MESSAGE.to_string()
                },
                error: None,
                checked_at: None,
                automatic,
                enabled,
            },
            attempt: 0,
            interval,
        }
    }

    pub fn status(&self) -> &UpdateStatus {
        &self.status
    }

    pub fn interval(&self) -> Duration {
        Duration::from_secs(u64::from(self.interval))
    }

    fn busy(&self) -> bool {
        matches!(
            self.status.phase,
            Phase::Checking | Phase::Downloading | Phase::Ready | Phase::Installing
        )
    }

    /// Follows the saved settings. Returns true when the status changed.
    pub fn set_schedule(&mut self, automatic: bool, interval_seconds: u32) -> bool {
        let interval = clamp_interval(interval_seconds);
        if self.status.automatic == automatic && self.interval == interval {
            return false;
        }
        self.status.automatic = automatic;
        self.interval = interval;
        if self.status.enabled
            && self.status.phase == Phase::Idle
            && self.status.checked_at.is_none()
        {
            self.status.message = schedule_message(automatic, interval);
        }
        true
    }

    /// Whether "Check for updates" can run now.
    pub fn can_check(&self) -> bool {
        self.status.enabled && !self.busy()
    }

    /// Starts a check, or returns `None` when one cannot run (disabled, busy, or an automatic
    /// check while automatic checks are off).
    pub fn begin_check(&mut self, automatic: bool) -> Option<CheckTicket> {
        if !self.can_check() || (automatic && !self.status.automatic) {
            return None;
        }
        self.attempt += 1;
        let silent = automatic && self.status.phase == Phase::Available;
        if !silent {
            self.status.phase = Phase::Checking;
            self.status.message = CHECKING_MESSAGE.to_string();
            self.status.error = None;
        }
        Some(CheckTicket { attempt: self.attempt, silent })
    }

    /// Applies a check result. Returns false when it was dropped (an older attempt).
    pub fn finish_check(
        &mut self,
        ticket: CheckTicket,
        outcome: Result<Option<Release>, String>,
        now: &str,
    ) -> bool {
        if ticket.attempt != self.attempt
            || !matches!(self.status.phase, Phase::Checking | Phase::Available)
        {
            return false;
        }
        match outcome {
            Ok(Some(release)) => {
                self.status.message = available_message(&release.version);
                self.status.phase = Phase::Available;
                self.status.version = Some(release.version);
                self.status.notes = release.notes;
                self.status.date = release.date;
                self.status.downloaded = 0;
                self.status.total = None;
                self.status.error = None;
                self.status.checked_at = Some(now.to_string());
            }
            Ok(None) => {
                self.status.phase = Phase::Idle;
                self.status.version = None;
                self.status.notes = None;
                self.status.date = None;
                self.status.error = None;
                self.status.message = UP_TO_DATE_MESSAGE.to_string();
                self.status.checked_at = Some(now.to_string());
            }
            // A background re-check must not hide the update that is already offered.
            Err(_) if ticket.silent => return false,
            Err(error) => {
                self.status.phase = Phase::Failed;
                self.status.version = None;
                self.status.notes = None;
                self.status.date = None;
                self.status.message = error.clone();
                self.status.error = Some(error);
                self.status.checked_at = Some(now.to_string());
            }
        }
        true
    }

    /// What the update action does now, or the message explaining why it cannot run.
    /// `downloaded` says whether the verified package is still kept.
    pub fn install_step(&self, downloaded: bool) -> Result<InstallStep, String> {
        if !self.status.enabled {
            return Err(DISABLED_MESSAGE.to_string());
        }
        match self.status.phase {
            Phase::Ready if downloaded => Ok(InstallStep::Restart),
            Phase::Available | Phase::Ready => Ok(InstallStep::Download),
            Phase::Failed if self.status.version.is_some() => Ok(InstallStep::Download),
            Phase::Downloading | Phase::Installing | Phase::Checking => {
                Err(self.status.message.clone())
            }
            _ => Err(NOTHING_TO_INSTALL_MESSAGE.to_string()),
        }
    }

    /// Starts a download. Returns the attempt its progress and result belong to.
    pub fn begin_download(&mut self) -> u64 {
        self.attempt += 1;
        self.status.phase = Phase::Downloading;
        self.status.downloaded = 0;
        self.status.total = None;
        self.status.error = None;
        self.status.message = DOWNLOADING_MESSAGE.to_string();
        self.attempt
    }

    /// Adds a downloaded chunk. Returns true when the change is worth an event: the whole
    /// percentage moved, or another 256 KiB arrived when the size is unknown.
    pub fn progress(&mut self, attempt: u64, chunk: u64, total: Option<u64>) -> bool {
        if attempt != self.attempt || self.status.phase != Phase::Downloading {
            return false;
        }
        let before = self.status.downloaded;
        self.status.downloaded = before.saturating_add(chunk);
        let first = self.status.total.is_none() && total.is_some();
        if total.is_some() {
            self.status.total = total;
        }
        match self.status.total {
            Some(total) if total > 0 => {
                first || percent(before, total) != percent(self.status.downloaded, total)
            }
            _ => before / (256 * 1024) != self.status.downloaded / (256 * 1024),
        }
    }

    pub fn download_finished(&mut self, attempt: u64) -> bool {
        if attempt != self.attempt || self.status.phase != Phase::Downloading {
            return false;
        }
        self.status.phase = Phase::Ready;
        self.status.message = READY_MESSAGE.to_string();
        self.status.error = None;
        true
    }

    pub fn download_failed(&mut self, attempt: u64, error: String) -> bool {
        if attempt != self.attempt || self.status.phase != Phase::Downloading {
            return false;
        }
        self.status.phase = Phase::Failed;
        self.status.message = error.clone();
        self.status.error = Some(error);
        true
    }

    /// The engine refused to prepare the restart (a save or connection is in progress): the
    /// verified download stays ready and the engine's message is shown.
    pub fn restart_blocked(&mut self, message: String) {
        self.status.phase = Phase::Ready;
        self.status.message = READY_MESSAGE.to_string();
        self.status.error = Some(message);
    }

    pub fn begin_install(&mut self) {
        self.status.phase = Phase::Installing;
        self.status.message = INSTALLING_MESSAGE.to_string();
        self.status.error = None;
    }

    /// The package could not be installed; the app keeps running unchanged (1.14
    /// `reportInstallFailure`).
    pub fn install_failed(&mut self, error: String) {
        self.status.phase = Phase::Ready;
        self.status.message = READY_MESSAGE.to_string();
        self.status.error = Some(error);
    }
}

fn percent(done: u64, total: u64) -> u64 {
    done.min(total).saturating_mul(100) / total
}

/// When the next automatic check is due: right away at startup, then every `interval`.
pub fn check_due(last: Option<Instant>, now: Instant, interval: Duration) -> bool {
    last.is_none_or(|last| now.saturating_duration_since(last) >= interval)
}

// -- Versions -----------------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
struct Parsed<'a> {
    core: [u64; 3],
    pre: Vec<&'a str>,
}

fn parse_version(text: &str) -> Option<Parsed<'_>> {
    let text = text.trim();
    let text = text.strip_prefix('v').unwrap_or(text);
    let text = text.split('+').next().unwrap_or(text);
    let (core, pre) = match text.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (text, None),
    };
    let mut parts = [0_u64; 3];
    let mut count = 0;
    for part in core.split('.') {
        if count == 3 || part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        parts[count] = part.parse().ok()?;
        count += 1;
    }
    if count == 0 {
        return None;
    }
    let pre = match pre {
        Some(pre) => {
            let identifiers: Vec<&str> = pre.split('.').collect();
            if identifiers.iter().any(|identifier| identifier.is_empty()) {
                return None;
            }
            identifiers
        }
        None => Vec::new(),
    };
    Some(Parsed { core: parts, pre })
}

fn compare_identifiers(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (left.parse::<u64>(), right.parse::<u64>()) {
        (Ok(left), Ok(right)) => left.cmp(&right),
        (Ok(_), Err(_)) => Ordering::Less,
        (Err(_), Ok(_)) => Ordering::Greater,
        (Err(_), Err(_)) => left.cmp(right),
    }
}

/// Semantic-version precedence: is `offered` newer than `installed`? A release outranks its
/// pre-releases, build metadata is ignored, and an unreadable version is never offered.
pub fn is_newer(installed: &str, offered: &str) -> bool {
    use std::cmp::Ordering;
    let (Some(installed), Some(offered)) = (parse_version(installed), parse_version(offered))
    else {
        return false;
    };
    match offered.core.cmp(&installed.core) {
        Ordering::Greater => return true,
        Ordering::Less => return false,
        Ordering::Equal => {}
    }
    match (offered.pre.is_empty(), installed.pre.is_empty()) {
        (true, true) => false,
        (true, false) => true,
        (false, true) => false,
        (false, false) => {
            for (offered, installed) in offered.pre.iter().zip(&installed.pre) {
                match compare_identifiers(offered, installed) {
                    Ordering::Equal => {}
                    ordering => return ordering == Ordering::Greater,
                }
            }
            offered.pre.len() > installed.pre.len()
        }
    }
}

/// A readable English line for an updater failure.
pub fn describe_error(error: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match error {
        Error::Reqwest(_) | Error::Network(_) => NETWORK_MESSAGE.to_string(),
        Error::ReleaseNotFound => NOT_FOUND_MESSAGE.to_string(),
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => VERIFY_MESSAGE.to_string(),
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => PLATFORM_MESSAGE.to_string(),
        other => other.to_string(),
    }
}

// -- Time ---------------------------------------------------------------------------------------

/// RFC 3339 in UTC with whole seconds, e.g. `2026-10-06T08:00:00Z`.
pub fn rfc3339(time: SystemTime) -> String {
    let seconds = time.duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0);
    let days = i64::try_from(seconds / 86_400).unwrap_or(0);
    let rest = seconds % 86_400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

// -- Shell side ---------------------------------------------------------------------------------

struct Inner {
    machine: UpdateMachine,
    /// The update the last successful check returned.
    update: Option<Update>,
    /// The verified package, between the download and the restart.
    bytes: Option<Vec<u8>>,
    last_check: Option<Instant>,
}

/// Managed state behind the update commands.
pub struct Updates {
    inner: Mutex<Inner>,
}

impl Updates {
    fn new(machine: UpdateMachine) -> Self {
        Self { inner: Mutex::new(Inner { machine, update: None, bytes: None, last_check: None }) }
    }

    fn status(&self) -> UpdateStatus {
        lock(&self.inner).machine.status().clone()
    }
}

fn emit(app: &AppHandle) {
    let status = app.state::<Updates>().status();
    if let Err(error) = app.emit(UPDATE_EVENT, &status) {
        tracing::warn!(%error, "could not send the update status to the windows");
    }
}

/// `automaticUpdateChecks` and `cadences.updateCheckSeconds` from the engine's settings.
fn schedule(app: &AppHandle) -> (bool, u32) {
    app.try_state::<Engine>()
        .map(|engine| {
            let config = engine.configuration();
            (config.automatic_update_checks, config.cadences.update_check_seconds)
        })
        .unwrap_or((true, MIN_INTERVAL))
}

/// Registers the update state and starts the automatic checks. Call after the engine started.
pub fn start(app: &AppHandle) {
    let preview = std::env::args().any(|arg| arg == "--preview");
    let enabled = updates_enabled(cfg!(debug_assertions), preview);
    let (automatic, interval) = schedule(app);
    let version = app.package_info().version.to_string();
    app.manage(Updates::new(UpdateMachine::new(&version, enabled, automatic, interval)));
    if !enabled {
        return;
    }
    let handle = app.clone();
    let spawned = std::thread::Builder::new().name("app-updates".into()).spawn(move || {
        loop {
            std::thread::sleep(TICK);
            tick(&handle);
        }
    });
    if let Err(error) = spawned {
        tracing::warn!(%error, "could not start the automatic update checks");
    }
}

/// Follows the settings and starts an automatic check when one is due.
fn tick(app: &AppHandle) {
    let (automatic, interval) = schedule(app);
    let updates = app.state::<Updates>();
    let (changed, due) = {
        let mut inner = lock(&updates.inner);
        let changed = inner.machine.set_schedule(automatic, interval);
        let due = automatic
            && inner.machine.can_check()
            && check_due(inner.last_check, Instant::now(), inner.machine.interval());
        (changed, due)
    };
    if changed {
        emit(app);
    }
    if due {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move { check(&handle, true).await });
    }
}

async fn fetch(app: &AppHandle) -> Result<Option<Update>, String> {
    let updater = app
        .updater_builder()
        .version_comparator(|current, release| {
            is_newer(&current.to_string(), &release.version.to_string())
        })
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|error| describe_error(&error))?;
    updater.check().await.map_err(|error| describe_error(&error))
}

fn release_of(update: &Update) -> Release {
    Release {
        version: update.version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
        date: update.date.and_then(|date| {
            let seconds = u64::try_from(date.unix_timestamp()).ok()?;
            Some(rfc3339(UNIX_EPOCH + Duration::from_secs(seconds)))
        }),
    }
}

async fn check(app: &AppHandle, automatic: bool) {
    let updates = app.state::<Updates>();
    let ticket = {
        let mut inner = lock(&updates.inner);
        let ticket = inner.machine.begin_check(automatic);
        if ticket.is_some() {
            inner.last_check = Some(Instant::now());
        }
        ticket
    };
    let Some(ticket) = ticket else { return };
    emit(app);
    let result = fetch(app).await;
    let now = rfc3339(SystemTime::now());
    let applied = {
        let mut inner = lock(&updates.inner);
        let outcome =
            result.as_ref().map(|update| update.as_ref().map(release_of)).map_err(Clone::clone);
        let applied = inner.machine.finish_check(ticket, outcome, &now);
        if applied {
            inner.update = result.ok().flatten();
            inner.bytes = None;
        }
        applied
    };
    if applied {
        emit(app);
    }
}

/// Downloads the offered update (the download attempt already began), then restarts.
async fn download_and_restart(app: AppHandle, update: Update, attempt: u64) {
    let updates = app.state::<Updates>();
    let progress_app = app.clone();
    let result = update
        .download(
            move |chunk, total| {
                let updates = progress_app.state::<Updates>();
                let chunk = u64::try_from(chunk).unwrap_or(u64::MAX);
                if lock(&updates.inner).machine.progress(attempt, chunk, total) {
                    emit(&progress_app);
                }
            },
            || {},
        )
        .await;
    let bytes = {
        let mut inner = lock(&updates.inner);
        match result {
            Ok(bytes) if inner.machine.download_finished(attempt) => {
                // Straight on to the restart: the UI shows "installing", not a ready flash.
                inner.machine.begin_install();
                inner.bytes = Some(bytes.clone());
                Some(bytes)
            }
            Ok(_) => None,
            Err(error) => {
                inner.machine.download_failed(attempt, describe_error(&error));
                None
            }
        }
    };
    emit(&app);
    if let Some(bytes) = bytes {
        restart(app, update, bytes).await;
    }
}

/// Asks the engine to prepare (it refuses while a write runs), installs and restarts. The
/// phase is already `installing`; a refusal or failure returns to `ready` with the message.
async fn restart(app: AppHandle, update: Update, bytes: Vec<u8>) {
    let updates = app.state::<Updates>();
    let Some(engine) = app.try_state::<Engine>().map(|engine| engine.inner().clone()) else {
        lock(&updates.inner).machine.restart_blocked(STARTING_MESSAGE.to_string());
        emit(&app);
        return;
    };
    if let Err(error) =
        engine.dispatch(serde_json::json!({ "type": "app.prepareForRestart" })).await
    {
        lock(&updates.inner).machine.restart_blocked(error.message);
        emit(&app);
        return;
    }
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    match installed {
        // On Windows the plugin has already exited to run the installer.
        Ok(Ok(())) => app.restart(),
        Ok(Err(error)) => lock(&updates.inner).machine.install_failed(describe_error(&error)),
        Err(error) => lock(&updates.inner).machine.install_failed(error.to_string()),
    }
    emit(&app);
}

/// The current update status.
#[tauri::command]
pub fn shell_update_status(updates: State<'_, Updates>) -> UpdateStatus {
    updates.status()
}

/// Checks for an update now and returns the resulting status. Does nothing (and returns the
/// status) while updates are disabled or another check, download or install is running.
#[tauri::command]
pub async fn shell_update_check(app: AppHandle) -> Result<UpdateStatus, String> {
    check(&app, false).await;
    Ok(app.state::<Updates>().status())
}

/// The user's "Download and restart" / "Restart to update": downloads the offered update with
/// progress if needed, asks the engine to prepare (`app.prepareForRestart`), installs and
/// restarts. Returns the status right after the step started; progress arrives as events.
#[tauri::command]
pub fn shell_update_install(app: AppHandle) -> Result<UpdateStatus, String> {
    let updates = app.state::<Updates>();
    // The phase changes before the command returns, so a second click is refused and the UI
    // never shows a stale phase.
    let (update, next) = {
        let mut inner = lock(&updates.inner);
        let step = inner.machine.install_step(inner.bytes.is_some())?;
        let update = inner.update.clone().ok_or_else(|| NOTHING_TO_INSTALL_MESSAGE.to_string())?;
        let next = match (step, inner.bytes.clone()) {
            (InstallStep::Restart, Some(bytes)) => {
                inner.machine.begin_install();
                Next::Restart(bytes)
            }
            _ => {
                inner.bytes = None;
                Next::Download(inner.machine.begin_download())
            }
        };
        (update, next)
    };
    emit(&app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match next {
            Next::Restart(bytes) => restart(handle, update, bytes).await,
            Next::Download(attempt) => download_and_restart(handle, update, attempt).await,
        }
    });
    Ok(updates.status())
}

enum Next {
    Download(u64),
    Restart(Vec<u8>),
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-10-06T08:00:00Z";

    fn machine() -> UpdateMachine {
        UpdateMachine::new("2.0.0", true, true, 60)
    }

    fn release(version: &str) -> Release {
        Release {
            version: version.to_string(),
            notes: Some("Faster history.".to_string()),
            date: None,
        }
    }

    fn available() -> UpdateMachine {
        let mut machine = machine();
        let ticket = machine.begin_check(false).unwrap();
        assert!(machine.finish_check(ticket, Ok(Some(release("2.0.1"))), NOW));
        machine
    }

    #[test]
    fn disabled_in_debug_builds_and_preview() {
        assert!(updates_enabled(false, false));
        assert!(!updates_enabled(true, false));
        assert!(!updates_enabled(false, true));
        let mut machine = UpdateMachine::new("2.0.0", false, true, 60);
        assert_eq!(machine.status().message, DISABLED_MESSAGE);
        assert_eq!(DISABLED_MESSAGE, "Updates are disabled in preview and development builds.");
        assert!(!machine.can_check());
        assert_eq!(machine.begin_check(false), None);
        assert_eq!(machine.install_step(false), Err(DISABLED_MESSAGE.to_string()));
        // Following the settings keeps the disabled message.
        assert!(machine.set_schedule(false, 120));
        assert_eq!(machine.status().message, DISABLED_MESSAGE);
    }

    #[test]
    fn schedule_messages() {
        assert_eq!(
            schedule_message(true, 60),
            "Checks for updates when the app opens and every minute."
        );
        assert_eq!(
            schedule_message(true, 300),
            "Checks for updates when the app opens and every 5 minutes."
        );
        assert_eq!(
            schedule_message(true, 3600),
            "Checks for updates when the app opens and every hour."
        );
        assert_eq!(
            schedule_message(true, 7200),
            "Checks for updates when the app opens and every 2 hours."
        );
        assert_eq!(
            schedule_message(true, 90),
            "Checks for updates when the app opens and every 90 seconds."
        );
        // Out-of-range cadences are clamped like Settings does.
        assert_eq!(
            schedule_message(true, 5),
            "Checks for updates when the app opens and every minute."
        );
        assert_eq!(
            schedule_message(false, 60),
            "Automatic checks are off. Use Check for updates to look for a new version."
        );
        assert_eq!(available_message("2.0.1"), "Version 2.0.1 is available.");
    }

    #[test]
    fn new_status_serializes_camel_case() {
        let value = serde_json::to_value(machine().status()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "phase": "idle",
                "currentVersion": "2.0.0",
                "version": null,
                "notes": null,
                "date": null,
                "downloaded": 0,
                "total": null,
                "message": "Checks for updates when the app opens and every minute.",
                "error": null,
                "checkedAt": null,
                "automatic": true,
                "enabled": true,
            })
        );
    }

    #[test]
    fn check_finds_an_update_or_reports_up_to_date() {
        let mut machine = machine();
        let ticket = machine.begin_check(false).unwrap();
        assert_eq!(machine.status().phase, Phase::Checking);
        assert_eq!(machine.status().message, CHECKING_MESSAGE);
        // A second check while one runs is refused.
        assert_eq!(machine.begin_check(false), None);
        assert!(machine.finish_check(ticket, Ok(Some(release("2.0.1"))), NOW));
        let status = machine.status();
        assert_eq!(status.phase, Phase::Available);
        assert_eq!(status.version.as_deref(), Some("2.0.1"));
        assert_eq!(status.notes.as_deref(), Some("Faster history."));
        assert_eq!(status.message, "Version 2.0.1 is available.");
        assert_eq!(status.checked_at.as_deref(), Some(NOW));

        let ticket = machine.begin_check(false).unwrap();
        assert!(machine.finish_check(ticket, Ok(None), NOW));
        assert_eq!(machine.status().phase, Phase::Idle);
        assert_eq!(machine.status().version, None);
        assert_eq!(machine.status().message, UP_TO_DATE_MESSAGE);
    }

    #[test]
    fn failed_check_shows_the_error() {
        let mut machine = machine();
        let ticket = machine.begin_check(false).unwrap();
        assert!(machine.finish_check(ticket, Err(NOT_FOUND_MESSAGE.to_string()), NOW));
        let status = machine.status();
        assert_eq!(status.phase, Phase::Failed);
        assert_eq!(status.error.as_deref(), Some(NOT_FOUND_MESSAGE));
        assert_eq!(status.message, NOT_FOUND_MESSAGE);
        assert_eq!(status.version, None);
        // Nothing to install after a failed check; checking again is allowed.
        assert_eq!(machine.install_step(false), Err(NOTHING_TO_INSTALL_MESSAGE.to_string()));
        assert!(machine.can_check());
    }

    #[test]
    fn automatic_checks_follow_the_setting_and_never_hide_an_offered_update() {
        let mut machine = machine();
        assert!(machine.set_schedule(false, 60));
        assert_eq!(machine.begin_check(true), None);
        assert!(machine.status().message.starts_with("Automatic checks are off"));
        assert!(!machine.set_schedule(false, 60));
        assert!(machine.set_schedule(true, 120));
        assert_eq!(machine.interval(), Duration::from_secs(120));
        assert_eq!(
            machine.status().message,
            "Checks for updates when the app opens and every 2 minutes."
        );

        let mut machine = available();
        let ticket = machine.begin_check(true).unwrap();
        // Silent: the offered update stays on screen while the feed is read again.
        assert_eq!(machine.status().phase, Phase::Available);
        assert!(!machine.finish_check(ticket, Err(NETWORK_MESSAGE.to_string()), NOW));
        assert_eq!(machine.status().phase, Phase::Available);
        assert_eq!(machine.status().error, None);
        let ticket = machine.begin_check(true).unwrap();
        assert!(machine.finish_check(ticket, Ok(Some(release("2.0.2"))), NOW));
        assert_eq!(machine.status().version.as_deref(), Some("2.0.2"));
    }

    #[test]
    fn results_of_an_older_attempt_are_dropped() {
        let mut machine = available();
        let ticket = machine.begin_check(true).unwrap();
        let attempt = machine.begin_download();
        assert!(!machine.finish_check(ticket, Ok(None), NOW));
        assert_eq!(machine.status().phase, Phase::Downloading);
        assert_eq!(machine.status().version.as_deref(), Some("2.0.1"));
        assert!(!machine.progress(attempt + 1, 10, Some(100)));
        assert!(!machine.download_finished(attempt + 1));
    }

    #[test]
    fn download_progress_then_ready() {
        let mut machine = available();
        assert_eq!(machine.install_step(false), Ok(InstallStep::Download));
        let attempt = machine.begin_download();
        let status = machine.status();
        assert_eq!(status.phase, Phase::Downloading);
        assert_eq!(status.message, DOWNLOADING_MESSAGE);
        assert_eq!(machine.install_step(false), Err(DOWNLOADING_MESSAGE.to_string()));
        assert!(!machine.can_check());
        // The first chunk with a size, then only whole-percent changes are emitted.
        assert!(machine.progress(attempt, 1_000, Some(1_000_000)));
        assert!(!machine.progress(attempt, 1_000, Some(1_000_000)));
        assert!(machine.progress(attempt, 10_000, Some(1_000_000)));
        assert_eq!(machine.status().downloaded, 12_000);
        assert_eq!(machine.status().total, Some(1_000_000));
        assert!(machine.download_finished(attempt));
        assert_eq!(machine.status().phase, Phase::Ready);
        assert_eq!(machine.status().message, READY_MESSAGE);
        assert_eq!(machine.install_step(true), Ok(InstallStep::Restart));
        // Without the kept package the update is downloaded again.
        assert_eq!(machine.install_step(false), Ok(InstallStep::Download));
        assert!(!machine.can_check());
    }

    #[test]
    fn progress_without_a_size_is_emitted_every_256_kib() {
        let mut machine = available();
        let attempt = machine.begin_download();
        assert!(!machine.progress(attempt, 100_000, None));
        assert!(!machine.progress(attempt, 100_000, None));
        assert!(machine.progress(attempt, 100_000, None));
        assert_eq!(machine.status().total, None);
    }

    #[test]
    fn failed_download_keeps_the_offer() {
        let mut machine = available();
        let attempt = machine.begin_download();
        assert!(machine.download_failed(attempt, VERIFY_MESSAGE.to_string()));
        let status = machine.status();
        assert_eq!(status.phase, Phase::Failed);
        assert_eq!(status.error.as_deref(), Some(VERIFY_MESSAGE));
        assert_eq!(status.version.as_deref(), Some("2.0.1"));
        assert_eq!(machine.install_step(false), Ok(InstallStep::Download));
    }

    #[test]
    fn refused_restart_and_failed_install_stay_ready() {
        let mut machine = available();
        let attempt = machine.begin_download();
        assert!(machine.download_finished(attempt));
        // The download goes straight on to the restart.
        machine.begin_install();
        assert_eq!(machine.status().phase, Phase::Installing);
        assert_eq!(machine.status().message, INSTALLING_MESSAGE);
        assert_eq!(machine.status().error, None);
        // A second click while installing is refused.
        assert_eq!(machine.install_step(true), Err(INSTALLING_MESSAGE.to_string()));
        // The engine refuses while a write is in progress: the package stays ready.
        machine.restart_blocked("Wait for the current save to finish.".to_string());
        assert_eq!(machine.status().phase, Phase::Ready);
        assert_eq!(machine.status().message, READY_MESSAGE);
        assert_eq!(machine.status().error.as_deref(), Some("Wait for the current save to finish."));
        assert_eq!(machine.install_step(true), Ok(InstallStep::Restart));

        machine.begin_install();
        machine.install_failed("The app folder is read-only.".to_string());
        assert_eq!(machine.status().phase, Phase::Ready);
        assert_eq!(machine.status().error.as_deref(), Some("The app folder is read-only."));
    }

    #[test]
    fn version_comparison() {
        assert!(is_newer("2.0.0", "2.0.1"));
        assert!(is_newer("2.0.0", "2.1.0"));
        assert!(is_newer("2.0.9", "2.0.10"));
        assert!(is_newer("1.14.2", "2.0.0"));
        assert!(is_newer("v2.0.0", "v2.0.1"));
        assert!(!is_newer("2.0.0", "2.0.0"));
        assert!(!is_newer("2.0.1", "2.0.0"));
        assert!(!is_newer("2.0.0", "2.0.0+build.7"));
        // A release outranks its pre-releases.
        assert!(is_newer("2.0.0-beta.2", "2.0.0"));
        assert!(!is_newer("2.0.0", "2.0.0-beta.2"));
        assert!(is_newer("2.0.0-beta.2", "2.0.0-beta.10"));
        assert!(is_newer("2.0.0-alpha", "2.0.0-beta"));
        assert!(is_newer("2.0.0-beta", "2.0.0-beta.1"));
        assert!(is_newer("2.0.0-1", "2.0.0-rc"));
        // Short and unreadable versions.
        assert!(is_newer("2", "2.0.1"));
        assert!(!is_newer("2.0.0", "latest"));
        assert!(!is_newer("2.0.0", "2.0.0.1"));
        assert!(!is_newer("2.0.0", "2.0.0-"));
        assert!(!is_newer("garbage", "2.0.0"));
    }

    #[test]
    fn updater_errors_read_as_english() {
        use tauri_plugin_updater::Error;
        assert_eq!(describe_error(&Error::ReleaseNotFound), NOT_FOUND_MESSAGE);
        assert_eq!(describe_error(&Error::Network("status 404".into())), NETWORK_MESSAGE);
        assert_eq!(describe_error(&Error::MissingSignedVersion), VERIFY_MESSAGE);
        assert_eq!(
            describe_error(&Error::TargetNotFound("darwin-aarch64".into())),
            PLATFORM_MESSAGE
        );
        // The placeholder public key in tauri.conf.json is not base64, so a real download fails
        // in verification and is reported like any unverified update.
        assert_eq!(describe_error(&Error::SignatureUtf8("PLACEHOLDER".into())), VERIFY_MESSAGE);
        assert_eq!(
            describe_error(&Error::EmptyEndpoints),
            "Updater does not have any endpoints set."
        );
    }

    #[test]
    fn automatic_check_schedule() {
        let start = Instant::now();
        let minute = Duration::from_secs(60);
        assert!(check_due(None, start, minute));
        assert!(!check_due(Some(start), start + Duration::from_secs(59), minute));
        assert!(check_due(Some(start), start + minute, minute));
    }

    #[test]
    fn timestamps_are_rfc3339_utc() {
        assert_eq!(rfc3339(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_secs(1_791_273_600)),
            "2026-10-06T08:00:00Z"
        );
        assert_eq!(rfc3339(UNIX_EPOCH + Duration::from_secs(951_782_399)), "2000-02-28T23:59:59Z");
        assert_eq!(rfc3339(UNIX_EPOCH + Duration::from_secs(951_868_800)), "2000-03-01T00:00:00Z");
    }
}
