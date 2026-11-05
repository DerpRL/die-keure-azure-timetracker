//! Quarter-hour rounding of timers the app stops: stop, pause and ticket switches round the entry
//! 7pace wrote when the setting is on, and leave it alone when it is off.

mod support;

use serde_json::json;

use att_core::Configuration;
use att_core::model::WorkLog;
use support::*;

/// The engine's clock is 2026-10-06 10:00 in Brussels (08:00Z); `running()` is worklog `wl-0`.
fn harness(round: bool, log: WorkLog) -> Harness {
    let config = Configuration { round_to_quarter_hours: round, ..configuration(vec![]) };
    let h = Harness::new(config);
    h.seven_pace.set_current(running(Some(4821), Some("dev"), None));
    h.seven_pace.server.lock().unwrap().logs = vec![log];
    h
}

fn log(start: &str, seconds: f64) -> WorkLog {
    let mut log = WorkLog::new("wl-0", start, seconds);
    log.work_item_id = Some(4821);
    log
}

fn replaced(h: &Harness) -> Vec<String> {
    h.seven_pace.take_calls().into_iter().filter(|call| call.starts_with("replace")).collect()
}

fn audit_titles(h: &Harness) -> Vec<String> {
    h.slice("history")["audit"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["title"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn stopping_rounds_the_entry_and_keeps_its_start() {
    // 09:00–10:05 is 1h 5m: saved as 1h from 09:00.
    let h = harness(true, log("2026-10-06T09:00:00", 3900.0));
    h.start().await;
    h.seven_pace.take_calls();
    h.ok(json!({"type": "tracking.stop"})).await;
    assert_eq!(replaced(&h), ["replace(wl-0,2026-10-06T07:00:00Z,3600)"]);
    assert!(audit_titles(&h).contains(&"Time rounded".to_string()));
}

#[tokio::test]
async fn an_entry_that_would_end_in_the_future_moves_back_into_free_time() {
    // 09:50–10:00 is 10m: 15m from 09:50 would end at 10:05. Nothing is before it, so it is
    // saved as 09:45–10:00.
    let h = harness(true, log("2026-10-06T09:50:00", 600.0));
    h.start().await;
    h.seven_pace.take_calls();
    h.ok(json!({"type": "tracking.pause"})).await;
    assert_eq!(replaced(&h), ["replace(wl-0,2026-10-06T07:45:00Z,900)"]);
}

#[tokio::test]
async fn an_entry_right_after_the_previous_one_keeps_its_start_and_ends_in_the_future() {
    // The previous entry ends at 09:50, where the stopped 10m starts: saved as 09:50–10:05.
    let h = harness(true, log("2026-10-06T09:50:00", 600.0));
    let mut previous = WorkLog::new("wl-prev", "2026-10-06T09:00:00", 3000.0);
    previous.work_item_id = Some(33984);
    h.seven_pace.server.lock().unwrap().logs.push(previous);
    h.start().await;
    h.seven_pace.take_calls();
    h.ok(json!({"type": "tracking.stop"})).await;
    assert_eq!(replaced(&h), ["replace(wl-0,2026-10-06T07:50:00Z,900)"]);
}

#[tokio::test]
async fn switching_tickets_rounds_the_entry_that_stopped() {
    // 09:00–09:42 is 42m: saved as 45m, ending 09:45 (no later than now).
    let h = harness(true, log("2026-10-06T09:00:00", 2520.0));
    h.start().await;
    h.ok(json!({"type": "tracking.chooseTicket", "ticketId": 4790, "surface": "panel"})).await;
    let id = h.slice("flow")["draft"]["id"].as_str().expect("a draft").to_string();
    h.seven_pace.take_calls();
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    let calls = h.seven_pace.take_calls();
    let replaced: Vec<&String> = calls.iter().filter(|call| call.starts_with("replace")).collect();
    assert_eq!(replaced, ["replace(wl-0,2026-10-06T07:00:00Z,2700)"], "{calls:?}");
    let stop = calls.iter().position(|call| call == "stop").expect("stopped");
    let replace = calls.iter().position(|call| call.starts_with("replace")).unwrap();
    assert!(stop < replace, "rounded after the stop: {calls:?}");
}

#[tokio::test]
async fn nothing_is_rounded_when_the_setting_is_off() {
    let h = harness(false, log("2026-10-06T09:00:00", 3900.0));
    h.start().await;
    h.seven_pace.take_calls();
    h.ok(json!({"type": "tracking.stop"})).await;
    assert!(replaced(&h).is_empty());
    assert!(!audit_titles(&h).contains(&"Time rounded".to_string()));
}

#[tokio::test]
async fn an_entry_that_is_already_a_quarter_multiple_is_not_written() {
    let h = harness(true, log("2026-10-06T09:00:00", 2700.0));
    h.start().await;
    h.seven_pace.take_calls();
    h.ok(json!({"type": "tracking.stop"})).await;
    assert!(replaced(&h).is_empty());
}

#[tokio::test]
async fn a_failed_rounding_keeps_the_entry_and_says_so() {
    // An unreadable length cannot be rounded; the stop itself still succeeded.
    let h = harness(true, log("2026-10-06T09:00:00", 0.0));
    h.start().await;
    h.seven_pace.take_calls();
    h.ok(json!({"type": "tracking.stop"})).await;
    assert!(replaced(&h).is_empty());
    let error = h.slice("app")["error"].as_str().unwrap_or_default().to_string();
    assert!(error.contains("not rounded to a quarter hour"), "{error}");
    assert!(!h.seven_pace.current_state().running());
}
