//! Settings → App maintenance: `app.resetLocalData` and `app.saveDiagnostics`.
//!
//! Resetting clears what the app remembers locally about past days (day review status, the
//! Figma file history, the records of offline drafts already synced to 7pace) and never touches
//! settings, accounts, credentials or drafts that still need uploading.
//!
//! The diagnostics file is plain text for a support request. It is built only from state that
//! holds no secrets (credentials live in the Keychain / Credential Manager and are never read
//! here), shows the 7pace workspace by host only, and strips user info, queries and fragments
//! from every URL and the value after `Bearer` / `Basic` as a second line of defence.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use jiff::Timestamp;
use serde_json::Value;

use att_core::AppError;
use att_core::time::wire_date;
use att_net::Endpoint;

use crate::controllers::hooks as controllers;
use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;
use crate::nl::{tr, trf};
use crate::state::AppState;

use super::{announce, busy, connection, figma, history, update_with};

/// `app.resetLocalData`. Refused while a write or an offline upload runs.
pub(crate) fn reset_local_data(engine: &Engine) -> Result<Value, IpcError> {
    if busy(engine) || engine.read(controllers::offline_working) {
        return Err(IpcError::busy());
    }
    let removed = controllers::clear_synced_offline_drafts(engine)
        .map_err(|message| IpcError::new("storage", message))?;
    update_with(engine, |state, effects| {
        let review = &mut state.session.day_review;
        review.records.clear();
        review.prompt_day = None;
        effects.remove_notification(announce::DAY_REVIEW_ID);
        effects.record(
            tr("Local data reset"),
            trf(
                "Day review status, Figma history and {removed} synced offline drafts cleared",
                &[("removed", &removed)],
            ),
        );
        // The notice after a reset.
        state.session.notice = Some(
            tr("Local data was reset. Settings, accounts and unsent offline drafts were kept.")
                .to_string(),
        );
        // The Figma file history of every workspace; links to tickets stay.
        for ledger in state.session.figma.store.workspaces.values_mut() {
            ledger.history.clear();
        }
    });
    // Day review records and the Figma store are saved with the session documents.
    figma::persist_ledger(engine);
    done()
}

/// What the diagnostics need besides the state.
pub(crate) struct DiagnosticsContext {
    pub now: Timestamp,
    pub version: String,
    pub os: String,
    pub preview: bool,
    pub data_directory: Option<String>,
    pub health: &'static str,
}

/// `app.saveDiagnostics`: writes the diagnostics to `path` (chosen in a save dialog),
/// atomically.
pub(crate) async fn save_diagnostics(engine: &Engine, path: String) -> Result<Value, IpcError> {
    let services = engine.services();
    let now = engine.now();
    let os = serde_json::to_value(services.os)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| std::env::consts::OS.to_string());
    let data_directory = data_directory(engine);
    let text = engine.read(|state| {
        let context = DiagnosticsContext {
            now,
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: format!("{os} ({})", std::env::consts::ARCH),
            preview: services.preview,
            data_directory,
            health: connection::health(state, now).label(),
        };
        diagnostics(state, &context)
    });
    let target = PathBuf::from(path);
    tokio::task::spawn_blocking(move || history::write_atomically(&target, &text))
        .await
        .unwrap_or_else(|error| Err(AppError::Message(error.to_string())))
        .map_err(|error| IpcError::new("message", error.to_string()))?;
    done()
}

/// The folder the engine keeps its data in (`None` for an in-memory store).
pub(crate) fn data_directory(engine: &Engine) -> Option<String> {
    let database = engine.services().store.path()?;
    database.parent().map(Path::display).map(|path| path.to_string())
}

