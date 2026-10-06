//! History (Swift AppModel L550–573, L1406–1416): worklogs for the chosen range, today's
//! worklogs and the CSV export.

use std::collections::BTreeMap;
use std::path::PathBuf;

use jiff::Timestamp;
use jiff::civil::Date;

use att_core::model::{WorkItem, WorkLog};
use att_core::{AppError, Cal};

use crate::engine::Engine;
use crate::state::AppState;

/// The CSV header (Swift `exportHistory()`).
pub(crate) const CSV_HEADER: &str = "Timestamp,Ticket,Title,Seconds,Comment";

#[derive(Default)]
pub(crate) struct HistoryState {
    /// Swift `historyFrom` / `historyTo` (local days, inclusive); set at launch.
    pub from: Option<Date>,
    pub to: Option<Date>,
    pub logs: Vec<WorkLog>,
    /// The range the logs were fetched for (`[from, to + 1 day)`).
    pub fetched: Option<(Date, Date)>,
    pub loading: bool,
    /// Swift `historyLoaded`.
    pub loaded: bool,
    /// Swift `historyGeneration`.
    pub generation: u64,
    /// Swift `lastHistoryCheck`.
    pub last_check: Option<Timestamp>,
}

/// The default range: the last seven days including today.
pub(crate) fn default_range(today: Date, cal: &Cal) -> (Date, Date) {
    (cal.add_date_days(today, -6), today)
}

/// `history.setRange`.
pub(crate) fn set_range(engine: &Engine, from: Date, to: Date) {
    engine.update(|state| {
        state.session.history.from = Some(from);
        state.session.history.to = Some(to);
    });
}

/// Swift `loadHistory()`. A newer load or a new connection drops older results.
pub(crate) async fn load(engine: &Engine) {
    if engine.preview() {
        return;
    }
    let Some(clients) = engine.clients() else { return };
    let cal = engine.cal();
    let today = super::today(engine);
    let Some((generation, from, to)) = engine.update(|state| {
        let history = &mut state.session.history;
        if history.loading {
            return None;
        }
        let (default_from, default_to) = default_range(today, &cal);
        let from = history.from.unwrap_or(default_from);
        let to = history.to.unwrap_or(default_to);
        if from > to {
            state.session.error =
                Some("Choose a history end date on or after the start date.".to_string());
            return None;
        }
        history.generation += 1;
        history.loading = true;
        Some((history.generation, from, to))
    }) else {
        return;
    };
    let start = cal.start_of_date(from);
    let end = cal.start_of_date(cal.add_date_days(to, 1));
    let result = clients.seven_pace.work_logs(Some(start), end, false).await;
    let current_connection = engine.connection_generation() == clients.generation;
    let now = engine.now();
    let loaded = engine.update(|state| {
        let session = &mut state.session;
        if session.history.generation != generation {
            return false;
        }
        session.history.loading = false;
        match result {
            Ok(logs) if current_connection => {
                session.history.logs = logs;
                session.history.fetched = Some((from, to));
                session.history.loaded = true;
                session.history.last_check = Some(now);
                true
            }
            Ok(_) => false,
            Err(error) => {
                session.error = Some(format!("History: {error}"));
                false
            }
        }
    });
    if loaded {
        crate::controllers::hooks::invalidate_worklogs(engine);
        let ids: Vec<i64> = engine.read(|state| {
            state.session.history.logs.iter().filter_map(WorkLog::ticket_id).collect()
        });
        super::connection::request_titles(engine, ids);
    }
}

/// Today's worklogs. 1.14.x fetched today separately when the history range did not cover
/// it; the engine takes them from the history fetch when it covers today, else from the
/// week's progress fetch, which is refreshed after every tracking change.
pub(crate) fn today_logs(state: &AppState, now: Timestamp, cal: &Cal) -> Vec<WorkLog> {
    let today = cal.date(now);
    let day = cal.day_interval(now);
    let history = &state.session.history;
    let covered = history.fetched.is_some_and(|(from, to)| from <= today && today <= to);
    let source = if covered {
        &history.logs
    } else if state.session.progress.week.is_some_and(|week| week.contains(day.start)) {
        &state.session.progress.logs
    } else {
        return Vec::new();
    };
    source
        .iter()
        .filter(|log| log.date(cal.tz()).is_some_and(|date| day.contains(date)))
        .cloned()
        .collect()
}

/// Swift `todaySeconds`: today's worklogs without the running entry.
pub(crate) fn today_seconds(state: &AppState, now: Timestamp, cal: &Cal) -> f64 {
    let running = super::connection::tracking(state)
        .and_then(|state| state.track.as_ref())
        .and_then(|track| track.work_log_id.clone());
    today_logs(state, now, cal)
        .iter()
        .filter(|log| Some(&log.id) != running.as_ref())
        .fold(0.0, |total, log| total + log.length)
}

/// One CSV field: formula-like values get a leading `'`, quotes are doubled, the field is
/// quoted (Swift `escape`).
pub(crate) fn csv_field(value: &str) -> String {
    let guarded = if ["=", "+", "-", "@"].iter().any(|prefix| value.starts_with(prefix)) {
        format!("'{value}")
    } else {
        value.to_string()
    };
    format!("\"{}\"", guarded.replace('"', "\"\""))
}

/// The exported file (Swift `exportHistory()`): one row per worklog of the loaded range.
pub(crate) fn csv(logs: &[WorkLog], titles: &BTreeMap<i64, WorkItem>) -> String {
    let mut text = String::from(CSV_HEADER);
    text.push('\n');
    let rows: Vec<String> = logs
        .iter()
        .map(|log| {
            let ticket = log.work_item_id.map(|id| id.to_string()).unwrap_or_default();
            let title = titles
                .get(&log.work_item_id.unwrap_or(0))
                .map(|item| item.title.as_str())
                .unwrap_or("");
            // Swift `String(Int(length))` truncates toward zero.
            let seconds = if log.length.is_finite() {
                (log.length.trunc() as i64).to_string()
            } else {
                "0".into()
            };
            [
                log.timestamp.as_str(),
                ticket.as_str(),
                title,
                seconds.as_str(),
                log.comment.as_deref().unwrap_or(""),
            ]
            .map(csv_field)
            .join(",")
        })
        .collect();
    text.push_str(&rows.join("\n"));
    text
}

/// `history.exportCsv`: writes the loaded worklogs to `path` (chosen in the save dialog),
/// atomically.
pub(crate) async fn export_csv(engine: &Engine, path: String) {
    let text = engine.read(|state| csv(&state.session.history.logs, &state.session.work_items));
    let target = PathBuf::from(path);
    let result = tokio::task::spawn_blocking(move || write_atomically(&target, &text))
        .await
        .unwrap_or_else(|error| Err(AppError::Message(error.to_string())));
    if let Err(error) = result {
        let message = error.to_string();
        engine.update(|state| state.session.error = Some(message));
    }
}

fn write_atomically(path: &std::path::Path, text: &str) -> att_core::Result<()> {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let temporary = path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    let failed = |error: std::io::Error| {
        AppError::Message(format!("The file “{name}” could not be saved: {error}"))
    };
    std::fs::write(&temporary, text.as_bytes()).map_err(failed)?;
    std::fs::rename(&temporary, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        failed(error)
    })
}
