//! Quarter-hour rounding in the Time editor: the previewed plan and the saved entry follow the
//! setting, and an undo restores the exact earlier times.

#[path = "support/controllers.rs"]
mod support;

use serde_json::json;

use att_core::Configuration;
use support::*;

const A: &str = "11111111-1111-1111-1111-111111111111";

/// "Now" is 10:00 in Brussels (08:00Z); A is 07:00–08:00 local.
async fn editor(round: bool) -> Harness {
    let config = Configuration { round_to_quarter_hours: round, ..configuration() };
    let logs = vec![log(A, "2026-10-06T07:00:00", 3600.0, Some(1), "Development")];
    let h = Harness::on(store_with(&config), FakeSevenPace::with_logs(logs)).await;
    h.show(Some("timeEditor")).await;
    h.tick().await;
    h.wait_for("timeEditor", |editor| editor["logs"].as_array().unwrap().len() == 1).await;
    h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
    // 07:00–08:12 local: 1h 12m.
    h.ok(json!({"type": "timeEditor.setTimes", "start": "2026-10-06T05:00:00Z", "end": "2026-10-06T06:12:00Z"}))
        .await;
    h
}

#[tokio::test]
async fn an_edit_is_previewed_and_saved_rounded_when_the_setting_is_on() {
    let h = editor(true).await;
    let plan = &h.slice("timeEditor")["plan"];
    assert_eq!(plan["desired"][0]["seconds"], 4500, "1h 12m is saved as 1h 15m");
    assert_eq!(plan["desired"][0]["start"], "2026-10-06T05:00:00Z", "the start stays");
    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations(), [format!("update {A}")]);
    assert_eq!(h.seven_pace.logs()[A].length, 4500.0);

    // Undo restores 1h exactly, without rounding.
    let change = h.slice("timeEditor")["changes"][0]["id"].as_str().unwrap().to_string();
    h.ok(json!({"type": "timeEditor.beginUndo", "changeId": change})).await;
    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.logs()[A].length, 3600.0);
}

#[tokio::test]
async fn an_edit_is_saved_as_entered_when_the_setting_is_off() {
    let h = editor(false).await;
    assert_eq!(h.slice("timeEditor")["plan"]["desired"][0]["seconds"], 4320);
    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.logs()[A].length, 4320.0);
}