/// The diagnostics text.
pub(crate) fn diagnostics(state: &AppState, context: &DiagnosticsContext) -> String {
    let session = &state.session;
    let connection = &session.connection;
    let config = &state.config;
    let yes_no = |value: bool| if value { "yes" } else { "no" };
    let time = |value: Option<Timestamp>| value.map_or("never".to_string(), wire_date::utc_string);
    let mut out = String::new();
    let _ = writeln!(out, "Azure timetracker diagnostics");
    let _ = writeln!(out, "Generated: {}", wire_date::utc_string(context.now));
    let _ = writeln!(out, "No passwords, tokens or personal access tokens are included.");

    let _ = writeln!(out, "\n== App ==");
    let _ = writeln!(out, "Version: {}", context.version);
    let _ = writeln!(out, "OS: {}", context.os);
    let _ = writeln!(out, "Preview: {}", yes_no(context.preview));
    let _ = writeln!(out, "Data folder: {}", context.data_directory.as_deref().unwrap_or("none"));
    if let Some(issue) = &state.storage_issue {
        let _ = writeln!(out, "Storage issue: {issue}");
    }

    let _ = writeln!(out, "\n== Connection ==");
    let _ = writeln!(out, "Status: {}", context.health);
    let _ = writeln!(out, "Connected: {}", yes_no(connection.connected));
    let _ = writeln!(out, "Connecting: {}", yes_no(connection.connecting));
    let host = host(&config.seven_pace_url);
    let _ = writeln!(out, "7pace host: {}", host.as_deref().unwrap_or("not set"));
    let auth = serde_json::to_value(config.seven_pace_auth_mode).unwrap_or(Value::Null);
    let _ = writeln!(out, "7pace sign-in: {}", auth.as_str().unwrap_or(""));
    let _ = writeln!(out, "7pace credential found: {}", yes_no(connection.has_seven_pace_token));
    let _ = writeln!(out, "Azure organization: {}", or_none(&config.organization));
    let _ = writeln!(out, "Azure project: {}", or_none(&config.project));
    let _ = writeln!(out, "Azure token found: {}", yes_no(connection.has_azure_pat));
    let _ = writeln!(out, "Last 7pace check: {}", time(connection.last_remote_check));
    let _ = writeln!(out, "Last 7pace sync: {}", time(connection.last_sync));
    let _ = writeln!(out, "Last progress sync: {}", time(session.progress.last_sync));
    let _ = writeln!(out, "Last ticket completion check: {}", time(session.completion.checked_at));
    let _ = writeln!(out, "Last calendar check: {}", time(session.calendar.last_check));
    for (label, issue) in [
        ("Connection issue", connection.issue.as_ref()),
        ("Azure issue", connection.azure_issue.as_ref()),
        ("Progress issue", session.progress.issue.as_ref()),
        ("Ticket completion issue", session.completion.issue.as_ref()),
        ("Last error", session.error.as_ref()),
    ] {
        if let Some(issue) = issue {
            let _ = writeln!(out, "{label}: {issue}");
        }
    }

    let _ = writeln!(out, "\n== Settings ==");
    let mut settings = serde_json::to_value(config).unwrap_or(Value::Null);
    if let Some(object) = settings.as_object_mut() {
        // The workspace by host only: a pasted URL may carry a query or user info.
        object.insert("sevenPaceUrl".into(), Value::String(host.unwrap_or_default()));
    }
    let mut lines = Vec::new();
    flatten("", &settings, &mut lines);
    for line in lines {
        let _ = writeln!(out, "{line}");
    }

    let _ = writeln!(out, "\n== App activity ({} entries, newest first) ==", state.audit.len());
    for entry in &state.audit {
        let _ = writeln!(
            out,
            "{} · {}{}",
            wire_date::utc_string(entry.date),
            entry.title,
            if entry.detail.is_empty() { String::new() } else { format!(" — {}", entry.detail) }
        );
    }
    scrub(&out)
}

fn or_none(text: &str) -> &str {
    if text.trim().is_empty() { "not set" } else { text }
}

/// The 7pace host of the saved workspace URL.
fn host(seven_pace_url: &str) -> Option<String> {
    Endpoint::seven_pace(seven_pace_url).ok()?.host_str().map(str::to_string)
}

/// `key.path: value` lines; lists of objects are counted, not listed.
fn flatten(prefix: &str, value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if map.is_empty() {
                out.push(format!("{prefix}: {{}}"));
            }
            for (key, value) in map {
                let path = if prefix.is_empty() { key.clone() } else { format!("{prefix}.{key}") };
                flatten(&path, value, out);
            }
        }
        Value::Array(items) if items.iter().any(|item| item.is_object() || item.is_array()) => {
            out.push(format!("{prefix}: {} items", items.len()));
        }
        Value::String(text) => out.push(format!("{prefix}: {text}")),
        other => out.push(format!("{prefix}: {other}")),
    }
}

/// Removes user info, queries and fragments from URLs and the credential after `Bearer` or
/// `Basic`.
pub(crate) fn scrub(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find("://") {
        out.push_str(&rest[..index + 3]);
        let after = &rest[index + 3..];
        let end = after
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '`'))
            .unwrap_or(after.len());
        let url = &after[..end];
        let authority_end = url.find(['/', '?', '#']).unwrap_or(url.len());
        let authority = &url[..authority_end];
        out.push_str(authority.rsplit('@').next().unwrap_or(authority));
        let path = &url[authority_end..];
        out.push_str(&path[..path.find(['?', '#']).unwrap_or(path.len())]);
        rest = &after[end..];
    }
    out.push_str(rest);
    scrub_schemes(&out)
}

fn scrub_schemes(text: &str) -> String {
    let mut words: Vec<String> = Vec::new();
    let mut hide_next = false;
    for word in text.split(' ') {
        if hide_next && !word.trim().is_empty() {
            let kept: String = word.chars().skip_while(|c| !c.is_whitespace()).collect();
            words.push(format!("[removed]{kept}"));
            hide_next = false;
            continue;
        }
        let bare = word.rsplit(['\n', '\t']).next().unwrap_or(word);
        hide_next = bare.eq_ignore_ascii_case("bearer") || bare.eq_ignore_ascii_case("basic");
        words.push(word.to_string());
    }
    words.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_lose_user_info_queries_and_fragments() {
        assert_eq!(
            scrub("Could not reach https://user:pat@dev.azure.com/org/_apis?token=abc#x now"),
            "Could not reach https://dev.azure.com/org/_apis now"
        );
        assert_eq!(scrub("see http://host?secret=1"), "see http://host");
        assert_eq!(
            scrub("Authorization: Bearer abc.def\nnext"),
            "Authorization: Bearer [removed]\nnext"
        );
        assert_eq!(scrub("Basic dXNlcjpwYXQ= header"), "Basic [removed] header");
        assert_eq!(scrub("plain text"), "plain text");
    }

    #[test]
    fn settings_are_flattened_and_lists_of_objects_counted() {
        let value = serde_json::json!({
            "a": {"b": true, "c": [1, 2]},
            "repositories": [{"path": "/x"}],
            "empty": {},
            "name": "x",
        });
        let mut lines = Vec::new();
        flatten("", &value, &mut lines);
        assert_eq!(
            lines,
            vec!["a.b: true", "a.c: [1,2]", "empty: {}", "name: x", "repositories: 1 items"]
        );
    }
}
